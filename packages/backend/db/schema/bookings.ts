/**
 * `reservations` and `viewing_requests` — the two ways a listing gets booked
 * for a date.
 *
 * Ported from `models/schemas/ReservationSchema.ts` and
 * `models/schemas/ViewingRequestSchema.ts`. Both empty in production.
 *
 * They share a file because they share the question their indexes exist to
 * answer — "is this property already taken then?" — and answer it at two
 * different grains: a reservation occupies a RANGE of nights, a viewing occupies
 * an INSTANT.
 */

import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import {
  DEFAULT_VIEWING_DURATION_MINUTES,
  MAX_VIEWING_DURATION_MINUTES,
  MIN_VIEWING_DURATION_MINUTES,
  MINUTES_PER_DAY,
  VIEWING_MODALITIES,
  VIEWING_WEEKDAY_MAX,
  VIEWING_WEEKDAY_MIN,
  type CancellationPolicy,
  type ReservationStatus,
} from '@homiio/shared-types';
import { properties } from './properties';

export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'cancelled',
  'completed',
  'declined',
] as const satisfies readonly `${ReservationStatus}`[];

export const RESERVATION_CANCELLATION_POLICIES = [
  'flexible',
  'moderate',
  'strict',
  'super_strict',
] as const satisfies readonly `${CancellationPolicy}`[];

export const VIEWING_REQUEST_STATUSES = ['pending', 'approved', 'declined', 'cancelled'] as const;
export const VIEWING_REQUEST_CANCELLERS = ['requester', 'owner'] as const;

/**
 * A number as a SQL LITERAL rather than a bound parameter.
 *
 * A plain `${42}` inside a drizzle `sql` template becomes a placeholder, and
 * drizzle-kit writes the placeholder into the DDL verbatim: the generated
 * migration reads `between $1 and $2` and fails to apply. The trap is that the
 * schema file looks right and the TypeScript compiles — it is only visible in
 * the generated SQL, which is why every numeric bound in a CHECK below goes
 * through here rather than being interpolated directly.
 */
function literal(value: number): ReturnType<typeof sql.raw> {
  return sql.raw(String(value));
}

export const reservations = pgTable(
  'reservations',
  {
    id: generatedId(),

    /** RESTRICT — a paid booking is not a copy of an advertisement. See `leases.property_id`. */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    guestOxyUserId: text().notNull(),
    hostOxyUserId: text().notNull(),

    checkIn: timestamptz().notNull(),
    checkOut: timestamptz().notNull(),
    /** Application-supplied whole people, so `bigint`; see `properties`' numbers section. */
    guestCount: bigint({ mode: 'number' }).notNull(),
    /**
     * Nights between the two dates.
     *
     * Kept as a stored column rather than made GENERATED, and that is the
     * deliberate half of this decision. `pre('save')` recomputes it as
     * `round((checkOut - checkIn) / 86_400_000)` — a ROUNDING, so a stay
     * crossing a DST boundary is 7 nights by that rule and 6.958 days by
     * subtraction. A generated column would have to reproduce the rounding
     * exactly to avoid silently re-pricing a booking, and it is the priced
     * quantity: `subtotal = nights × nightly_rate` is what the guest agreed to.
     * A derivation that disagrees with a signed number is worse than a stored
     * one that cannot.
     */
    nights: bigint({ mode: 'number' }).notNull(),

    nightlyRate: doublePrecision().notNull(),
    subtotal: doublePrecision().notNull(),
    cleaningFee: doublePrecision().notNull().default(0),
    serviceFee: doublePrecision().notNull().default(0),
    taxes: doublePrecision().notNull().default(0),
    total: doublePrecision().notNull(),
    /**
     * Three-letter code, uppercased at the call site. No vocabulary CHECK —
     * Mongoose declared `minlength`/`maxlength` and no `enum`, the same
     * deferred-validator case as `commissions.currency`.
     */
    currency: text().notNull().default('EUR'),

    status: text({ enum: RESERVATION_STATUSES }).notNull().default('pending'),
    instantBooked: boolean().notNull().default(false),
    cancellationPolicy: text({ enum: RESERVATION_CANCELLATION_POLICIES }).notNull(),
    specialRequests: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * The double-booking check.
     *
     * Mongo's `{ propertyId: 1, checkIn: 1, checkOut: 1 }` cannot answer "does
     * anything overlap these dates?" — a btree narrows by one endpoint and
     * filters the rest, the same limitation `property_availability_windows`
     * records. `[)` bounds, matching the availability calendar this competes
     * with: a stay that ends on the morning another begins is not a conflict.
     */
    index('reservations_stay_range_gist').using(
      'gist',
      sql`tstzrange(${table.checkIn}, ${table.checkOut})`,
    ),
    // The property scope the composite above used to carry as its leading
    // column, for the per-listing calendar read.
    index('reservations_property_check_in_idx').on(table.propertyId, table.checkIn),
    index('reservations_guest_status_idx').on(table.guestOxyUserId, table.status),
    index('reservations_host_status_created_idx').on(
      table.hostOxyUserId,
      table.status,
      sql`${table.createdAt} desc`,
    ),
    check(
      'reservations_status_check',
      sql`${table.status} in (${sql.raw(inList(RESERVATION_STATUSES))})`,
    ),
    check(
      'reservations_cancellation_policy_check',
      sql`${table.cancellationPolicy} in (${sql.raw(inList(RESERVATION_CANCELLATION_POLICIES))})`,
    ),
    /**
     * Mongo declared this as a `validate` on `checkOut` — which, like every
     * validator in this package, does not run on an update. A reservation whose
     * checkout precedes its checkin prices at a negative subtotal.
     */
    check('reservations_stay_order_check', sql`${table.checkOut} > ${table.checkIn}`),
    /**
     * `min: 1` on both, from the schema. Expressed rather than deferred because
     * the table is empty and because a zero-night or zero-guest booking is a
     * charge with nothing behind it.
     */
    check('reservations_nights_check', sql`${table.nights} >= 1`),
    check('reservations_guest_count_check', sql`${table.guestCount} >= 1`),
  ],
);

export const viewingRequests = pgTable(
  'viewing_requests',
  {
    id: generatedId(),

    /** RESTRICT. A viewing is only requested against an internal listing. */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    requesterOxyUserId: text().notNull(),
    ownerOxyUserId: text().notNull(),

    scheduledAt: timestamptz().notNull(),
    /**
     * How long the appointment runs, from {@link viewingRequests.scheduledAt}.
     *
     * Before this column a viewing was an INSTANT, and the conflict rule was
     * `scheduled_at = scheduled_at` — so two visits five minutes apart were not
     * a conflict, and one owner could be double-booked all afternoon without a
     * single query noticing. A stored length turns that equality into an
     * overlap.
     *
     * Stored rather than read from the window it came from, for the reason
     * `reservations.nights` is stored: it is part of what the two sides agreed.
     * An owner who shortens their Tuesday slots to 15 minutes must not thereby
     * shorten an appointment somebody already holds.
     */
    durationMinutes: integer().notNull().default(DEFAULT_VIEWING_DURATION_MINUTES),
    message: text(),
    /** In person, or over video. */
    modality: text({ enum: VIEWING_MODALITIES }).notNull().default('in_person'),
    status: text({ enum: VIEWING_REQUEST_STATUSES }).notNull().default('pending'),
    /**
     * What the owner said when they answered.
     *
     * The decision used to be a status and nothing else, so "sorry, it went
     * yesterday" and "I can do Thursday instead" were both spelled `declined`
     * and the requester read a fixed English sentence the owner never wrote.
     * Free text on purpose: it is one person writing to another, and the set of
     * things a landlord might say is not one this schema gets to close.
     */
    ownerResponse: text(),
    /** Which side cancelled. NULL for every request that was not cancelled. */
    cancelledBy: text({ enum: VIEWING_REQUEST_CANCELLERS }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * Both of Mongo's compounds, ported as they are — and now carrying the
     * overlap search as well, which is why there is still no GiST index here
     * even though a viewing has become a RANGE.
     *
     * The range is `[scheduled_at, scheduled_at + duration)`, and
     * `timestamptz + interval` is STABLE rather than IMMUTABLE (`pg_proc`
     * reports `timestamptz_pl_interval` as `s`, measured on this repository's
     * PostGIS 17 image and asserted in `__tests__/db/viewingOverlap.test.ts`).
     * An expression index requires IMMUTABLE, so the tstzrange GiST index that
     * `reservations` and `property_availability_windows` get cannot be built
     * over this pair at all — not as a preference, as a refusal from the server.
     *
     * What makes the btree sufficient instead is
     * `viewing_requests_duration_check`: no appointment can run longer than
     * MAX_VIEWING_DURATION_MINUTES, so a conflict search can bound
     * `scheduled_at` on BOTH sides with constants and still be exhaustive. See
     * `findOverlappingViewing`.
     */
    index('viewing_requests_property_scheduled_status_idx').on(
      table.propertyId,
      table.scheduledAt,
      table.status,
    ),
    index('viewing_requests_owner_scheduled_status_idx').on(
      table.ownerOxyUserId,
      table.scheduledAt,
      table.status,
    ),
    // Mongo's standalone `{ requesterOxyUserId: 1 }` — the requester's own list,
    // and the leading prefix of nothing above it.
    index('viewing_requests_requester_idx').on(table.requesterOxyUserId),
    check(
      'viewing_requests_status_check',
      sql`${table.status} in (${sql.raw(inList(VIEWING_REQUEST_STATUSES))})`,
    ),
    check(
      'viewing_requests_cancelled_by_check',
      sql`${table.cancelledBy} in (${sql.raw(inList(VIEWING_REQUEST_CANCELLERS))})`,
    ),
    /**
     * `cancelled_by` is set exactly when the request was cancelled.
     *
     * Mongo allowed a `pending` request to name a canceller and a `cancelled`
     * one to name nobody. The second is the damaging half — a cancellation with
     * no attribution is one neither party can be shown to have made.
     */
    check(
      'viewing_requests_cancelled_by_status_check',
      sql`(${table.status} = 'cancelled') = (${table.cancelledBy} is not null)`,
    ),
    check(
      'viewing_requests_modality_check',
      sql`${table.modality} in (${sql.raw(inList(VIEWING_MODALITIES))})`,
    ),
    /**
     * The bound the overlap query's index scan depends on. See the index above:
     * without a ceiling, "no appointment starting before this one can still be
     * running" has no answer and the search would have to read the whole
     * listing's history.
     */
    check(
      'viewing_requests_duration_check',
      sql`${table.durationMinutes} between ${literal(MIN_VIEWING_DURATION_MINUTES)} and ${literal(MAX_VIEWING_DURATION_MINUTES)}`,
    ),
    /**
     * An owner's words belong to a DECISION, and a pending request has not had
     * one. One-way rather than an equivalence, unlike `cancelled_by`: a decline
     * without words is a perfectly ordinary decline, while a sentence sitting
     * on a request nobody has answered is a message the requester would be
     * shown and the owner never sent.
     */
    check(
      'viewing_requests_owner_response_status_check',
      sql`${table.ownerResponse} is null or ${table.status} <> 'pending'`,
    ),
  ],
);

/**
 * `property_viewing_windows` — when an owner may be asked to show a listing.
 *
 * A RECURRING WEEKLY window in the property's own zone, carved into
 * `slot_minutes` appointments. The model, and what it deliberately cannot say,
 * are argued in `shared-types/src/viewing.ts`; this table only has to be the
 * one place it is written down.
 *
 * ## No expiry, on purpose
 *
 * A recurrence has no deadline, so there is no `expires_at` and no entry in
 * `db/expiry.ts`. That is recorded here rather than left as an absence, because
 * the absence is exactly what `EXPIRY_SWEEP_TARGETS` exists to make suspicious:
 * this table is bounded by the listings it hangs off — a handful of rows per
 * property, deleted with it — rather than by time, so a sweep would have
 * nothing to reap and a deadline would quietly stop a listing being visitable
 * on a date nobody chose.
 *
 * ## CASCADE, and it is the easy half of the rule
 *
 * `properties` is hard-deleted by the expiry sweep, so a RESTRICT here would
 * abort a sweep batch on a schedule. That hazard is only acceptable because a
 * window is not a human transaction: it is a statement about the
 * advertisement's availability, meaningless without it, in the same class as
 * `property_availability_windows`. The VIEWINGS booked into these windows stay
 * RESTRICT, because those are transactions.
 */
export const propertyViewingWindows = pgTable(
  'property_viewing_windows',
  {
    id: generatedId(),

    /** CASCADE — see the table's docblock. */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    /** `0` = Sunday, matching Postgres `extract(dow)`. */
    weekday: integer().notNull(),
    /** Minutes since local midnight, inclusive. */
    startMinute: integer().notNull(),
    /** Minutes since local midnight, exclusive. `1440` is the end of the day. */
    endMinute: integer().notNull(),
    /** How long each appointment carved out of this window lasts. */
    slotMinutes: integer().notNull().default(DEFAULT_VIEWING_DURATION_MINUTES),
    /** In person, or over video. An owner offering both declares two windows. */
    modality: text({ enum: VIEWING_MODALITIES }).notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The whole-schedule read, which is the only read there is: a slot
    // generator needs every window on the listing, and the weekday orders them.
    index('property_viewing_windows_property_weekday_idx').on(table.propertyId, table.weekday),
    /**
     * One window per (listing, weekday, start, modality).
     *
     * Total rather than partial — every column is NOT NULL and the rule really
     * is total. It refuses a double submit; it deliberately does NOT refuse two
     * windows that merely OVERLAP, because an owner offering in-person visits
     * 17:00–20:00 and video 18:00–19:00 on the same evening means both, and
     * forbidding it would be this table deciding a product question it has no
     * standing to decide. The slot generator dedupes what the union produces.
     */
    uniqueIndex('property_viewing_windows_slot_key').on(
      table.propertyId,
      table.weekday,
      table.startMinute,
      table.modality,
    ),
    check(
      'property_viewing_windows_modality_check',
      sql`${table.modality} in (${sql.raw(inList(VIEWING_MODALITIES))})`,
    ),
    check(
      'property_viewing_windows_weekday_check',
      sql`${table.weekday} between ${literal(VIEWING_WEEKDAY_MIN)} and ${literal(VIEWING_WEEKDAY_MAX)}`,
    ),
    check(
      'property_viewing_windows_start_check',
      sql`${table.startMinute} >= 0 and ${table.startMinute} < ${literal(MINUTES_PER_DAY)}`,
    ),
    check(
      'property_viewing_windows_end_check',
      sql`${table.endMinute} > 0 and ${table.endMinute} <= ${literal(MINUTES_PER_DAY)}`,
    ),
    check(
      'property_viewing_windows_order_check',
      sql`${table.endMinute} > ${table.startMinute}`,
    ),
    check(
      'property_viewing_windows_slot_minutes_check',
      sql`${table.slotMinutes} between ${literal(MIN_VIEWING_DURATION_MINUTES)} and ${literal(MAX_VIEWING_DURATION_MINUTES)}`,
    ),
    /**
     * A window must be able to hold one of its own appointments.
     *
     * Without this, "Tuesday 17:00–17:20, hour-long visits" is a window that
     * offers nothing — and it offers nothing SILENTLY: the generator emits an
     * empty list and the screen says the owner has published no times, which is
     * the one message that is both plausible and wrong.
     */
    check(
      'property_viewing_windows_holds_a_slot_check',
      sql`${table.endMinute} - ${table.startMinute} >= ${table.slotMinutes}`,
    ),
  ],
);
