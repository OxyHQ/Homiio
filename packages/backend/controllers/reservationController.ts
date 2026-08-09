/**
 * Reservation Controller
 *
 * Handles the vacation/short-term booking lifecycle (Airbnb-style).
 *
 * Distinct from:
 *  - `ViewingRequest` (in-person tour for the long-term rent flow)
 *  - `Lease`           (signed long-term contract)
 *  - `TenantApplication` (application that precedes a Lease)
 *
 * A Reservation transitions: pending -> confirmed | declined | cancelled
 * and confirmed -> cancelled | completed.
 */

import { getDb } from '../db/postgres';
import {
  computeNights,
  createReservation,
  findBlockingWindow,
  findOverlappingReservation,
  findReservationById,
  isReservationStatus,
  listAvailabilityWindows,
  listConfirmedStays,
  listReservations,
  serializeReservation,
  transitionReservation,
  type ReservationRow,
} from '../db/bookings/reservationReads';
import {
  findPropertyBookingBasis,
  type PropertyBookingBasis,
} from '../db/properties/propertyBookingBasis';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { ReservationStatus, PropertyStatus, CancellationPolicy, OfferingType, AvailabilityWindowStatus } from '@homiio/shared-types';
import { RESERVATION_CANCELLATION_POLICIES } from '../db/schema/bookings';

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

/**
 * Apply cancellation policy to decide whether the guest may still cancel.
 *
 * Simple Airbnb-like rules based on hours-until-checkin:
 *   flexible:     allowed any time before checkIn
 *   moderate:     allowed >= 5 days before checkIn
 *   strict:       allowed >= 7 days before checkIn
 *   super_strict: allowed >= 30 days before checkIn
 *
 * For already-pending reservations (not yet confirmed by host) the guest
 * can always cancel.
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

class ReservationController {
  /**
   * POST /api/reservations
   * Guest creates a reservation. Auto-confirms if property has instantBook.
   */
  async createReservation(req: any, res: any, next: any) {
    try {
      const { propertyId, checkIn, checkOut, guestCount, specialRequests } = req.body;

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const property = await findPropertyBookingBasis(db, String(propertyId));
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.status !== PropertyStatus.PUBLISHED) {
        return next(new AppError('Property is not available for booking', 400, 'PROPERTY_NOT_BOOKABLE'));
      }
      if (property.isExternal) {
        return next(new AppError('Cannot book external listings', 400, 'EXTERNAL_PROPERTY'));
      }
      if (!isVacationBookable(property)) {
        return next(new AppError('This property is not offered for short-term booking', 400, 'NOT_VACATION_BOOKABLE'));
      }
      // `properties_offerings_short_term_rent_check` makes the offering exactly
      // the presence of `nightly_rate`, so this narrowing is unreachable through
      // a valid listing — it stays because it is also what turns
      // `number | null` into `number` for the pricing below.
      const nightlyRate = property.shortTermRentNightlyRate;
      if (nightlyRate === null) {
        return next(new AppError('This property has no short-term pricing', 400, 'NOT_VACATION_BOOKABLE'));
      }

      const hostOxyUserId = property.oxyUserId;
      if (!hostOxyUserId) return next(new AppError('Property has no host', 400, 'INVALID_PROPERTY'));
      if (hostOxyUserId === oxyUserId) {
        return next(new AppError('You cannot book your own property', 403, 'FORBIDDEN'));
      }

      // Parse + validate date window
      const checkInDate = new Date(checkIn);
      const checkOutDate = new Date(checkOut);
      if (Number.isNaN(checkInDate.getTime()) || Number.isNaN(checkOutDate.getTime())) {
        return next(new AppError('Invalid check-in or check-out date', 400, 'INVALID_DATE'));
      }
      const now = new Date();
      if (checkInDate.getTime() <= now.getTime()) {
        return next(new AppError('Check-in must be in the future', 400, 'DATE_IN_PAST'));
      }

      const nights = computeNights(checkInDate, checkOutDate);
      if (nights < 1) return next(new AppError('Reservation must be at least 1 night', 400, 'INVALID_RANGE'));

      // Enforce min/max stay (from the short-term block)
      if (property.shortTermRentMinNights && nights < property.shortTermRentMinNights) {
        return next(new AppError(`Minimum stay is ${property.shortTermRentMinNights} night(s)`, 400, 'BELOW_MIN_STAY'));
      }
      if (property.shortTermRentMaxNights && nights > property.shortTermRentMaxNights) {
        return next(new AppError(`Maximum stay is ${property.shortTermRentMaxNights} night(s)`, 400, 'ABOVE_MAX_STAY'));
      }

      // Guest capacity
      const cappedMaxGuests = property.maxGuests || 1;
      if (guestCount > cappedMaxGuests) {
        return next(new AppError(`Property accepts at most ${cappedMaxGuests} guest(s)`, 400, 'TOO_MANY_GUESTS'));
      }

      const stay = { checkIn: checkInDate, checkOut: checkOutDate };

      // Conflict: an existing active reservation overlaps. A range overlap now,
      // half-open — see `db/bookings/reservationReads.ts`.
      const overlappingReservation = await findOverlappingReservation(db, String(propertyId), stay);
      if (overlappingReservation) {
        return next(new AppError('Selected dates conflict with an existing reservation', 409, 'DATE_CONFLICT'));
      }

      // Conflict: a host calendar window blocks it. Also a range overlap, where
      // it used to load every window and overlap in JavaScript.
      if (await findBlockingWindow(db, String(propertyId), stay)) {
        return next(new AppError('Selected dates are blocked by the host calendar', 409, 'BLOCKED_BY_HOST'));
      }

      // Pricing — all from the short-term block (NOT a monthly figure).
      if (nightlyRate <= 0) return next(new AppError('Property has no valid nightly rate', 400, 'NO_RATE'));
      const subtotal = nightlyRate * nights;
      const cleaningFee = property.shortTermRentCleaningFee ?? 0;
      const serviceFee = property.shortTermRentServiceFee ?? 0;
      const taxesPercent = property.shortTermRentTaxesPercent ?? 0;
      const taxes = Math.round((subtotal + cleaningFee + serviceFee) * (taxesPercent / PERCENT) * CURRENCY_ROUNDING) / CURRENCY_ROUNDING;
      const total = Math.round((subtotal + cleaningFee + serviceFee + taxes) * CURRENCY_ROUNDING) / CURRENCY_ROUNDING;
      const currency = (property.shortTermRentCurrency || DEFAULT_CURRENCY).toUpperCase();

      const cancellationPolicy = property.cancellationPolicy || CancellationPolicy.MODERATE;
      const instantBooked = property.shortTermRentInstantBook === true;
      const status = instantBooked ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;

      const reservation = await createReservation(db, {
        propertyId: String(propertyId),
        guestOxyUserId: oxyUserId,
        hostOxyUserId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        guestCount: Number(guestCount),
        nights,
        nightlyRate,
        subtotal,
        cleaningFee,
        serviceFee,
        taxes,
        total,
        currency,
        status,
        instantBooked,
        cancellationPolicy: cancellationPolicy as (typeof RESERVATION_CANCELLATION_POLICIES)[number],
        specialRequests: typeof specialRequests === 'string' ? specialRequests : undefined,
      });

      logger.info('Reservation created', {
        reservationId: reservation.id,
        propertyId: String(propertyId),
        status,
        instantBooked
      });

      res.status(201).json(successResponse(serializeReservation(reservation), 'Reservation created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/reservations
   * List my reservations. Filter by role with ?asHost=true; otherwise as guest.
   */
  async listMyReservations(req: any, res: any, next: any) {
    try {
      const { page = 1, limit = 10, status, asHost } = req.query;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const pageNumber = Math.max(1, parseInt(String(page)) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));
      const skip = (pageNumber - 1) * limitNumber;

      const asHostView = String(asHost) === 'true';
      const result = await listReservations(
        getDb(),
        {
          guestOxyUserId: asHostView ? undefined : oxyUserId,
          hostOxyUserId: asHostView ? oxyUserId : undefined,
          status: isReservationStatus(status) ? status : undefined,
        },
        { limit: limitNumber, offset: skip },
      );

      res.json(paginationResponse(result.rows.map(serializeReservation), pageNumber, limitNumber, result.total, 'Reservations retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/reservations/:id
   */
  async getReservationById(req: any, res: any, next: any) {
    try {
      const { id } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const reservation = await findReservationById(getDb(), id);
      if (!reservation) return next(new AppError('Reservation not found', 404, 'NOT_FOUND'));

      const isGuest = reservation.guestOxyUserId === oxyUserId;
      const isHost = reservation.hostOxyUserId === oxyUserId;
      if (!isGuest && !isHost) return next(new AppError('Not authorized to view this reservation', 403, 'FORBIDDEN'));

      res.json(successResponse(serializeReservation(reservation), 'Reservation retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/reservations/:id
   *   - Host: pending -> confirmed | declined
   *   - Guest: any active -> cancelled (subject to cancellation policy)
   */
  async updateReservationStatus(req: any, res: any, next: any) {
    try {
      const { id } = req.params;
      const { status: nextStatus } = req.body;

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const reservation = await findReservationById(db, id);
      if (!reservation) return next(new AppError('Reservation not found', 404, 'NOT_FOUND'));

      const isGuest = reservation.guestOxyUserId === oxyUserId;
      const isHost = reservation.hostOxyUserId === oxyUserId;
      if (!isGuest && !isHost) return next(new AppError('Not authorized to update this reservation', 403, 'FORBIDDEN'));

      const now = new Date();
      // Every transition carries its permitted FROM set into the `UPDATE`'s own
      // predicate, so two hosts confirming at once cannot both succeed.
      let updated: ReservationRow | undefined;

      if (nextStatus === ReservationStatus.CONFIRMED || nextStatus === ReservationStatus.DECLINED) {
        if (!isHost) return next(new AppError('Only the host can approve or decline', 403, 'FORBIDDEN'));
        if (reservation.status !== ReservationStatus.PENDING) {
          return next(new AppError('Only pending reservations can be approved or declined', 400, 'INVALID_STATE'));
        }
        if (nextStatus === ReservationStatus.CONFIRMED) {
          // Re-check conflicts before committing, against CONFIRMED stays only
          // and excluding this one so it never collides with itself.
          const overlapping = await findOverlappingReservation(
            db,
            reservation.propertyId,
            { checkIn: reservation.checkIn, checkOut: reservation.checkOut },
            { statuses: [ReservationStatus.CONFIRMED], excludeId: reservation.id },
          );
          if (overlapping) {
            return next(new AppError('Another confirmed reservation now conflicts with this one', 409, 'DATE_CONFLICT'));
          }
        }
        updated = await transitionReservation(db, id, nextStatus, [ReservationStatus.PENDING]);
        if (!updated) {
          return next(new AppError('Only pending reservations can be approved or declined', 400, 'INVALID_STATE'));
        }
      } else if (nextStatus === ReservationStatus.CANCELLED) {
        if (reservation.status === ReservationStatus.CANCELLED) {
          return res.json(successResponse(serializeReservation(reservation), 'Reservation already cancelled'));
        }
        if (reservation.status === ReservationStatus.COMPLETED) {
          return next(new AppError('Completed reservations cannot be cancelled', 400, 'INVALID_STATE'));
        }
        // Host can always cancel; guest must satisfy the cancellation policy.
        if (isGuest && !isHost && !canGuestCancel(reservation, now)) {
          return next(new AppError('Cancellation policy does not permit cancellation at this time', 403, 'POLICY_FORBIDS_CANCEL'));
        }
        updated = await transitionReservation(db, id, ReservationStatus.CANCELLED, [
          ReservationStatus.PENDING,
          ReservationStatus.CONFIRMED,
          ReservationStatus.DECLINED,
        ]);
        if (!updated) {
          return next(new AppError('Completed reservations cannot be cancelled', 400, 'INVALID_STATE'));
        }
      } else {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      logger.info('Reservation status updated', {
        reservationId: updated.id,
        nextStatus: updated.status,
        byHost: isHost,
        byGuest: isGuest
      });

      res.json(successResponse(serializeReservation(updated), 'Reservation updated'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/properties/:id/availability
   * Returns host-defined availability windows plus a derived list of booked
   * date ranges (computed from confirmed reservations).
   */
  async getPropertyAvailability(req: any, res: any, next: any) {
    try {
      const { id } = req.params;
      const db = getDb();
      const property = await findPropertyBookingBasis(db, id);
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const [windows, bookedStays] = await Promise.all([
        listAvailabilityWindows(db, id),
        listConfirmedStays(db, id),
      ]);

      const data = {
        propertyId: id,
        offerings: property.offerings,
        instantBook: property.shortTermRentInstantBook ?? false,
        cancellationPolicy: property.cancellationPolicy,
        minNights: property.shortTermRentMinNights,
        maxNights: property.shortTermRentMaxNights,
        maxGuests: property.maxGuests,
        // Re-nested to the wire shape: `start`/`end` where the columns are
        // `starts_at`/`ends_at` (renamed because `end` is a reserved word).
        windows: windows.map((row) => ({
          id: row.id,
          start: row.startsAt,
          end: row.endsAt,
          status: row.status,
        })),
        booked: bookedStays.map((stay) => ({
          start: stay.checkIn,
          end: stay.checkOut,
          status: AvailabilityWindowStatus.BOOKED,
        })),
      };

      res.json(successResponse(data, 'Availability retrieved'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ReservationController();
