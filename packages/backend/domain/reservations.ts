/**
 * Short-stay reservations — the use cases (Airbnb-style).
 *
 * Called by `controllers/reservationController.ts` and by the catalogue tools
 * (`capabilities/handlers/reservations.ts`); every function takes the acting
 * account explicitly and refuses with the route's own `AppError`.
 *
 * Distinct from:
 *  - `ViewingRequest` (in-person tour for the long-term rent flow)
 *  - `Lease`           (signed long-term contract)
 *  - `TenantApplication` (application that precedes a Lease)
 *
 * A Reservation transitions: pending -> confirmed | declined | cancelled
 * and confirmed -> cancelled | completed.
 */

import {
  AvailabilityWindowStatus,
  CancellationPolicy,
  OfferingType,
  PropertyStatus,
  ReservationStatus,
} from '@homiio/shared-types';
import { getDb } from '../db/postgres';
import {
  computeNights,
  createReservation as createReservationRow,
  findReservationById,
  isReservationStatus,
  listAvailabilityWindows,
  listConfirmedStays,
  listReservations,
  lockReservationById,
  serializeReservation,
  transitionReservation,
  type ReservationRow,
} from '../db/bookings/reservationReads';
import { findOccupancyConflict, type OccupancyConflict } from '../db/availability/occupancy';
import { listConfirmedExchangeStays } from '../db/exchanges/exchangeReads';
import {
  findPropertyBookingBasis,
  lockPropertyBookingBases,
  type PropertyBookingBasis,
} from '../db/properties/propertyBookingBasis';
import type { RESERVATION_CANCELLATION_POLICIES } from '../db/schema/bookings';
import { logger } from '../middlewares/logging';
import { AppError } from '../middlewares/errorHandler';
import { externalListingOutcome, type ExternalListingOutcome } from './bookingOutcomes';

export type ReservationDto = Record<string, unknown>;

/** Default currency used when a short-term block somehow lacks one. */
const DEFAULT_CURRENCY = 'EUR';
/** Percentage divisor for the taxes computation. */
const PERCENT = 100;
/** Rounding factor for currency amounts (2 decimal places). */
const CURRENCY_ROUNDING = 100;

/** A property carries the short-term-rent offering (vacation-bookable). */
function isVacationBookable(property: PropertyBookingBasis): boolean {
  return property.offerings.includes(OfferingType.SHORT_TERM_RENT);
}

/** The priced stay, derived from the listing's short-term block. */
interface StayQuote {
  readonly nightlyRate: number;
  readonly subtotal: number;
  readonly cleaningFee: number;
  readonly serviceFee: number;
  readonly taxes: number;
  readonly total: number;
  readonly currency: string;
}

/**
 * Price a stay from the listing, and from NOTHING else.
 *
 * One function so the create path and the confirm path cannot disagree about
 * what the listing costs — the confirm path re-runs it against the row it holds
 * locked and compares the result to what the guest was quoted. A second copy of
 * this arithmetic is how a host's price change becomes an argument.
 *
 * `null` when the listing carries no nightly rate, which
 * `properties_offerings_short_term_rent_check` makes equivalent to not being
 * offered for short stays at all.
 */
function quoteStay(property: PropertyBookingBasis, nights: number): StayQuote | null {
  const nightlyRate = property.shortTermRentNightlyRate;
  if (nightlyRate === null || nightlyRate <= 0) return null;

  const subtotal = nightlyRate * nights;
  const cleaningFee = property.shortTermRentCleaningFee ?? 0;
  const serviceFee = property.shortTermRentServiceFee ?? 0;
  const taxesPercent = property.shortTermRentTaxesPercent ?? 0;
  const taxes =
    Math.round(
      (subtotal + cleaningFee + serviceFee) * (taxesPercent / PERCENT) * CURRENCY_ROUNDING,
    ) / CURRENCY_ROUNDING;
  const total =
    Math.round((subtotal + cleaningFee + serviceFee + taxes) * CURRENCY_ROUNDING) /
    CURRENCY_ROUNDING;

  return {
    nightlyRate,
    subtotal,
    cleaningFee,
    serviceFee,
    taxes,
    total,
    currency: (property.shortTermRentCurrency || DEFAULT_CURRENCY).toUpperCase(),
  };
}

/** Does the booking still carry the price the listing charges today? */
function quoteMatches(reservation: ReservationRow, quote: StayQuote): boolean {
  return (
    reservation.nightlyRate === quote.nightlyRate &&
    reservation.subtotal === quote.subtotal &&
    reservation.cleaningFee === quote.cleaningFee &&
    reservation.serviceFee === quote.serviceFee &&
    reservation.taxes === quote.taxes &&
    reservation.total === quote.total &&
    reservation.currency === quote.currency
  );
}

/**
 * The refusal for whatever is already holding the dates.
 *
 * A confirmed swap reports `DATE_CONFLICT` with its own message rather than a
 * fourth code: to the guest it is the same fact — the home is taken — and the
 * message is what says by what.
 */
function occupancyError(conflict: OccupancyConflict): AppError {
  switch (conflict.kind) {
    case 'reservation':
      return new AppError(
        'Selected dates conflict with an existing reservation',
        409,
        'DATE_CONFLICT',
      );
    case 'exchange':
      return new AppError(
        'Selected dates conflict with a confirmed home exchange',
        409,
        'DATE_CONFLICT',
      );
    default:
      return new AppError(
        'Selected dates are blocked by the host calendar',
        409,
        'BLOCKED_BY_HOST',
      );
  }
}

/**
 * Apply cancellation policy to decide whether the guest may still cancel.
 *
 * Simple Airbnb-like rules based on hours-until-checkin:
 *   flexible:     allowed any time before checkIn
 *   moderate:     allowed >= 5 days before checkIn
 *   strict:       allowed >= 7 days before checkIn
 *   super_strict: allowed >= 30 days before checkIn
 *
 * For already-pending reservations (not yet confirmed by host) the guest can
 * always cancel.
 */
function canGuestCancel(reservation: ReservationRow, now: Date): boolean {
  if (reservation.status === ReservationStatus.PENDING) return true;
  if (reservation.status !== ReservationStatus.CONFIRMED) return false;
  const hoursUntil = (reservation.checkIn.getTime() - now.getTime()) / (1000 * 60 * 60);
  switch (reservation.cancellationPolicy) {
    case CancellationPolicy.FLEXIBLE:
      return hoursUntil > 0;
    case CancellationPolicy.MODERATE:
      return hoursUntil >= 24 * 5;
    case CancellationPolicy.STRICT:
      return hoursUntil >= 24 * 7;
    case CancellationPolicy.SUPER_STRICT:
      return hoursUntil >= 24 * 30;
    default:
      return hoursUntil > 0;
  }
}

const INVALID_DECISION_STATE = 'Only pending reservations can be approved or declined';

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateReservationInput {
  readonly propertyId: unknown;
  readonly checkIn: unknown;
  readonly checkOut: unknown;
  readonly guestCount: unknown;
  readonly specialRequests?: unknown;
}

export type CreateReservationOutcome =
  | { readonly status: 'created'; readonly reservation: ReservationDto }
  | ExternalListingOutcome;

/**
 * Book a short stay as the guest. Auto-confirms when the listing has instant
 * book. An EXTERNAL listing is never booked: the outcome is its own link.
 */
export async function createReservation(
  oxyUserId: string,
  input: CreateReservationInput,
): Promise<CreateReservationOutcome> {
  const { propertyId, checkIn, checkOut, guestCount, specialRequests } = input;

  // Parse + validate the date window. Nothing here reads the database, so it
  // is settled before a transaction is opened.
  const checkInDate = new Date(checkIn as string);
  const checkOutDate = new Date(checkOut as string);
  if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) {
    throw new AppError('Invalid check-in or check-out date', 400, 'INVALID_DATE');
  }
  const now = new Date();
  if (checkInDate.getTime() <= now.getTime()) {
    throw new AppError('Check-in must be in the future', 400, 'DATE_IN_PAST');
  }

  const nights = computeNights(checkInDate, checkOutDate);
  if (nights < 1) throw new AppError('Reservation must be at least 1 night', 400, 'INVALID_RANGE');

  const stay = { start: checkInDate, end: checkOutDate };
  const listingId = String(propertyId);

  /**
   * Everything that decides the booking happens with the LISTING LOCKED.
   *
   * The old shape read the property, checked the calendar, priced the stay from
   * the row it had read minutes of wall-clock earlier, and inserted — four
   * statements, no transaction. Two guests asking for the same nights both saw
   * an empty calendar and both got a room, and a host who changed the nightly
   * rate in between was bound by the number the first read happened to see.
   *
   * The lock is on the `properties` row: the booking's own row does not exist
   * yet, so it is the only thing two concurrent requests share.
   */
  const outcome = await getDb().transaction(async (tx) => {
    const property = (await lockPropertyBookingBases(tx, [listingId])).get(listingId);
    if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');
    if (property.status !== PropertyStatus.PUBLISHED) {
      throw new AppError('Property is not available for booking', 400, 'PROPERTY_NOT_BOOKABLE');
    }
    if (property.isExternal) return { external: await externalListingOutcome(tx, listingId) };
    if (!isVacationBookable(property)) {
      throw new AppError(
        'This property is not offered for short-term booking',
        400,
        'NOT_VACATION_BOOKABLE',
      );
    }

    const hostOxyUserId = property.oxyUserId;
    if (!hostOxyUserId) throw new AppError('Property has no host', 400, 'INVALID_PROPERTY');
    if (hostOxyUserId === oxyUserId) {
      throw new AppError('You cannot book your own property', 403, 'FORBIDDEN');
    }

    // Min/max stay, from the short-term block.
    if (property.shortTermRentMinNights && nights < property.shortTermRentMinNights) {
      throw new AppError(
        `Minimum stay is ${property.shortTermRentMinNights} night(s)`,
        400,
        'BELOW_MIN_STAY',
      );
    }
    if (property.shortTermRentMaxNights && nights > property.shortTermRentMaxNights) {
      throw new AppError(
        `Maximum stay is ${property.shortTermRentMaxNights} night(s)`,
        400,
        'ABOVE_MAX_STAY',
      );
    }

    // Guest capacity, from the row we hold — not from one read earlier.
    const cappedMaxGuests = property.maxGuests || 1;
    if ((guestCount as number) > cappedMaxGuests) {
      throw new AppError(
        `Property accepts at most ${cappedMaxGuests} guest(s)`,
        400,
        'TOO_MANY_GUESTS',
      );
    }

    // Is the DWELLING free? Reservations, confirmed exchanges and the host
    // calendar, in one question — `db/availability/occupancy.ts`.
    const conflict = await findOccupancyConflict(tx, listingId, stay);
    if (conflict) throw occupancyError(conflict);

    // Priced from the locked row, so the quote is the listing's price at the
    // instant the booking is written.
    const quote = quoteStay(property, nights);
    if (!quote) throw new AppError('Property has no valid nightly rate', 400, 'NO_RATE');

    const cancellationPolicy = property.cancellationPolicy || CancellationPolicy.MODERATE;
    const instantBooked = property.shortTermRentInstantBook === true;
    const status = instantBooked ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;

    const reservation = await createReservationRow(tx, {
      propertyId: listingId,
      guestOxyUserId: oxyUserId,
      hostOxyUserId,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      guestCount: Number(guestCount),
      nights,
      ...quote,
      status,
      instantBooked,
      cancellationPolicy: cancellationPolicy as (typeof RESERVATION_CANCELLATION_POLICIES)[number],
      specialRequests: typeof specialRequests === 'string' ? specialRequests : undefined,
    });
    return { reservation, status, instantBooked };
  });

  if (outcome.external) return outcome.external;

  logger.info('Reservation created', {
    reservationId: outcome.reservation.id,
    propertyId: listingId,
    status: outcome.status,
    instantBooked: outcome.instantBooked,
  });
  return { status: 'created', reservation: serializeReservation(outcome.reservation) };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export interface ReservationPage {
  readonly page: number;
  readonly limit: number;
}

/** The route's paging: page ≥ 1, 1 ≤ limit ≤ 100, defaulting to 1 and 10. */
export function reservationPage(page: unknown, limit: unknown): ReservationPage {
  return {
    page: Math.max(1, parseInt(String(page ?? 1), 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(String(limit ?? 10), 10) || 10)),
  };
}

/** The account's reservations as guest, or as host with `asHost`. */
export async function listMyReservations(
  oxyUserId: string,
  input: ReservationPage & { readonly status?: unknown; readonly asHost: boolean },
): Promise<ReservationPage & { readonly rows: ReservationDto[]; readonly total: number }> {
  const { page, limit, asHost } = input;
  const result = await listReservations(
    getDb(),
    {
      guestOxyUserId: asHost ? undefined : oxyUserId,
      hostOxyUserId: asHost ? oxyUserId : undefined,
      status: isReservationStatus(input.status) ? input.status : undefined,
    },
    { limit, offset: (page - 1) * limit },
  );
  return { page, limit, total: result.total, rows: result.rows.map(serializeReservation) };
}

/** One reservation, to its guest or its host. */
export async function getReservation(
  oxyUserId: string,
  input: { readonly reservationId: string },
): Promise<ReservationDto> {
  const reservation = await findReservationById(getDb(), input.reservationId);
  if (!reservation) throw new AppError('Reservation not found', 404, 'NOT_FOUND');
  const isGuest = reservation.guestOxyUserId === oxyUserId;
  const isHost = reservation.hostOxyUserId === oxyUserId;
  if (!isGuest && !isHost) {
    throw new AppError('Not authorized to view this reservation', 403, 'FORBIDDEN');
  }
  return serializeReservation(reservation);
}

// ── Transitions ─────────────────────────────────────────────────────────────

export interface ReservationTransitionOutcome {
  readonly reservation: ReservationDto;
  /** A cancel of a reservation that was already cancelled. */
  readonly alreadyCancelled: boolean;
}

/**
 * Move a reservation to `confirmed`, `declined` or `cancelled`.
 *
 *  - Host: pending -> confirmed | declined
 *  - Guest: any active -> cancelled (subject to cancellation policy)
 *  - Host: may always cancel.
 *
 * Every transition carries its permitted FROM set into the `UPDATE`'s own
 * predicate, so two hosts confirming at once cannot both succeed.
 */
export async function updateReservationStatus(
  oxyUserId: string,
  input: { readonly reservationId: string; readonly status: unknown },
): Promise<ReservationTransitionOutcome> {
  const { reservationId: id, status: nextStatus } = input;
  const db = getDb();
  const reservation = await findReservationById(db, id);
  if (!reservation) throw new AppError('Reservation not found', 404, 'NOT_FOUND');

  const isGuest = reservation.guestOxyUserId === oxyUserId;
  const isHost = reservation.hostOxyUserId === oxyUserId;
  if (!isGuest && !isHost) {
    throw new AppError('Not authorized to update this reservation', 403, 'FORBIDDEN');
  }

  const now = new Date();
  let updated: ReservationRow | undefined;

  if (nextStatus === ReservationStatus.CONFIRMED || nextStatus === ReservationStatus.DECLINED) {
    if (!isHost) throw new AppError('Only the host can approve or decline', 403, 'FORBIDDEN');
    if (reservation.status !== ReservationStatus.PENDING) {
      throw new AppError(INVALID_DECISION_STATE, 400, 'INVALID_STATE');
    }
    if (nextStatus === ReservationStatus.CONFIRMED) {
      /**
       * A confirm is a second decision, taken against a listing that has had
       * time to change — so it re-verifies the four things the create path
       * verified, inside ONE transaction, with the listing and the booking both
       * locked.
       */
      updated = await db.transaction(async (tx) => {
        // Property first, then the booking — the same order every booking path
        // takes, which is what keeps two of them from deadlocking.
        const property = (await lockPropertyBookingBases(tx, [reservation.propertyId])).get(
          reservation.propertyId,
        );
        if (!property) throw new AppError('Property no longer exists', 404, 'NOT_FOUND');

        const locked = await lockReservationById(tx, id);
        if (!locked) throw new AppError('Reservation not found', 404, 'NOT_FOUND');
        if (locked.status !== ReservationStatus.PENDING) {
          throw new AppError(INVALID_DECISION_STATE, 400, 'INVALID_STATE');
        }

        // DATES: a stay that has already begun cannot be accepted.
        if (locked.checkIn.getTime() <= Date.now()) {
          throw new AppError('This stay has already started', 409, 'DATE_IN_PAST');
        }

        // AVAILABILITY: confirmed stays only — a sibling PENDING request must
        // not veto the one the host is accepting — plus confirmed exchanges and
        // the host calendar.
        const conflict = await findOccupancyConflict(
          tx,
          locked.propertyId,
          { start: locked.checkIn, end: locked.checkOut },
          { reservationStatuses: [ReservationStatus.CONFIRMED], excludeReservationId: locked.id },
        );
        if (conflict) {
          throw conflict.kind === 'reservation'
            ? new AppError(
                'Another confirmed reservation now conflicts with this one',
                409,
                'DATE_CONFLICT',
              )
            : occupancyError(conflict);
        }

        // CAPACITY: against the listing as it stands now.
        const cappedMaxGuests = property.maxGuests || 1;
        if (locked.guestCount > cappedMaxGuests) {
          throw new AppError(
            `Property accepts at most ${cappedMaxGuests} guest(s)`,
            409,
            'TOO_MANY_GUESTS',
          );
        }

        // PRICE: the quote has to still BE the listing's price. If the host
        // has re-priced since the request, neither side should be held to the
        // other's number — the booking is refused and re-made at the price
        // both can see.
        const quote = quoteStay(property, locked.nights);
        if (!quote) throw new AppError('This property has no short-term pricing', 409, 'NO_RATE');
        if (!quoteMatches(locked, quote)) {
          throw new AppError(
            'The listing has been re-priced since this request',
            409,
            'PRICE_CHANGED',
          );
        }

        const confirmed = await transitionReservation(tx, id, nextStatus, [
          ReservationStatus.PENDING,
        ]);
        if (!confirmed) throw new AppError(INVALID_DECISION_STATE, 400, 'INVALID_STATE');
        return confirmed;
      });
    } else {
      updated = await transitionReservation(db, id, nextStatus, [ReservationStatus.PENDING]);
      if (!updated) throw new AppError(INVALID_DECISION_STATE, 400, 'INVALID_STATE');
    }
  } else if (nextStatus === ReservationStatus.CANCELLED) {
    if (reservation.status === ReservationStatus.CANCELLED) {
      return { reservation: serializeReservation(reservation), alreadyCancelled: true };
    }
    if (reservation.status === ReservationStatus.COMPLETED) {
      throw new AppError('Completed reservations cannot be cancelled', 400, 'INVALID_STATE');
    }
    // Host can always cancel; guest must satisfy the cancellation policy.
    if (isGuest && !isHost && !canGuestCancel(reservation, now)) {
      throw new AppError(
        'Cancellation policy does not permit cancellation at this time',
        403,
        'POLICY_FORBIDS_CANCEL',
      );
    }
    updated = await transitionReservation(db, id, ReservationStatus.CANCELLED, [
      ReservationStatus.PENDING,
      ReservationStatus.CONFIRMED,
      ReservationStatus.DECLINED,
    ]);
    if (!updated) {
      throw new AppError('Completed reservations cannot be cancelled', 400, 'INVALID_STATE');
    }
  } else {
    throw new AppError('Unsupported status transition', 400, 'INVALID_STATE');
  }

  logger.info('Reservation status updated', {
    reservationId: updated.id,
    nextStatus: updated.status,
    byHost: isHost,
    byGuest: isGuest,
  });
  return { reservation: serializeReservation(updated), alreadyCancelled: false };
}

// ── The public stay calendar ────────────────────────────────────────────────

/**
 * A listing's stay calendar — PUBLIC (`GET /api/properties/:id/availability`).
 *
 * **A date range and a status, and nothing else.** No guest, no host, no
 * reservation id, no price, no message, no exchange counterparty — a viewer
 * learns that the home is taken on those nights, which is what a calendar is
 * for, and learns nothing about who took it. Any field added here is
 * published to the anonymous internet; `publicAvailability.test.ts` asserts the
 * absence. It reads no account.
 */
export async function getListingAvailability(input: { readonly propertyId: string }) {
  const id = input.propertyId;
  const db = getDb();
  const property = await findPropertyBookingBasis(db, id);
  if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');

  const [windows, bookedStays, exchangeStays] = await Promise.all([
    listAvailabilityWindows(db, id),
    listConfirmedStays(db, id),
    listConfirmedExchangeStays(db, id),
  ]);

  return {
    propertyId: id,
    offerings: property.offerings,
    instantBook: property.shortTermRentInstantBook ?? false,
    cancellationPolicy: property.cancellationPolicy,
    minNights: property.shortTermRentMinNights,
    maxNights: property.shortTermRentMaxNights,
    maxGuests: property.maxGuests,
    // `{ start, end, status }` — the `AvailabilityWindow` contract exactly. The
    // row's own id is not part of that contract; on a public endpoint an
    // identifier nobody asked for is just a handle into the host's calendar.
    windows: windows.map((row) => ({ start: row.startsAt, end: row.endsAt, status: row.status })),
    // A confirmed swap takes the home for those nights exactly as a paid stay
    // does, so both appear here as `booked` and neither says which it was.
    booked: [
      ...bookedStays.map((stay) => ({
        start: stay.checkIn,
        end: stay.checkOut,
        status: AvailabilityWindowStatus.BOOKED,
      })),
      ...exchangeStays.map((stay) => ({
        start: stay.start,
        end: stay.end,
        status: AvailabilityWindowStatus.BOOKED,
      })),
    ],
  };
}
