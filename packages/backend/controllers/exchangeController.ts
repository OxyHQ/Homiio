/**
 * Exchange Controller
 *
 * Handles the home-exchange lifecycle (Couchsurfing-style):
 *  - SWAP: reciprocal home swap (each party stays in the other's home)
 *  - HOST: one-way free hosting (guest stays, no reciprocity)
 *
 * Operates only on listings carrying the EXCHANGE intent. Distinct from:
 *  - `Reservation`     (paid vacation booking — Airbnb-style)
 *  - `ViewingRequest`  (in-person tour for the long-term rent flow)
 *  - `Lease`           (signed long-term contract)
 *
 * An ExchangeRequest transitions: pending -> confirmed | declined | cancelled
 * and pending|confirmed -> cancelled, and confirmed -> completed.
 * Mirrors `reservationController` for structure, auth and error conventions.
 */

import type { Request, Response, NextFunction } from 'express';
import type {
  CreateExchangeRequestData,
  UpdateExchangeRequestData,
  ExchangeWindow,
} from '@homiio/shared-types';

const { Property, ExchangeRequest, Profile } = require('../models');
const { logger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');
const { ExchangeMode, ExchangeRequestStatus, ListingIntent } = require('@homiio/shared-types');
const { Types } = require('mongoose');
const { windowsOverlap } = require('../utils/availabilityUtils');

// ---- Tunable constants (no magic numbers / strings inline) ----
/** Default page size for list endpoints. */
const DEFAULT_PAGE_SIZE = 10;
/** Hard cap on page size to protect the database. */
const MAX_PAGE_SIZE = 100;
/** Statuses that occupy the calendar and therefore block an overlapping request. */
const BLOCKING_EXCHANGE_STATUSES = [ExchangeRequestStatus.CONFIRMED];

/**
 * Whether a listing's configured exchange `mode` accepts a request of the given
 * `requestedMode`. A `both` listing accepts swap OR host; a `swap` listing only
 * accepts swap; a `host` listing only accepts host. A request mode of `both` is
 * not a concrete request and is never acceptable.
 */
function modeAccepts(listingMode: string, requestedMode: string): boolean {
  if (requestedMode !== ExchangeMode.SWAP && requestedMode !== ExchangeMode.HOST) {
    return false;
  }
  if (listingMode === ExchangeMode.BOTH) {
    return true;
  }
  return listingMode === requestedMode;
}

/** A property carries the EXCHANGE intent (empty/missing intents read as rent-only). */
function hasExchangeIntent(property: { intents?: unknown }): boolean {
  return Array.isArray(property.intents) && property.intents.includes(ListingIntent.EXCHANGE);
}

/** Parse + validate a requested/offered window into concrete Dates. Returns null if malformed. */
function parseWindow(window: ExchangeWindow | undefined): { start: Date; end: Date } | null {
  if (!window || !window.start || !window.end) {
    return null;
  }
  const start = new Date(window.start);
  const end = new Date(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }
  if (start.getTime() >= end.getTime()) {
    return null;
  }
  return { start, end };
}

function resolveOxyUserId(req: Request): string | undefined {
  const user = (req as Request & { user?: { id?: string; _id?: string }; userId?: string });
  return user.user?.id || user.user?._id || user.userId;
}

class ExchangeController {
  /**
   * POST /api/exchanges
   * Requester proposes a swap or hosting stay against an EXCHANGE listing.
   */
  async createExchangeRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as CreateExchangeRequestData;
      const { propertyId, mode, offeredPropertyId, requestedWindow, offeredWindow, message } = body;

      const oxyUserId = resolveOxyUserId(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      if (!Types.ObjectId.isValid(propertyId)) {
        return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
      }
      if (mode !== ExchangeMode.SWAP && mode !== ExchangeMode.HOST) {
        return next(new AppError('Exchange mode must be "swap" or "host"', 400, 'INVALID_MODE'));
      }

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.isExternal) {
        return next(new AppError('Cannot request an exchange on external listings', 400, 'EXTERNAL_PROPERTY'));
      }
      if (!hasExchangeIntent(property)) {
        return next(new AppError('This property is not open to home exchange', 400, 'NOT_EXCHANGEABLE'));
      }
      const listingMode = property.exchange?.mode;
      if (!listingMode || !modeAccepts(listingMode, mode)) {
        return next(new AppError(`This listing does not accept "${mode}" exchanges`, 400, 'MODE_NOT_ACCEPTED'));
      }

      const requesterProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!requesterProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const hostProfileId = property.profileId;
      if (!hostProfileId) return next(new AppError('Property has no host profile', 400, 'INVALID_PROPERTY'));
      if (String(hostProfileId) === String(requesterProfile._id)) {
        return next(new AppError('You cannot request an exchange with your own property', 403, 'FORBIDDEN'));
      }

      // Validate requested window: start < end, in the future.
      const requested = parseWindow(requestedWindow);
      if (!requested) {
        return next(new AppError('Invalid requested window', 400, 'INVALID_WINDOW'));
      }
      const now = new Date();
      if (requested.start.getTime() <= now.getTime()) {
        return next(new AppError('Requested window must start in the future', 400, 'DATE_IN_PAST'));
      }

      // SWAP requires a verified offered property + offered window; HOST clears them.
      let resolvedOfferedPropertyId: unknown;
      let resolvedOfferedWindow: { start: Date; end: Date } | undefined;
      if (mode === ExchangeMode.SWAP) {
        if (!offeredPropertyId) {
          return next(new AppError('A swap requires an offered property', 400, 'OFFERED_PROPERTY_REQUIRED'));
        }
        if (!Types.ObjectId.isValid(offeredPropertyId)) {
          return next(new AppError('Invalid offered property ID', 400, 'INVALID_ID'));
        }
        const offeredProperty = await Property.findById(offeredPropertyId).lean();
        if (!offeredProperty) return next(new AppError('Offered property not found', 404, 'NOT_FOUND'));
        if (String(offeredProperty.profileId) !== String(requesterProfile._id)) {
          return next(new AppError('Offered property does not belong to you', 403, 'FORBIDDEN'));
        }
        if (!hasExchangeIntent(offeredProperty)) {
          return next(new AppError('Offered property is not open to home exchange', 400, 'OFFERED_NOT_EXCHANGEABLE'));
        }
        const offered = parseWindow(offeredWindow);
        if (!offered) {
          return next(new AppError('A swap requires a valid offered window', 400, 'OFFERED_WINDOW_REQUIRED'));
        }
        resolvedOfferedPropertyId = offeredProperty._id;
        resolvedOfferedWindow = offered;
      }

      // Conflict: an already-CONFIRMED exchange on this property overlapping the
      // requested window. (Pending requests do not block — only committed ones.)
      const confirmedExchanges = await ExchangeRequest.find({
        propertyId,
        status: { $in: BLOCKING_EXCHANGE_STATUSES },
      })
        .select('requestedWindow')
        .lean();

      const conflict = confirmedExchanges.some((existing: { requestedWindow?: ExchangeWindow }) => {
        if (!existing.requestedWindow) return false;
        const other = parseWindow(existing.requestedWindow);
        if (!other) return false;
        return windowsOverlap(requested.start, requested.end, other.start, other.end);
      });
      if (conflict) {
        return next(new AppError('Requested dates conflict with a confirmed exchange', 409, 'DATE_CONFLICT'));
      }

      const exchangeRequest = await ExchangeRequest.create({
        propertyId,
        requesterProfileId: requesterProfile._id,
        hostProfileId,
        mode,
        offeredPropertyId: mode === ExchangeMode.SWAP ? resolvedOfferedPropertyId : undefined,
        requestedWindow: requested,
        offeredWindow: mode === ExchangeMode.SWAP ? resolvedOfferedWindow : undefined,
        message,
        status: ExchangeRequestStatus.PENDING,
      });

      logger.info('Exchange request created', {
        exchangeRequestId: String(exchangeRequest._id),
        propertyId: String(propertyId),
        mode,
      });

      res.status(201).json(successResponse(exchangeRequest.toJSON(), 'Exchange request created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/exchanges
   * List my exchange requests. ?asHost=true returns the host view (requests
   * against my listings); otherwise the guest view (requests I made).
   */
  async listMyExchangeRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { page = 1, limit = DEFAULT_PAGE_SIZE, status, asHost } = req.query;
      const oxyUserId = resolveOxyUserId(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        res.json(paginationResponse([], 1, DEFAULT_PAGE_SIZE, 0, 'No profile found for user'));
        return;
      }

      const query: Record<string, unknown> = {};
      if (String(asHost) === 'true') {
        query.hostProfileId = activeProfile._id;
      } else {
        query.requesterProfileId = activeProfile._id;
      }
      if (status) query.status = status;

      const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNumber = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(limit), 10) || DEFAULT_PAGE_SIZE));
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total] = await Promise.all([
        ExchangeRequest.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        ExchangeRequest.countDocuments(query),
      ]);

      res.json(paginationResponse(items, pageNumber, limitNumber, total, 'Exchange requests retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/exchanges/:id
   * Only the requester or the host may read the request.
   */
  async getExchangeRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const oxyUserId = resolveOxyUserId(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      if (!Types.ObjectId.isValid(id)) {
        return next(new AppError('Invalid exchange request ID', 400, 'INVALID_ID'));
      }

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const exchangeRequest = await ExchangeRequest.findById(id).lean();
      if (!exchangeRequest) return next(new AppError('Exchange request not found', 404, 'NOT_FOUND'));

      const isRequester = String(exchangeRequest.requesterProfileId) === String(activeProfile._id);
      const isHost = String(exchangeRequest.hostProfileId) === String(activeProfile._id);
      if (!isRequester && !isHost) {
        return next(new AppError('Not authorized to view this exchange request', 403, 'FORBIDDEN'));
      }

      res.json(successResponse(exchangeRequest, 'Exchange request retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/exchanges/:id
   * Status transition machine (authorized per role):
   *   - Host:      pending   -> confirmed | declined
   *   - Requester: pending   -> cancelled
   *                confirmed -> cancelled
   *   - Either:    confirmed -> completed (only after the requested window ended)
   * Any other transition is rejected as INVALID_STATE.
   */
  async updateExchangeRequestStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status: nextStatus, message } = req.body as UpdateExchangeRequestData;

      const oxyUserId = resolveOxyUserId(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      if (!Types.ObjectId.isValid(id)) {
        return next(new AppError('Invalid exchange request ID', 400, 'INVALID_ID'));
      }

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const exchangeRequest = await ExchangeRequest.findById(id);
      if (!exchangeRequest) return next(new AppError('Exchange request not found', 404, 'NOT_FOUND'));

      const isRequester = String(exchangeRequest.requesterProfileId) === String(activeProfile._id);
      const isHost = String(exchangeRequest.hostProfileId) === String(activeProfile._id);
      if (!isRequester && !isHost) {
        return next(new AppError('Not authorized to update this exchange request', 403, 'FORBIDDEN'));
      }

      const now = new Date();

      if (nextStatus === ExchangeRequestStatus.CONFIRMED || nextStatus === ExchangeRequestStatus.DECLINED) {
        if (!isHost) return next(new AppError('Only the host can confirm or decline', 403, 'FORBIDDEN'));
        if (exchangeRequest.status !== ExchangeRequestStatus.PENDING) {
          return next(new AppError('Only pending requests can be confirmed or declined', 400, 'INVALID_STATE'));
        }
        if (nextStatus === ExchangeRequestStatus.CONFIRMED) {
          // Re-check conflicts before committing.
          const confirmedExchanges = await ExchangeRequest.find({
            _id: { $ne: exchangeRequest._id },
            propertyId: exchangeRequest.propertyId,
            status: { $in: BLOCKING_EXCHANGE_STATUSES },
          })
            .select('requestedWindow')
            .lean();
          const requested = parseWindow(exchangeRequest.requestedWindow);
          const conflict = !!requested && confirmedExchanges.some((existing: { requestedWindow?: ExchangeWindow }) => {
            const other = parseWindow(existing.requestedWindow);
            return !!other && windowsOverlap(requested.start, requested.end, other.start, other.end);
          });
          if (conflict) {
            return next(new AppError('Another confirmed exchange now conflicts with this one', 409, 'DATE_CONFLICT'));
          }
        }
        exchangeRequest.status = nextStatus;
      } else if (nextStatus === ExchangeRequestStatus.CANCELLED) {
        if (!isRequester) return next(new AppError('Only the requester can cancel', 403, 'FORBIDDEN'));
        if (exchangeRequest.status === ExchangeRequestStatus.CANCELLED) {
          if (typeof message === 'string') exchangeRequest.message = message;
          await exchangeRequest.save();
          res.json(successResponse(exchangeRequest.toJSON(), 'Exchange request already cancelled'));
          return;
        }
        if (
          exchangeRequest.status !== ExchangeRequestStatus.PENDING &&
          exchangeRequest.status !== ExchangeRequestStatus.CONFIRMED
        ) {
          return next(new AppError('Only pending or confirmed requests can be cancelled', 400, 'INVALID_STATE'));
        }
        exchangeRequest.status = ExchangeRequestStatus.CANCELLED;
      } else if (nextStatus === ExchangeRequestStatus.COMPLETED) {
        if (exchangeRequest.status !== ExchangeRequestStatus.CONFIRMED) {
          return next(new AppError('Only confirmed exchanges can be completed', 400, 'INVALID_STATE'));
        }
        const requested = parseWindow(exchangeRequest.requestedWindow);
        if (!requested || requested.end.getTime() > now.getTime()) {
          return next(new AppError('An exchange can only be completed after the stay window has passed', 400, 'STAY_NOT_ENDED'));
        }
        exchangeRequest.status = ExchangeRequestStatus.COMPLETED;
      } else {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      if (typeof message === 'string') {
        exchangeRequest.message = message;
      }

      await exchangeRequest.save();
      logger.info('Exchange request status updated', {
        exchangeRequestId: String(exchangeRequest._id),
        nextStatus: exchangeRequest.status,
        byHost: isHost,
        byRequester: isRequester,
      });

      res.json(successResponse(exchangeRequest.toJSON(), 'Exchange request updated'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ExchangeController();
