/**
 * Shared helpers for the eviction-case controllers.
 *
 * Holds the cross-handler concerns: request-body sanitizers for the nested
 * objects the wire carries (never deep-spread client input), the Agency
 * resolve, the supporter second factor, the idempotent notification fan-out,
 * and pagination parsing. Kept in one module so create / update / timeline /
 * browse stay thin and never re-implement these.
 *
 * ## The wire is nested; the table is FLAT, and the seam is here
 *
 * `location`, `contactInfo` and `coverImage` are nested objects in
 * `@homiio/shared-types`. `eviction_cases` stores them as flat columns, so every
 * sanitizer below returns the COLUMN shape rather than the wire shape: the
 * nested form exists for exactly as long as it takes to whitelist it, and no
 * handler ever holds a half-translated object.
 *
 * **The coordinate pair stops being positional at this boundary.**
 * {@link sanitizeLocation} reads `[lng, lat]` once, names the two halves, and
 * nothing downstream ever indexes a pair again — the same decision, for the same
 * reason, that `eviction_cases` has named `location_longitude` /
 * `location_latitude` columns instead of an array. A transposition here is not a
 * crash, it is a plausible point in the wrong hemisphere on a notice whose
 * entire purpose is telling people where to turn up.
 *
 * ## The coordinate a client sends is the TRUE one, and it is not stored
 *
 * `sanitizeLocation` returns the reported point. `write.ts` hands it to
 * `derivePublicDisc`, stores the DISC, and drops the point — unless the affected
 * household authorised exact disclosure, which is the single authorisation event
 * ADR 0003 §7.3 accepts. Nothing else in this package sees a true eviction
 * coordinate.
 */

import { eq } from 'drizzle-orm';
import {
  EvictionHelpNeedType,
  EvictionLocationAccessPurpose,
  EvictionReportReason,
} from '@homiio/shared-types';
import { getDb } from '../../db/postgres';
import {
  claimUpdateNotificationRecipients,
  confirmSupporter,
  hasConfirmedVoucher,
  listFollowerOxyUserIds,
  type EvictionCaseRow,
} from '../../db/evictions/evictionRepository';
import { findProfileByOxyUserId } from '../../db/profiles/profileRepository';
import { agencies } from '../../db/schema';
import {
  EVICTION_CASE_STATUSES,
  EVICTION_HELP_NEED_TYPES,
  EVICTION_LOCATION_ACCESS_PURPOSES,
  EVICTION_PUBLIC_PRECISIONS,
  EVICTION_REPORT_REASONS,
} from '../../db/schema/evictions';
import { normalizeAgencyName } from '../../utils/agencyName';
import {
  notificationDispatchService,
  type DispatchPayload,
} from '../../services/notificationDispatchService';
import { sanitizePublicText, type RemovedTextClass } from './sanitizePublicText';

/** RSVP thresholds that trigger an owner "people are showing up" notification. */
export const ATTENDEE_MILESTONES: ReadonlySet<number> = new Set([5, 10, 25, 50, 100]);

/** A case status as the column stores it. */
export type EvictionStatusValue = EvictionCaseRow['status'];

/** A public precision as the column stores it. */
export type EvictionPrecisionValue = EvictionCaseRow['locationPrecision'];

/** The bounds `eviction_cases_coordinates_range_check` enforces server-side. */
const MAX_LONGITUDE = 180;
const MAX_LATITUDE = 90;

export const MAX_PAGE_SIZE = 50;

/** Caps on the two free-text fields, applied after sanitisation. */
export const MAX_LABEL_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 4000;

/**
 * A client `location`, whitelisted into the shape the write path takes.
 *
 * Every field is optional because this is the shape of what SURVIVED
 * whitelisting, not the shape of a valid location — the handlers decide which
 * absences are fatal.
 */
export interface SanitizedEvictionLocation {
  label?: string;
  /** The TRUE longitude the reporter gave. Never stored as-is. */
  longitude?: number;
  /** The TRUE latitude the reporter gave. Never stored as-is. */
  latitude?: number;
  precision?: EvictionPrecisionValue;
  city?: string;
  countryCode?: string;
  /** What `sanitizePublicText` took out of the label, as categories. */
  removedFromLabel: readonly RemovedTextClass[];
}

/** The five `contact_*` columns, as a write payload. */
export interface EvictionContactColumns {
  contactPhone: string | null;
  contactEmail: string | null;
  contactTelegram: string | null;
  contactWhatsapp: string | null;
  contactInstructions: string | null;
}

/** The two `cover_image_*` columns, as a write payload. */
export interface EvictionCoverImageColumns {
  coverImageId: string | null;
  coverImageUrl: string | null;
}

/** The wire key of each contact handle, and the column that stores it. */
const CONTACT_COLUMN_BY_WIRE_KEY = {
  phone: 'contactPhone',
  email: 'contactEmail',
  telegram: 'contactTelegram',
  whatsapp: 'contactWhatsapp',
  instructions: 'contactInstructions',
} as const satisfies Readonly<Record<string, keyof EvictionContactColumns>>;

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

/**
 * Narrow a client-supplied status to one the column accepts.
 *
 * A `find` over the tuple the CHECK is built from, so the set the API validates
 * and the set the database enforces cannot drift apart.
 */
export function parseEvictionStatus(value: unknown): EvictionStatusValue | undefined {
  if (typeof value !== 'string') return undefined;
  return EVICTION_CASE_STATUSES.find((status) => status === value);
}

/** Narrow a client-supplied report reason the same way. */
export function parseEvictionReportReason(value: unknown): EvictionReportReason | undefined {
  if (typeof value !== 'string') return undefined;
  const match = EVICTION_REPORT_REASONS.find((reason) => reason === value);
  return match === undefined ? undefined : (match as EvictionReportReason);
}

/** Narrow a client-supplied grant purpose. There is deliberately no `other`. */
export function parseGrantPurpose(value: unknown): EvictionLocationAccessPurpose | undefined {
  if (typeof value !== 'string') return undefined;
  const match = EVICTION_LOCATION_ACCESS_PURPOSES.find((purpose) => purpose === value);
  return match === undefined ? undefined : (match as EvictionLocationAccessPurpose);
}

/** Narrow a client-supplied help-need type. */
export function parseHelpNeedType(value: unknown): EvictionHelpNeedType | undefined {
  if (typeof value !== 'string') return undefined;
  const match = EVICTION_HELP_NEED_TYPES.find((need) => need === value);
  return match === undefined ? undefined : (match as EvictionHelpNeedType);
}

/**
 * Re-whitelist a client `location.coordinates` into a NAMED pair.
 *
 * Accepts the flat `[lng, lat]` tuple the current contract sends. Longitude
 * FIRST, which is the one thing about this function worth reading twice.
 * Out-of-range values are rejected here rather than left to the CHECK: reaching
 * the CHECK means a client mistake arrives as a 500, and PostGIS would otherwise
 * coerce latitude 100 to 80 by wrapping over the pole rather than refusing it.
 */
function sanitizeCoordinates(raw: unknown): { longitude: number; latitude: number } | undefined {
  if (!Array.isArray(raw) || raw.length !== 2) return undefined;
  const longitude = Number(raw[0]);
  const latitude = Number(raw[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return undefined;
  if (Math.abs(longitude) > MAX_LONGITUDE || Math.abs(latitude) > MAX_LATITUDE) return undefined;
  return { longitude, latitude };
}

/** Re-whitelist a client `location` object key-by-key (never deep-spread). */
export function sanitizeLocation(input: unknown): SanitizedEvictionLocation | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const src = input as Record<string, unknown>;
  const out: SanitizedEvictionLocation = { removedFromLabel: [] };

  if (typeof src.label === 'string') {
    // The label is where "Carrer de X 42, 3r 2a" gets typed, and it is published
    // verbatim on every card. Sanitising it is not belt-and-braces beside the
    // coordinate work: it is the SAME disclosure by a route the geometry cannot
    // reach (ADR 0003 §7.1, finding F9).
    const scrubbed = sanitizePublicText(src.label);
    out.label = scrubbed.text.slice(0, MAX_LABEL_LENGTH).trim();
    out.removedFromLabel = scrubbed.removed;
  }

  const coordinates = sanitizeCoordinates(src.coordinates);
  if (coordinates) {
    out.longitude = coordinates.longitude;
    out.latitude = coordinates.latitude;
  }
  const precision = EVICTION_PUBLIC_PRECISIONS.find((value) => value === src.precision);
  if (precision) out.precision = precision;
  if (typeof src.city === 'string') out.city = src.city.trim() || undefined;
  if (typeof src.countryCode === 'string') {
    out.countryCode = src.countryCode.trim().toUpperCase() || undefined;
  }
  return out;
}

/**
 * Re-whitelist a client `contactInfo` object into all five columns.
 *
 * ALL five are always returned, absent handles as `null`, because a payload
 * naming only `phone` must DROP a previously stored `email` rather than merge
 * with it — the contact block is one thing the organiser publishes, and a merge
 * would leave a handle live that they thought they had removed.
 */
export function sanitizeContactInfo(input: unknown): EvictionContactColumns {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const columns: EvictionContactColumns = {
    contactPhone: null,
    contactEmail: null,
    contactTelegram: null,
    contactWhatsapp: null,
    contactInstructions: null,
  };
  for (const [wireKey, column] of Object.entries(CONTACT_COLUMN_BY_WIRE_KEY)) {
    const value = src[wireKey];
    if (typeof value === 'string' && value.trim()) columns[column] = value.trim();
  }
  return columns;
}

/** Re-whitelist a client `coverImage` object into its two columns. */
export function sanitizeCoverImage(input: unknown): EvictionCoverImageColumns {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    coverImageId: typeof src.imageId === 'string' ? src.imageId : null,
    coverImageUrl: typeof src.url === 'string' ? src.url : null,
  };
}

/** One help need, as the child table stores it. */
export interface SanitizedHelpNeed {
  readonly needType: EvictionHelpNeedType;
  readonly note?: string;
}

/**
 * Re-whitelist a client `helpNeeds` array.
 *
 * The note goes through the SAME public-text sanitiser as the description: "call
 * me on 600 123 456" in a help need is the same disclosure as in the body, and a
 * sanitiser applied to one field and not its neighbour is the shape of gap this
 * whole module exists to close.
 */
export function sanitizeHelpNeeds(input: unknown): readonly SanitizedHelpNeed[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<EvictionHelpNeedType>();
  const needs: SanitizedHelpNeed[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const src = entry as Record<string, unknown>;
    const needType = parseHelpNeedType(src.type);
    if (!needType || seen.has(needType)) continue;
    seen.add(needType);
    const note =
      typeof src.note === 'string' && src.note.trim()
        ? sanitizePublicText(src.note).text.slice(0, 500).trim()
        : undefined;
    needs.push({ needType, note: note || undefined });
  }
  return needs;
}

/**
 * Resolve an agency NAME to the `agencies.id` a case may reference.
 *
 * A pure lookup on the dedup key `findOrCreateAgencyByName` writes, so a name
 * that matches an existing agency links to it and one that does not resolves to
 * nothing. This deliberately does NOT create: the eviction board is a public
 * notice surface where anybody may type any name, and letting it mint agency
 * rows would make an unauthenticated-in-effect write path out of a read.
 *
 * A Postgres failure here is the same failure the insert two lines later would
 * hit, and swallowing it would report a database outage as "no agency named".
 */
export async function resolveAgencyId(agencyName: string): Promise<string | undefined> {
  const normalized = normalizeAgencyName(agencyName);
  if (!normalized) return undefined;
  const [row] = await getDb()
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.normalizedName, normalized))
    .limit(1);
  return row?.id;
}

/**
 * Try to satisfy ADR 0003 §7.3.1's second factor for one supporter.
 *
 * Two bases, and both are things this deployment can actually observe:
 *
 *  - **`account_tenure`** — the caller's Homiio profile is older than the case's
 *    own `contact_unlock_min_tenure_days`. A profile is the only account-age
 *    signal Homiio holds; a caller with no profile has no tenure and needs the
 *    other route.
 *  - **`supporter_vouch`** — an already-confirmed supporter of THIS case vouched
 *    for them. That is what lets a newcomer in without the organiser approving
 *    individuals, which would require showing them the roster §7.4 forbids.
 *
 * The ADR names a third, an Oxy `account_verified` signal, and it is NOT
 * implemented: `OxyRequestUser` carries no verification field, so wiring it means
 * changing `@oxyhq/core` rather than this function. Recorded rather than faked —
 * a basis nothing can write would look like coverage.
 *
 * @returns the basis that was satisfied, or `undefined` when neither was.
 */
export async function tryConfirmSupporter(
  input: {
    readonly caseId: string;
    readonly oxyUserId: string;
    readonly minTenureDays: number;
  },
): Promise<'account_tenure' | 'supporter_vouch' | undefined> {
  const db = getDb();

  const profile = await findProfileByOxyUserId(db, input.oxyUserId);
  if (profile) {
    const tenureMs = Date.now() - profile.createdAt.getTime();
    if (tenureMs >= input.minTenureDays * 24 * 60 * 60 * 1000) {
      if (await confirmSupporter(input.caseId, input.oxyUserId, 'account_tenure', db)) {
        return 'account_tenure';
      }
    }
  }

  if (await hasConfirmedVoucher(input.caseId, input.oxyUserId, db)) {
    if (await confirmSupporter(input.caseId, input.oxyUserId, 'supporter_vouch', db)) {
      return 'supporter_vouch';
    }
  }

  return undefined;
}

/**
 * Notify everybody following a case about ONE timeline entry, exactly once.
 *
 * The idempotency is a database fact rather than a best effort:
 * `claimUpdateNotificationRecipients` inserts into a table with a unique index
 * on `(update_id, recipient)` using `ON CONFLICT DO NOTHING RETURNING`, so only
 * the recipients this call actually claimed come back. A retry, a second cron
 * tick and two API processes racing all converge on one message — which is
 * #358's "update de fecha notificado una sola vez", tested directly by
 * dispatching the same entry twice.
 *
 * The claim happens BEFORE the dispatch, which is the right way round: the
 * dispatch is best-effort by design (the domain action must succeed even if a
 * mailbox write fails), so a missed notification is better than a repeated one.
 */
export async function notifyTimelineEvent(
  input: {
    readonly caseId: string;
    readonly updateId: string;
    readonly excludeOxyUserId: string;
    readonly payload: DispatchPayload;
  },
): Promise<readonly string[]> {
  const recipients = await listFollowerOxyUserIds(input.caseId, input.excludeOxyUserId);
  const claimed = await claimUpdateNotificationRecipients(input.updateId, recipients);
  await Promise.allSettled(
    claimed.map((recipientOxyUserId) =>
      notificationDispatchService.createForUser(recipientOxyUserId, input.payload),
    ),
  );
  return claimed;
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

/** Sanitise a description, capped. Exported so create and update share one rule. */
export function sanitizeDescription(input: string): {
  text: string;
  removed: readonly RemovedTextClass[];
} {
  const scrubbed = sanitizePublicText(input);
  return { text: scrubbed.text.slice(0, MAX_DESCRIPTION_LENGTH).trim(), removed: scrubbed.removed };
}
