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

/** A confirmed-exchange row projected for conflict detection (both roles). */
interface ConflictRow {
  _id: unknown;
  propertyId?: unknown;
  offeredPropertyId?: unknown;
  requestedWindow?: ExchangeWindow;
  offeredWindow?: ExchangeWindow;
}

/**
 * Detect whether a committed (CONFIRMED) exchange already occupies `propertyId`
 * for any time overlapping `window`. A property can be committed in BOTH roles:
 *  - as the TARGET of a confirmed exchange (`propertyId` + `requestedWindow`), or
 *  - as the OFFERED home of a confirmed SWAP (`offeredPropertyId` + `offeredWindow`).
 *
 * Both roles are checked so a swap can never double-book the home a requester
 * offers in return. `excludeRequestId` omits a specific request from the scan
 * (used at confirm time so a request never conflicts with itself).
 */
async function hasPropertyConflict(
  propertyId: unknown,
  window: { start: Date; end: Date },
  excludeRequestId?: unknown
): Promise<boolean> {
  const baseQuery: Record<string, unknown> = {
    status: { $in: BLOCKING_EXCHANGE_STATUSES },
    $or: [{ propertyId }, { offeredPropertyId: propertyId }],
  };
  if (excludeRequestId !== undefined) {
    baseQuery._id = { $ne: excludeRequestId };
  }

  const committed: ConflictRow[] = await ExchangeRequest.find(baseQuery)
    .select('propertyId offeredPropertyId requestedWindow offeredWindow')
    .lean();

  const target = String(propertyId);
  return committed.some((row) => {
    // Compare against whichever window pins THIS property in the existing row.
    if (String(row.propertyId) === target) {
      const other = parseWindow(row.requestedWindow);
      if (other && windowsOverlap(window.start, window.end, other.start, other.end)) {
        return true;
      }
    }
    if (String(row.offeredPropertyId) === target) {
      const other = parseWindow(row.offeredWindow);
      if (other && windowsOverlap(window.start, window.end, other.start, other.end)) {
        return true;
      }
    }
    return false;
  });
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

      // Validate requested window: start < end, not in the past. A window
      // starting exactly now is allowed (`<`, not `<=`).
      const requested = parseWindow(requestedWindow);
      if (!requested) {
        return next(new AppError('Invalid requested window', 400, 'INVALID_WINDOW'));
      }
      const now = new Date();
      if (requested.start.getTime() < now.getTime()) {
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
        // Same future guard as the requested window: the offered stay cannot
        // start in the past (start === now is allowed).
        if (offered.start.getTime() < now.getTime()) {
          return next(new AppError('Offered window must start in the future', 400, 'DATE_IN_PAST'));
        }
        resolvedOfferedPropertyId = offeredProperty._id;
        resolvedOfferedWindow = offered;
      }

      // Conflict: a committed (CONFIRMED) exchange already occupies the TARGET
      // property over the requested window. `hasPropertyConflict` checks both
      // roles the property may be committed in (target + offered). Pending
      // requests never block — only committed ones.
      if (await hasPropertyConflict(propertyId, requested)) {
        return next(new AppError('Requested dates conflict with a confirmed exchange', 409, 'DATE_CONFLICT'));
      }

      // For a SWAP, the OFFERED home must also be free over its offered window —
      // otherwise a requester could double-book the home they offer in return.
      if (mode === ExchangeMode.SWAP && resolvedOfferedPropertyId && resolvedOfferedWindow) {
        if (await hasPropertyConflict(resolvedOfferedPropertyId, resolvedOfferedWindow)) {
          return next(new AppError('Offered dates conflict with a confirmed exchange', 409, 'OFFERED_DATE_CONFLICT'));
        }
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
          // Re-validate the listing at confirm time: it may have dropped the
          // exchange intent or changed/cleared its mode since the request was
          // made. Confirming against a listing that no longer offers this
          // exchange/mode is rejected.
          const targetProperty = await Property.findById(exchangeRequest.propertyId).lean();
          if (!targetProperty) {
            return next(new AppError('Property no longer exists', 404, 'NOT_FOUND'));
          }
          if (!hasExchangeIntent(targetProperty)) {
            return next(new AppError('This property is no longer open to home exchange', 409, 'NOT_EXCHANGEABLE'));
          }
          const listingMode = targetProperty.exchange?.mode;
          if (!listingMode || !modeAccepts(listingMode, exchangeRequest.mode)) {
            return next(new AppError(`This listing no longer accepts "${exchangeRequest.mode}" exchanges`, 409, 'MODE_NOT_ACCEPTED'));
          }

          // Re-check conflicts before committing, excluding this request so it
          // never collides with itself. Check the TARGET (requested window)…
          const requested = parseWindow(exchangeRequest.requestedWindow);
          if (!requested) {
            return next(new AppError('Invalid requested window', 400, 'INVALID_WINDOW'));
          }
          if (await hasPropertyConflict(exchangeRequest.propertyId, requested, exchangeRequest._id)) {
            return next(new AppError('Another confirmed exchange now conflicts with this one', 409, 'DATE_CONFLICT'));
          }
          // …and, for a SWAP, the OFFERED home (offered window).
          if (exchangeRequest.mode === ExchangeMode.SWAP) {
            const offered = parseWindow(exchangeRequest.offeredWindow);
            if (!offered) {
              return next(new AppError('Invalid offered window', 400, 'INVALID_WINDOW'));
            }
            if (await hasPropertyConflict(exchangeRequest.offeredPropertyId, offered, exchangeRequest._id)) {
              return next(new AppError('The offered home now conflicts with a confirmed exchange', 409, 'OFFERED_DATE_CONFLICT'));
            }
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
        // A SWAP only completes once BOTH legs have ended: the offered stay must
        // also be in the past. Host-mode requests have no offered window and so
        // keep the requested-only check above.
        if (exchangeRequest.mode === ExchangeMode.SWAP) {
          const offered = parseWindow(exchangeRequest.offeredWindow);
          if (!offered || offered.end.getTime() > now.getTime()) {
            return next(new AppError('A swap can only be completed after both stay windows have passed', 400, 'STAY_NOT_ENDED'));
          }
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
