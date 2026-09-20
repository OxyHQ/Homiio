/**
 * Is this dwelling free over these dates? — the ONE question, for every domain
 * that commits a home to somebody (#518 §7.5).
 *
 * ## Why this module exists at all
 *
 * A home is one dwelling. It was three calendars:
 *
 *  - `reservationController` asked `reservations` and the `listing`-scope
 *    windows,
 *  - `exchangeController` asked `exchange_requests` and nothing else,
 *  - neither asked the other's table.
 *
 * So a confirmed swap left the home bookable as a paid stay, a paid stay left
 * it swappable, and an exchange ignored the host's calendar entirely. Each of
 * those is a double booking that nothing reports: an availability check with
 * nothing in front of it APPROVES, so the wrong answer is the one that looks
 * like success.
 *
 * {@link findOccupancyConflict} is the whole answer, and both domains ask it.
 * A fourth thing that occupies a home is added HERE, once, rather than in
 * whichever controller notices first.
 *
 * ## A blocked window blocks, whatever its scope
 *
 * `property_availability_windows` carries both calendars under a `scope`
 * discriminator, and the stay path used to filter `scope = 'listing'` — so a
 * host who closed their EXCHANGE calendar for a fortnight could still be sold a
 * paid stay inside it. The scope records which calendar the host was editing; it
 * does not say which nights the dwelling has beds free. Any window that is not
 * `available` blocks any commitment. (`available` never blocks: it is the state
 * that says the opposite, and treating it as a block would refuse every booking
 * on a listing whose host published a calendar.)
 *
 * ## Ranges are HALF-OPEN, everywhere
 *
 * Every overlap below is `tstzrange(a, b) && tstzrange(c, d)` with the default
 * `[)` bounds, so a stay that ends the morning another begins is not a conflict.
 * The three underlying queries each document that trap; this module's job is to
 * never mix the two conventions.
 *
 * ## It does not lock on its own
 *
 * A conflict read is only worth what stops a second writer between the read and
 * the insert. The CALLER takes that lock — `SELECT ... FOR UPDATE` on the
 * `properties` row it is deciding against, inside the same transaction (see
 * `db/properties/propertyBookingBasis.ts#lockPropertyBookingBases`). Called
 * outside a transaction this answers a question about the past.
 */

import { and, eq, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';
import { propertyAvailabilityWindows } from '../schema';
import {
  ACTIVE_RESERVATION_STATUSES,
  findOverlappingReservation,
  type ReservationStatusValue,
} from '../bookings/reservationReads';
import { findConflictingExchange } from '../exchanges/exchangeReads';

/** A half-open window `[start, end)`, whatever the domain calls its ends. */
export interface OccupancyWindow {
  readonly start: Date;
  readonly end: Date;
}

/** What is holding the dates. */
export type OccupancyKind = 'reservation' | 'exchange' | 'window';

/** The first commitment found occupying the dates. */
export interface OccupancyConflict {
  readonly kind: OccupancyKind;
  readonly id: string;
}

export interface OccupancyOptions {
  /**
   * Which reservation statuses occupy the calendar.
   *
   * Defaults to `pending` + `confirmed`: a request nobody has answered yet
   * still holds the nights, which is what stops a host being asked to choose
   * between two people for one bed. A CONFIRM path narrows this to `confirmed`,
   * because a sibling pending request must not veto the one being accepted.
   */
  readonly reservationStatuses?: readonly ReservationStatusValue[];
  /** The reservation being confirmed, so it never conflicts with itself. */
  readonly excludeReservationId?: string;
  /** The exchange request being confirmed, so it never conflicts with itself. */
  readonly excludeExchangeId?: string;
}

/**
 * A host-defined calendar window that CLOSES these dates, in either scope.
 *
 * The bounds are bound as ISO STRINGS with an explicit `::timestamptz`, not as
 * `Date`s: postgres.js infers a parameter's wire type from its position and
 * cannot inside `tstzrange(...)`, where a bare `Date` fails at SERIALISATION
 * (`The "string" argument must be of type string ... Received an instance of
 * Date`) before the server ever sees the statement.
 */
export async function findBlockingWindow(
  db: DatabaseOrTransaction,
  propertyId: string,
  window: OccupancyWindow,
): Promise<{ id: string } | undefined> {
  const start = window.start.toISOString();
  const end = window.end.toISOString();

  const [row] = await db
    .select({ id: propertyAvailabilityWindows.id })
    .from(propertyAvailabilityWindows)
    .where(
      and(
        eq(propertyAvailabilityWindows.propertyId, propertyId),
        ne(propertyAvailabilityWindows.status, 'available'),
        sql`tstzrange(${propertyAvailabilityWindows.startsAt}, ${propertyAvailabilityWindows.endsAt})
            && tstzrange(${start}::timestamptz, ${end}::timestamptz)`,
      ) as SQL,
    )
    .limit(1);
  return row;
}

/**
 * The first commitment standing in the way of `window` on `propertyId`.
 *
 * `undefined` means the dwelling is free over those dates by every rule Homiio
 * has. The order is fixed — reservations, exchanges, then the host calendar —
 * so the refusal a caller reports is deterministic rather than a race between
 * three queries.
 */
export async function findOccupancyConflict(
  db: DatabaseOrTransaction,
  propertyId: string,
  window: OccupancyWindow,
  options: OccupancyOptions = {},
): Promise<OccupancyConflict | undefined> {
  const reservation = await findOverlappingReservation(
    db,
    propertyId,
    { checkIn: window.start, checkOut: window.end },
    {
      statuses: options.reservationStatuses ?? ACTIVE_RESERVATION_STATUSES,
      excludeId: options.excludeReservationId,
    },
  );
  if (reservation) return { kind: 'reservation', id: reservation.id };

  const exchange = await findConflictingExchange(db, propertyId, window, {
    excludeId: options.excludeExchangeId,
  });
  if (exchange) return { kind: 'exchange', id: exchange.id };

  const blocked = await findBlockingWindow(db, propertyId, window);
  if (blocked) return { kind: 'window', id: blocked.id };

  return undefined;
}
