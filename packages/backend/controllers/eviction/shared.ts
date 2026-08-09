/**
 * Shared helpers for the eviction-case controllers.
 *
 * Holds the cross-handler concerns: request-body sanitizers for the nested
 * objects the wire still carries (never deep-spread client input), coordinate
 * rounding for privacy, the Agency resolve, the attendee notification fan-out,
 * and pagination parsing. Kept in one module so create / update / updates /
 * browse stay thin and never re-implement these.
 *
 * ## The wire is still nested; the table is FLAT, and the seam is here
 *
 * `location`, `contactInfo` and `coverImage` are nested objects in
 * `@homiio/shared-types` and stay that way — a shipped client cannot be
 * recalled. `eviction_cases` stores them as flat columns, so every sanitizer
 * below returns the COLUMN shape rather than the wire shape: the nested form
 * exists for exactly as long as it takes to whitelist it, and no handler ever
 * holds a half-translated object.
 *
 * **The coordinate pair stops being positional at this boundary.**
 * {@link sanitizeLocation} reads `[lng, lat]` off the GeoJSON array once, names
 * the two halves, and nothing downstream ever indexes a pair again — the same
 * decision, for the same reason, that `eviction_cases` has named
 * `location_longitude` / `location_latitude` columns instead of an array. A
 * transposition here is not a crash, it is a plausible point in the wrong
 * hemisphere on a notice whose entire purpose is telling people where to turn
 * up.
 *
 * The range check is here too, and it is a port rather than an addition: Mongo
 * validated the pair on the schema and answered a bad one with a 400. The
 * `eviction_cases_coordinates_range_check` CHECK is the backstop that makes an
 * out-of-range value unstorable — but reaching it means a client mistake
 * arrives as a 500, and PostGIS would otherwise coerce latitude 100 to 80 by
 * wrapping over the pole rather than refusing it.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '../../db/postgres';
import {
  listAttendeeOxyUserIds,
  type EvictionCaseRow,
} from '../../db/evictions/evictionRepository';
import { agencies } from '../../db/schema';
import {
  EVICTION_CASE_STATUSES,
  EVICTION_LOCATION_PRECISIONS,
} from '../../db/schema/evictions';
import { normalizeAgencyName } from '../../utils/agencyName';
import {
  notificationDispatchService,
  type DispatchPayload,
} from '../../services/notificationDispatchService';

/** RSVP thresholds that trigger an owner "people are showing up" notification. */
export const ATTENDEE_MILESTONES: ReadonlySet<number> = new Set([5, 10, 25, 50, 100]);

/** A case status as the column stores it. */
export type EvictionStatusValue = EvictionCaseRow['status'];

/** A location precision as the column stores it. */
export type EvictionPrecisionValue = EvictionCaseRow['locationPrecision'];

/** Coordinate decimal places kept when a location is `approximate` (~110 m). */
const APPROX_COORD_DECIMALS = 3;

/** The bounds `eviction_cases_coordinates_range_check` enforces server-side. */
const MAX_LONGITUDE = 180;
const MAX_LATITUDE = 90;

export const MAX_PAGE_SIZE = 50;

/**
 * A client `location`, whitelisted into the shape the columns take.
 *
 * Every field is optional because this is the shape of what SURVIVED
 * whitelisting, not the shape of a valid location — the handlers decide which
 * absences are fatal (a create needs a label and a coordinate pair; an update
 * inherits the stored precision).
 */
export interface SanitizedEvictionLocation {
  label?: string;
  longitude?: number;
  latitude?: number;
  precision?: EvictionPrecisionValue;
  city?: string;
  countryCode?: string;
}

/** The five `contact_*` columns, as a write payload. */
export type EvictionContactColumns = Pick<
  EvictionCaseRow,
  'contactPhone' | 'contactEmail' | 'contactTelegram' | 'contactWhatsapp' | 'contactInstructions'
>;

/** The two `cover_image_*` columns, as a write payload. */
export type EvictionCoverImageColumns = Pick<EvictionCaseRow, 'coverImageId' | 'coverImageUrl'>;

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
 * and the set the database enforces cannot drift apart — a status added to
 * `EVICTION_CASE_STATUSES` is accepted here the moment the CHECK accepts it.
 */
export function parseEvictionStatus(value: unknown): EvictionStatusValue | undefined {
  if (typeof value !== 'string') return undefined;
  return EVICTION_CASE_STATUSES.find((status) => status === value);
}

/** Round a coordinate to the privacy-preserving `approximate` precision. */
export function roundApproxCoord(value: number): number {
  const factor = 10 ** APPROX_COORD_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Re-whitelist a client `location.coordinates` GeoJSON object into a NAMED pair.
 *
 * `geo` is `location.coordinates` (the GeoJSON object), whose own `.coordinates`
 * is the `[lng, lat]` array — longitude FIRST, which is the one thing about this
 * function worth reading twice. Out-of-range values are rejected here rather
 * than left to the CHECK; see the module header.
 */
function sanitizeCoordinates(geo: unknown): { longitude: number; latitude: number } | undefined {
  if (!geo || typeof geo !== 'object') return undefined;
  const raw = (geo as { coordinates?: unknown }).coordinates;
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
  const out: SanitizedEvictionLocation = {};
  if (typeof src.label === 'string') out.label = src.label;
  const coordinates = sanitizeCoordinates(src.coordinates);
  if (coordinates) {
    out.longitude = coordinates.longitude;
    out.latitude = coordinates.latitude;
  }
  const precision = EVICTION_LOCATION_PRECISIONS.find((value) => value === src.precision);
  if (precision) out.precision = precision;
  if (typeof src.city === 'string') out.city = src.city;
  if (typeof src.countryCode === 'string') out.countryCode = src.countryCode;
  return out;
}

/**
 * Re-whitelist a client `contactInfo` object into all five columns.
 *
 * ALL five are always returned, absent handles as `null`, because Mongo's
 * `$set: { contactInfo }` replaced the whole sub-document — a payload naming
 * only `phone` dropped a previously stored `email`. Writing every column on
 * every save is that same replacement, and returning a partial would silently
 * turn it into a merge.
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
    if (typeof value === 'string') columns[column] = value;
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

/**
 * Resolve an agency NAME to the `agencies.id` a case may reference.
 *
 * A pure lookup on the dedup key `Agency.findOrCreateByName` writes, so a name
 * that matches an existing agency links to it and one that does not resolves to
 * nothing. This deliberately does NOT create: the eviction board is a public
 * notice surface where anybody may type any name, and letting it mint agency
 * rows would make an unauthenticated-in-effect write path out of a read.
 *
 * The Mongo version swallowed every failure because the Agency model was an
 * OPTIONAL dependency that might not be registered at all — a state that no
 * longer exists. A Postgres failure here is the same failure the insert two
 * lines later would hit, and swallowing it would report a database outage as
 * "no agency named".
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
 * Best-effort notification fan-out to every attendee of a case except the
 * excluded user (the owner).
 *
 * The roster is its own table now, so this is a query rather than an explicit
 * `select: false` projection — and `eviction_case_attendees_case_user_key`
 * makes one row per person a database fact, so the de-duplication the Mongo
 * version needed before dispatching has nothing left to remove.
 *
 * Every dispatch is swallow-and-logged inside the dispatch service — the domain
 * action must succeed even if a mailbox write fails.
 */
export async function fanOutToAttendees(
  caseId: string,
  excludeOxyUserId: string,
  payload: DispatchPayload,
): Promise<void> {
  const recipients = await listAttendeeOxyUserIds(caseId, excludeOxyUserId);
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
