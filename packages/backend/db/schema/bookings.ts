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

import { bigint, boolean, check, doublePrecision, index, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';
import type { CancellationPolicy, ReservationStatus } from '@homiio/shared-types';
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
    message: text(),
    status: text({ enum: VIEWING_REQUEST_STATUSES }).notNull().default('pending'),
    /** Which side cancelled. NULL for every request that was not cancelled. */
    cancelledBy: text({ enum: VIEWING_REQUEST_CANCELLERS }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Both of Mongo's compounds, ported as they are: a viewing occupies an
    // INSTANT rather than a range, so an equality-plus-sort btree is the right
    // shape here and a GiST index would answer a question nobody asks.
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
  ],
);
