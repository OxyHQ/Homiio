/**
 * Shared helpers for the eviction-case controllers.
 *
 * Holds the cross-handler concerns: request-body sanitizers for the nested
 * objects (never deep-spread client input), coordinate rounding for privacy,
 * the dormant Agency resolve, the attendee notification fan-out, and pagination
 * parsing. Kept in one module so create / update / updates / browse stay thin
 * and never re-implement these.
 */

import mongoose from 'mongoose';
import { EvictionCaseStatus } from '@homiio/shared-types';
import { EvictionCase } from '../../models';
import { logger } from '../../middlewares/logging';
import {
  notificationDispatchService,
  type DispatchPayload,
} from '../../services/notificationDispatchService';

/** RSVP thresholds that trigger an owner "people are showing up" notification. */
export const ATTENDEE_MILESTONES: ReadonlySet<number> = new Set([5, 10, 25, 50, 100]);

/** The set of valid case statuses — shared by every write path that validates it. */
export const VALID_EVICTION_STATUSES: ReadonlySet<string> = new Set(Object.values(EvictionCaseStatus));

/** Coordinate decimal places kept when a location is `approximate` (~110 m). */
const APPROX_COORD_DECIMALS = 3;

export const MAX_PAGE_SIZE = 50;

export interface SanitizedEvictionLocation {
  label?: string;
  coordinates?: { type: 'Point'; coordinates: [number, number] };
  precision?: 'exact' | 'approximate';
  city?: string;
  countryCode?: string;
}

/** Parse a Date | ISO string | epoch into a valid Date, else undefined. */
export function parseDate(value: unknown): Date | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

/** Round a coordinate to the privacy-preserving `approximate` precision. */
export function roundApproxCoord(value: number): number {
  const factor = 10 ** APPROX_COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Re-whitelist a client `location.coordinates` GeoJSON object into a strict
 * `{ type: 'Point', coordinates: [lng, lat] }`. `geo` is `location.coordinates`
 * (the GeoJSON object), whose own `.coordinates` is the `[lng, lat]` pair.
 */
function sanitizeCoordinates(geo: unknown): { type: 'Point'; coordinates: [number, number] } | undefined {
  if (!geo || typeof geo !== 'object') return undefined;
  const raw = (geo as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const lng = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return undefined;
  return { type: 'Point', coordinates: [lng, lat] };
}

/** Re-whitelist a client `location` object key-by-key (never deep-spread). */
export function sanitizeLocation(input: unknown): SanitizedEvictionLocation | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const out: SanitizedEvictionLocation = {};
  if (typeof src.label === 'string') out.label = src.label;
  const coordinates = sanitizeCoordinates(src.coordinates);
  if (coordinates) out.coordinates = coordinates;
  if (src.precision === 'exact' || src.precision === 'approximate') out.precision = src.precision;
  if (typeof src.city === 'string') out.city = src.city;
  if (typeof src.countryCode === 'string') out.countryCode = src.countryCode;
  return out;
}

/** Re-whitelist a client `contactInfo` object key-by-key. */
export function sanitizeContactInfo(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of ['phone', 'email', 'telegram', 'whatsapp', 'instructions'] as const) {
    if (typeof src[key] === 'string') out[key] = src[key] as string;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Re-whitelist a client `coverImage` object key-by-key. */
export function sanitizeCoverImage(input: unknown): { imageId?: string; url?: string } | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const out: { imageId?: string; url?: string } = {};
  if (typeof src.imageId === 'string') out.imageId = src.imageId;
  if (typeof src.url === 'string') out.url = src.url;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Resolve an agency name to an `agencyId` — but ONLY when the Agency model is
 * registered (it ships with the parallel reviews branch). Until then this is a
 * dormant no-op so the eviction feature carries no hard dependency on Agency.
 */
export async function resolveAgencyId(agencyName: string): Promise<mongoose.Types.ObjectId | undefined> {
  const trimmed = agencyName.trim();
  if (!trimmed) return undefined;
  const agencyModel = mongoose.models.Agency as
    | { findOrCreateByName?: (name: string) => Promise<{ _id: mongoose.Types.ObjectId } | null> }
    | undefined;
  if (!agencyModel || typeof agencyModel.findOrCreateByName !== 'function') {
    return undefined;
  }
  try {
    const agency = await agencyModel.findOrCreateByName(trimmed);
    return agency?._id;
  } catch (error) {
    logger.warn('Eviction agency resolve failed', {
      agencyName: trimmed,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Best-effort notification fan-out to every attendee of a case except the
 * excluded user (the owner). Attendees are `select: false`, so they are loaded
 * here with an explicit projection. Every dispatch is swallow-and-logged inside
 * the dispatch service — the domain action must succeed even if a mailbox write
 * fails.
 */
export async function fanOutToAttendees(
  caseId: string,
  excludeOxyUserId: string,
  payload: DispatchPayload,
): Promise<void> {
  const doc = await EvictionCase.findById(caseId).select('+attendees').lean<{
    attendees?: Array<{ oxyUserId?: string }>;
  }>();
  const attendees = Array.isArray(doc?.attendees) ? doc.attendees : [];
  const recipients = Array.from(
    new Set(
      attendees
        .map((attendee) => attendee?.oxyUserId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0 && id !== excludeOxyUserId),
    ),
  );
  await Promise.allSettled(
    recipients.map((recipientOxyUserId) =>
      notificationDispatchService.createForUser(recipientOxyUserId, payload),
    ),
  );
}

export interface Pagination {
  page: number;
  limit: number;
  skip: number;
}

/** Parse `?page`/`?limit` query params, clamped to `[1, MAX_PAGE_SIZE]`. */
export function parsePagination(query: unknown, maxLimit = MAX_PAGE_SIZE): Pagination {
  const source = (query ?? {}) as Record<string, unknown>;
  const rawPage = Number(source.page);
  const rawLimit = Number(source.limit);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  const limitBase = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.floor(rawLimit) : 20;
  const limit = Math.min(limitBase, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

/** Escape a user-supplied string for safe use inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
