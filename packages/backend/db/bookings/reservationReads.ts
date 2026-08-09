/**
 * `reservations` — the paid short-term booking, on Postgres.
 *
 * Empty in production, so this port has no backfill and no consistency window.
 * The LAST table of the tenancy domain.
 *
 * ## `nights` stays a STORED column, and that is the deliberate half
 *
 * `pre('save')` computed it as `round((checkOut - checkIn) / 86_400_000)` — a
 * ROUNDING, so a stay crossing a DST boundary is 7 nights by that rule and
 * 6.958 days by subtraction. It is also the PRICED quantity:
 * `subtotal = nights × nightly_rate` is what the guest agreed to. A generated
 * column would have to reproduce the rounding exactly to avoid silently
 * re-pricing a booking, and a derivation that disagrees with a signed number is
 * worse than a stored one that cannot. `db/schema/bookings.ts` records the same
 * decision from the schema's side; {@link computeNights} is the one writer.
 *
 * ## Both conflict checks are range overlaps now
 *
 * The reservation clash was `checkIn < $checkOut AND checkOut > $checkIn` — a
 * hand-written half-open overlap that works and states the rule twice. The
 * calendar clash loaded EVERY window and overlapped in JavaScript.
 *
 * Both are `tstzrange(...) && tstzrange(...)`, **HALF-OPEN `[)`** — the default,
 * matching `reservations_stay_range_gist` and `property_availability_windows_
 * range_gist`, and meaning a stay that ends the morning another begins is not a
 * conflict. `leases_term_range_gist` uses CLOSED `[]` and copying that spelling
 * here would refuse legitimate back-to-back bookings.
 *
 * The bounds are bound as ISO STRINGS with an explicit `::timestamptz`, not as
 * `Date`s: postgres.js infers a parameter's wire type from its position and
 * cannot inside `tstzrange(...)`, where a bare `Date` fails at SERIALISATION
 * (`The "string" argument must be of type string ... Received an instance of
 * Date`) before the server ever sees the statement.
 */

import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { propertyAvailabilityWindows, reservations } from '../schema';
import { RESERVATION_STATUSES } from '../schema/bookings';

/** A reservation status the CHECK accepts. */
export type ReservationStatusValue = (typeof RESERVATION_STATUSES)[number];

export type ReservationRow = typeof reservations.$inferSelect;

/** The statuses that occupy the calendar for a NEW booking. */
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatusValue[] = [
  'pending',
  'confirmed',
];

/** Whether `value` is one of the five declared statuses. */
export function isReservationStatus(value: unknown): value is ReservationStatusValue {
  return (
    typeof value === 'string' && (RESERVATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Milliseconds in one day, used to derive nights from a date range. */
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Nights between two dates, half-open (`checkOut` exclusive).
 *
 * `Math.round`, exactly as `pre('save')` had it — see the header. This is the
 * ONE writer of the value `subtotal` is computed from.
 */
export function computeNights(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / MS_PER_DAY);
}

/** A half-open stay `[checkIn, checkOut)`. */
export interface StayWindow {
  readonly checkIn: Date;
  readonly checkOut: Date;
}

/**
 * Does an existing reservation in `statuses` overlap this stay?
 *
 * @param excludeId The reservation being confirmed, so it never conflicts with
 *   itself.
 */
export async function findOverlappingReservation(
  db: DatabaseOrTransaction,
  propertyId: string,
  stay: StayWindow,
  options: {
    readonly statuses?: readonly ReservationStatusValue[];
    readonly excludeId?: string;
  } = {},
): Promise<ReservationRow | undefined> {
  const start = stay.checkIn.toISOString();
  const end = stay.checkOut.toISOString();

  const clauses: SQL[] = [
    eq(reservations.propertyId, propertyId),
    inArray(reservations.status, [...(options.statuses ?? ACTIVE_RESERVATION_STATUSES)]),
    sql`tstzrange(${reservations.checkIn}, ${reservations.checkOut})
        && tstzrange(${start}::timestamptz, ${end}::timestamptz)`,
  ];
  if (options.excludeId !== undefined) clauses.push(ne(reservations.id, options.excludeId));

  const [row] = await db
    .select()
    .from(reservations)
    .where(and(...clauses) as SQL)
    .limit(1);
  return row;
}

/**
 * Does a host-defined calendar window BLOCK this stay?
 *
 * Only `blocked` and `booked` windows block; `available` ones never do, which
 * is the same exclusion the JavaScript version made before calling
 * `hasConflict`. Scoped to the `listing` calendar — the table also holds the
 * `exchange` one under the same `scope` discriminator.
 */
export async function findBlockingWindow(
  db: DatabaseOrTransaction,
  propertyId: string,
  stay: StayWindow,
): Promise<{ id: string } | undefined> {
  const start = stay.checkIn.toISOString();
  const end = stay.checkOut.toISOString();

  const [row] = await db
    .select({ id: propertyAvailabilityWindows.id })
    .from(propertyAvailabilityWindows)
    .where(
      and(
        eq(propertyAvailabilityWindows.propertyId, propertyId),
        eq(propertyAvailabilityWindows.scope, 'listing'),
        ne(propertyAvailabilityWindows.status, 'available'),
        sql`tstzrange(${propertyAvailabilityWindows.startsAt}, ${propertyAvailabilityWindows.endsAt})
            && tstzrange(${start}::timestamptz, ${end}::timestamptz)`,
      ),
    )
    .limit(1);
  return row;
}

/** The `listing` calendar for a property, in order. */
export async function listAvailabilityWindows(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<readonly (typeof propertyAvailabilityWindows.$inferSelect)[]> {
  return db
    .select()
    .from(propertyAvailabilityWindows)
    .where(
      and(
        eq(propertyAvailabilityWindows.propertyId, propertyId),
        eq(propertyAvailabilityWindows.scope, 'listing'),
      ),
    )
    .orderBy(asc(propertyAvailabilityWindows.startsAt));
}

/** The confirmed stays on a property, soonest first — the "booked" ranges. */
export async function listConfirmedStays(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<readonly { checkIn: Date; checkOut: Date }[]> {
  return db
    .select({ checkIn: reservations.checkIn, checkOut: reservations.checkOut })
    .from(reservations)
    .where(and(eq(reservations.propertyId, propertyId), eq(reservations.status, 'confirmed')))
    .orderBy(asc(reservations.checkIn));
}

/** Insert a reservation. Every priced field is computed by the caller. */
export async function createReservation(
  db: DatabaseOrTransaction,
  input: typeof reservations.$inferInsert,
): Promise<ReservationRow> {
  const [row] = await db.insert(reservations).values(input).returning();
  return row;
}

/** One reservation by id. */
export async function findReservationById(
  db: DatabaseOrTransaction,
  id: string,
): Promise<ReservationRow | undefined> {
  const [row] = await db.select().from(reservations).where(eq(reservations.id, id)).limit(1);
  return row;
}

export interface ListReservationsFilter {
  readonly guestOxyUserId?: string;
  readonly hostOxyUserId?: string;
  readonly status?: ReservationStatusValue;
}

/** The predicate shared by the page and its `count(*)`, so the two agree. */
function listFilter(filter: ListReservationsFilter): SQL {
  const clauses: SQL[] = [];
  if (filter.guestOxyUserId !== undefined) {
    clauses.push(eq(reservations.guestOxyUserId, filter.guestOxyUserId));
  }
  if (filter.hostOxyUserId !== undefined) {
    clauses.push(eq(reservations.hostOxyUserId, filter.hostOxyUserId));
  }
  if (filter.status !== undefined) clauses.push(eq(reservations.status, filter.status));
  return clauses.length > 0 ? (and(...clauses) as SQL) : sql`true`;
}

export interface ListReservationsResult {
  readonly rows: readonly ReservationRow[];
  readonly total: number;
}

/** One page of reservations, newest first. */
export async function listReservations(
  db: DatabaseOrTransaction,
  filter: ListReservationsFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<ListReservationsResult> {
  const where = listFilter(filter);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(reservations)
      .where(where)
      .orderBy(desc(reservations.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: sql<number>`count(*)::int` }).from(reservations).where(where),
  ]);
  return { rows, total: totalRow.value };
}

/**
 * Move a reservation to `nextStatus`, but only from one of `fromStatuses`.
 *
 * The permitted FROM set is in the `UPDATE`'s own predicate, so two hosts
 * confirming at once cannot both succeed — the read that precedes this in the
 * controller chooses the ERROR, this chooses whether the write happens.
 */
export async function transitionReservation(
  db: DatabaseOrTransaction,
  id: string,
  nextStatus: ReservationStatusValue,
  fromStatuses: readonly ReservationStatusValue[],
): Promise<ReservationRow | undefined> {
  const [row] = await db
    .update(reservations)
    .set({ status: nextStatus })
    .where(and(eq(reservations.id, id), inArray(reservations.status, [...fromStatuses])))
    .returning();
  return row;
}

/**
 * The wire shape the booking screens read.
 *
 * The Mongoose handlers returned `reservation.toJSON()` — every field — so this
 * carries every column. `id`, never `_id`.
 */
export function serializeReservation(row: ReservationRow): Record<string, unknown> {
  return {
    id: row.id,
    propertyId: row.propertyId,
    guestOxyUserId: row.guestOxyUserId,
    hostOxyUserId: row.hostOxyUserId,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    guestCount: row.guestCount,
    nights: row.nights,
    nightlyRate: row.nightlyRate,
    subtotal: row.subtotal,
    cleaningFee: row.cleaningFee,
    serviceFee: row.serviceFee,
    taxes: row.taxes,
    total: row.total,
    currency: row.currency,
    status: row.status,
    instantBooked: row.instantBooked,
    cancellationPolicy: row.cancellationPolicy,
    specialRequests: row.specialRequests,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
