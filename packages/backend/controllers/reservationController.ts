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

const { Property, Reservation, Profile } = require('../models');
const { logger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');
const { ReservationStatus, CancellationPolicy, RentMode, AvailabilityWindowStatus } = require('@homiio/shared-types');

const ACTIVE_RESERVATION_STATUSES = [ReservationStatus.PENDING, ReservationStatus.CONFIRMED];

/**
 * Compute nights between two dates (half-open: checkOut exclusive).
 */
function computeNights(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/**
 * Two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd AND bStart < aEnd.
 */
function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/**
 * Determine whether a property's availability windows BLOCK the requested
 * range. A request is blocked if any window with status `blocked` or `booked`
 * overlaps it.
 */
function isBlockedByWindows(windows: any[], checkIn: Date, checkOut: Date): boolean {
  if (!Array.isArray(windows) || windows.length === 0) return false;
  for (const window of windows) {
    if (window?.status === AvailabilityWindowStatus.AVAILABLE) continue;
    const wStart = window?.start instanceof Date ? window.start : new Date(window?.start);
    const wEnd = window?.end instanceof Date ? window.end : new Date(window?.end);
    if (Number.isNaN(wStart.getTime()) || Number.isNaN(wEnd.getTime())) continue;
    if (rangesOverlap(checkIn, checkOut, wStart, wEnd)) return true;
  }
  return false;
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
function canGuestCancel(reservation: any, now: Date): boolean {
  if (reservation.status === ReservationStatus.PENDING) return true;
  if (reservation.status !== ReservationStatus.CONFIRMED) return false;
  const checkIn: Date = reservation.checkIn instanceof Date ? reservation.checkIn : new Date(reservation.checkIn);
  const hoursUntil = (checkIn.getTime() - now.getTime()) / (1000 * 60 * 60);
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

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.status !== 'published' && property.status !== 'active') {
        return next(new AppError('Property is not available for booking', 400, 'PROPERTY_NOT_BOOKABLE'));
      }
      if (property.isExternal) {
        return next(new AppError('Cannot book external listings', 400, 'EXTERNAL_PROPERTY'));
      }
      if (property.rentMode === RentMode.LONG_TERM) {
        return next(new AppError('This property is long-term only and not bookable', 400, 'NOT_BOOKABLE'));
      }

      const guestProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!guestProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const hostProfileId = property.profileId;
      if (!hostProfileId) return next(new AppError('Property has no host profile', 400, 'INVALID_PROPERTY'));
      if (String(hostProfileId) === String(guestProfile._id)) {
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

      // Enforce min/max stay
      if (property.minStay && nights < property.minStay) {
        return next(new AppError(`Minimum stay is ${property.minStay} night(s)`, 400, 'BELOW_MIN_STAY'));
      }
      if (property.maxStay && nights > property.maxStay) {
        return next(new AppError(`Maximum stay is ${property.maxStay} night(s)`, 400, 'ABOVE_MAX_STAY'));
      }

      // Guest capacity
      const cappedMaxGuests = property.maxGuests || 1;
      if (guestCount > cappedMaxGuests) {
        return next(new AppError(`Property accepts at most ${cappedMaxGuests} guest(s)`, 400, 'TOO_MANY_GUESTS'));
      }

      // Conflict: existing active reservations on overlapping range
      const overlappingReservation = await Reservation.findOne({
        propertyId,
        status: { $in: ACTIVE_RESERVATION_STATUSES },
        checkIn: { $lt: checkOutDate },
        checkOut: { $gt: checkInDate }
      }).lean();
      if (overlappingReservation) {
        return next(new AppError('Selected dates conflict with an existing reservation', 409, 'DATE_CONFLICT'));
      }

      // Conflict: property availability windows
      if (isBlockedByWindows(property.availabilityWindows, checkInDate, checkOutDate)) {
        return next(new AppError('Selected dates are blocked by the host calendar', 409, 'BLOCKED_BY_HOST'));
      }

      // Pricing
      const nightlyRate = Number(property?.rent?.amount) || 0;
      if (nightlyRate <= 0) return next(new AppError('Property has no valid nightly rate', 400, 'NO_RATE'));
      const subtotal = nightlyRate * nights;
      const cleaningFee = Number(property?.priceBreakdown?.cleaningFee) || 0;
      const serviceFee = Number(property?.priceBreakdown?.serviceFee) || 0;
      const taxesPercent = Number(property?.priceBreakdown?.taxesPercent) || 0;
      const taxes = Math.round((subtotal + cleaningFee + serviceFee) * (taxesPercent / 100) * 100) / 100;
      const total = Math.round((subtotal + cleaningFee + serviceFee + taxes) * 100) / 100;
      const currency = (property?.rent?.currency || 'EUR').toUpperCase();

      const cancellationPolicy = property.cancellationPolicy || CancellationPolicy.MODERATE;
      const instantBooked = property.instantBook === true;
      const status = instantBooked ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;

      const reservation = await Reservation.create({
        propertyId,
        guestProfileId: guestProfile._id,
        hostProfileId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        guestCount,
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
        cancellationPolicy,
        specialRequests
      });

      logger.info('Reservation created', {
        reservationId: String(reservation._id),
        propertyId: String(propertyId),
        status,
        instantBooked
      });

      res.status(201).json(successResponse(reservation.toJSON(), 'Reservation created'));
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

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return res.json(paginationResponse([], 1, 10, 0, 'No profile found for user'));

      const query: Record<string, unknown> = {};
      if (String(asHost) === 'true') {
        query.hostProfileId = activeProfile._id;
      } else {
        query.guestProfileId = activeProfile._id;
      }
      if (status) query.status = status;

      const pageNumber = Math.max(1, parseInt(String(page)) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total] = await Promise.all([
        Reservation.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        Reservation.countDocuments(query)
      ]);

      res.json(paginationResponse(items, pageNumber, limitNumber, total, 'Reservations retrieved'));
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

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const reservation = await Reservation.findById(id).lean();
      if (!reservation) return next(new AppError('Reservation not found', 404, 'NOT_FOUND'));

      const isGuest = String(reservation.guestProfileId) === String(activeProfile._id);
      const isHost = String(reservation.hostProfileId) === String(activeProfile._id);
      if (!isGuest && !isHost) return next(new AppError('Not authorized to view this reservation', 403, 'FORBIDDEN'));

      res.json(successResponse(reservation, 'Reservation retrieved'));
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

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const reservation = await Reservation.findById(id);
      if (!reservation) return next(new AppError('Reservation not found', 404, 'NOT_FOUND'));

      const isGuest = String(reservation.guestProfileId) === String(activeProfile._id);
      const isHost = String(reservation.hostProfileId) === String(activeProfile._id);
      if (!isGuest && !isHost) return next(new AppError('Not authorized to update this reservation', 403, 'FORBIDDEN'));

      const now = new Date();

      if (nextStatus === ReservationStatus.CONFIRMED || nextStatus === ReservationStatus.DECLINED) {
        if (!isHost) return next(new AppError('Only the host can approve or decline', 403, 'FORBIDDEN'));
        if (reservation.status !== ReservationStatus.PENDING) {
          return next(new AppError('Only pending reservations can be approved or declined', 400, 'INVALID_STATE'));
        }
        if (nextStatus === ReservationStatus.CONFIRMED) {
          // Re-check conflicts before confirming.
          const overlapping = await Reservation.findOne({
            _id: { $ne: reservation._id },
            propertyId: reservation.propertyId,
            status: ReservationStatus.CONFIRMED,
            checkIn: { $lt: reservation.checkOut },
            checkOut: { $gt: reservation.checkIn }
          }).lean();
          if (overlapping) {
            return next(new AppError('Another confirmed reservation now conflicts with this one', 409, 'DATE_CONFLICT'));
          }
        }
        reservation.status = nextStatus;
      } else if (nextStatus === ReservationStatus.CANCELLED) {
        if (!isGuest && !isHost) return next(new AppError('Not authorized to cancel', 403, 'FORBIDDEN'));
        if (reservation.status === ReservationStatus.CANCELLED) {
          return res.json(successResponse(reservation.toJSON(), 'Reservation already cancelled'));
        }
        if (reservation.status === ReservationStatus.COMPLETED) {
          return next(new AppError('Completed reservations cannot be cancelled', 400, 'INVALID_STATE'));
        }
        // Host can always cancel; guest must satisfy the cancellation policy.
        if (isGuest && !isHost && !canGuestCancel(reservation, now)) {
          return next(new AppError('Cancellation policy does not permit cancellation at this time', 403, 'POLICY_FORBIDS_CANCEL'));
        }
        reservation.status = ReservationStatus.CANCELLED;
      } else {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      await reservation.save();
      logger.info('Reservation status updated', {
        reservationId: String(reservation._id),
        nextStatus: reservation.status,
        byHost: isHost,
        byGuest: isGuest
      });

      res.json(successResponse(reservation.toJSON(), 'Reservation updated'));
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
      const property = await Property.findById(id)
        .select('availabilityWindows minStay maxStay maxGuests rentMode instantBook cancellationPolicy')
        .lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const bookedReservations = await Reservation.find({
        propertyId: id,
        status: ReservationStatus.CONFIRMED
      })
        .select('checkIn checkOut')
        .sort({ checkIn: 1 })
        .lean();

      const bookedRanges = bookedReservations.map((reservation: any) => ({
        start: reservation.checkIn,
        end: reservation.checkOut,
        status: AvailabilityWindowStatus.BOOKED
      }));

      const data = {
        propertyId: id,
        rentMode: property.rentMode,
        instantBook: property.instantBook,
        cancellationPolicy: property.cancellationPolicy,
        minStay: property.minStay,
        maxStay: property.maxStay,
        maxGuests: property.maxGuests,
        windows: property.availabilityWindows || [],
        booked: bookedRanges
      };

      res.json(successResponse(data, 'Availability retrieved'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReservationController();
