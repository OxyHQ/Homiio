/**
 * Exchange Controller
 *
 * Handles the home-exchange lifecycle (Couchsurfing-style):
 *  - SWAP: reciprocal home swap (each party stays in the other's home)
 *  - HOST: one-way free hosting (guest stays, no reciprocity)
 *
 * Operates only on listings carrying the EXCHANGE offering. Distinct from:
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
} from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import {
  createExchangeRequest,
  findExchangeRequestById,
  hasPropertyConflict,
  isExchangeStatus,
  listExchangeRequests,
  serializeExchangeRequest,
  setExchangeRequestMessage,
  transitionExchangeRequest,
  type ExchangeModeValue,
  type ExchangeStatusValue,
  type ExchangeWindowInput,
} from '../db/exchanges/exchangeReads';
import {
  findPropertyBookingBasis,
  type PropertyBookingBasis,
} from '../db/properties/propertyBookingBasis';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { ExchangeMode, ExchangeRequestStatus, OfferingType } from '@homiio/shared-types';

// ---- Tunable constants (no magic numbers / strings inline) ----
/** Default page size for list endpoints. */
const DEFAULT_PAGE_SIZE = 10;
/** Hard cap on page size to protect the database. */
const MAX_PAGE_SIZE = 100;

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

/** A property carries the EXCHANGE offering. */
function hasExchangeOffering(property: PropertyBookingBasis): boolean {
  return property.offerings.includes(OfferingType.EXCHANGE);
}

/**
 * Parse + validate a requested/offered window into concrete Dates. The wire
 * shape uses ISO strings (`ExchangeWindow`) but Mongoose hydrates persisted
 * windows to `Date`, so accept either at the boundary.
 */
function parseWindow(
  window: { start: Date | string; end: Date | string } | undefined,
): { start: Date; end: Date } | null {
  if (!window || !window.start || !window.end) {
    return null;
  }
  const start = window.start instanceof Date ? window.start : new Date(window.start);
  const end = window.end instanceof Date ? window.end : new Date(window.end);
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

      // The `ObjectId.isValid` guards are DELETED rather than widened
      // (`db/ids.ts`): post-cutover every listing id is a uuid v7, which they
      // reject — and the lookups below already answer 404 for an id that names
      // nothing, whatever its shape.
      if (mode !== ExchangeMode.SWAP && mode !== ExchangeMode.HOST) {
        return next(new AppError('Exchange mode must be "swap" or "host"', 400, 'INVALID_MODE'));
      }

      const db = getDb();
      const property = await findPropertyBookingBasis(db, String(propertyId));
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.isExternal) {
        return next(new AppError('Cannot request an exchange on external listings', 400, 'EXTERNAL_PROPERTY'));
      }
      if (!hasExchangeOffering(property)) {
        return next(new AppError('This property is not open to home exchange', 400, 'NOT_EXCHANGEABLE'));
      }
      const listingMode = property.exchangeMode;
      if (!listingMode || !modeAccepts(listingMode, mode)) {
        return next(new AppError(`This listing does not accept "${mode}" exchanges`, 400, 'MODE_NOT_ACCEPTED'));
      }

      const hostOxyUserId = property.oxyUserId;
      if (!hostOxyUserId) return next(new AppError('Property has no host', 400, 'INVALID_PROPERTY'));
      if (hostOxyUserId === oxyUserId) {
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

      // SWAP requires a verified offered property + offered window; HOST offers
      // nothing at all, which `exchange_requests_host_mode_offers_nothing_check`
      // now enforces — the port of a `pre('save')` hook `findOneAndUpdate`
      // walked straight past.
      let resolvedOfferedPropertyId: string | undefined;
      let resolvedOfferedWindow: ExchangeWindowInput | undefined;
      if (mode === ExchangeMode.SWAP) {
        if (!offeredPropertyId) {
          return next(new AppError('A swap requires an offered property', 400, 'OFFERED_PROPERTY_REQUIRED'));
        }
        const offeredProperty = await findPropertyBookingBasis(db, String(offeredPropertyId));
        if (!offeredProperty) return next(new AppError('Offered property not found', 404, 'NOT_FOUND'));
        if (offeredProperty.oxyUserId !== oxyUserId) {
          return next(new AppError('Offered property does not belong to you', 403, 'FORBIDDEN'));
        }
        if (!hasExchangeOffering(offeredProperty)) {
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
        resolvedOfferedPropertyId = offeredProperty.id;
        resolvedOfferedWindow = offered;
      }

      // Conflict: a committed (CONFIRMED) exchange already occupies the TARGET
      // property over the requested window. One range-overlap query, both roles
      // — see `db/exchanges/exchangeReads.ts`. Pending requests never block.
      if (await hasPropertyConflict(db, String(propertyId), requested)) {
        return next(new AppError('Requested dates conflict with a confirmed exchange', 409, 'DATE_CONFLICT'));
      }

      // For a SWAP, the OFFERED home must also be free over its offered window —
      // otherwise a requester could double-book the home they offer in return.
      if (resolvedOfferedPropertyId && resolvedOfferedWindow) {
        if (await hasPropertyConflict(db, resolvedOfferedPropertyId, resolvedOfferedWindow)) {
          return next(new AppError('Offered dates conflict with a confirmed exchange', 409, 'OFFERED_DATE_CONFLICT'));
        }
      }

      const exchangeRequest = await createExchangeRequest(db, {
        propertyId: String(propertyId),
        requesterOxyUserId: oxyUserId,
        hostOxyUserId,
        mode: mode as ExchangeModeValue,
        requestedWindow: requested,
        offeredPropertyId: resolvedOfferedPropertyId,
        offeredWindow: resolvedOfferedWindow,
        message: typeof message === 'string' ? message : undefined,
      });

      logger.info('Exchange request created', {
        exchangeRequestId: exchangeRequest.id,
        propertyId: String(propertyId),
        mode,
      });

      res.status(201).json(successResponse(serializeExchangeRequest(exchangeRequest), 'Exchange request created'));
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

      // The `Profile.findByOxyUserId` guard is DROPPED, not ported. It was not an
      // authorisation check — both branches below are already scoped by the
      // session `oxyUserId` — so its only effect was to answer an empty list to
      // somebody who owned rows and happened to have no profile document yet.
      // Keeping it would make this controller depend on `profiles`, a table
      // another batch owns, to reproduce a check that protected nothing. Same
      // call, same reasoning, as `savedSearches` in #301.
      const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNumber = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(limit), 10) || DEFAULT_PAGE_SIZE));
      const skip = (pageNumber - 1) * limitNumber;

      const asHostView = String(asHost) === 'true';
      const result = await listExchangeRequests(
        getDb(),
        {
          requesterOxyUserId: asHostView ? undefined : oxyUserId,
          hostOxyUserId: asHostView ? oxyUserId : undefined,
          status: isExchangeStatus(status) ? status : undefined,
        },
        { limit: limitNumber, offset: skip },
      );

      res.json(paginationResponse(result.rows.map(serializeExchangeRequest), pageNumber, limitNumber, result.total, 'Exchange requests retrieved'));
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

      const exchangeRequest = await findExchangeRequestById(getDb(), id);
      if (!exchangeRequest) return next(new AppError('Exchange request not found', 404, 'NOT_FOUND'));

      const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
      const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
      if (!isRequester && !isHost) {
        return next(new AppError('Not authorized to view this exchange request', 403, 'FORBIDDEN'));
      }

      res.json(successResponse(serializeExchangeRequest(exchangeRequest), 'Exchange request retrieved'));
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

      const db = getDb();
      const exchangeRequest = await findExchangeRequestById(db, id);
      if (!exchangeRequest) return next(new AppError('Exchange request not found', 404, 'NOT_FOUND'));

      const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
      const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
      if (!isRequester && !isHost) {
        return next(new AppError('Not authorized to update this exchange request', 403, 'FORBIDDEN'));
      }

      const now = new Date();
      const nextMessage = typeof message === 'string' ? message : undefined;
      // Every transition below carries its permitted FROM set into the
      // `UPDATE`'s own predicate, so two hosts confirming at once cannot both
      // succeed. The reads choose the ERROR; the predicate chooses the write.
      let updated: Awaited<ReturnType<typeof transitionExchangeRequest>>;
      let fromStatuses: readonly ExchangeStatusValue[];

      if (nextStatus === ExchangeRequestStatus.CONFIRMED || nextStatus === ExchangeRequestStatus.DECLINED) {
        if (!isHost) return next(new AppError('Only the host can confirm or decline', 403, 'FORBIDDEN'));
        if (exchangeRequest.status !== ExchangeRequestStatus.PENDING) {
          return next(new AppError('Only pending requests can be confirmed or declined', 400, 'INVALID_STATE'));
        }
        if (nextStatus === ExchangeRequestStatus.CONFIRMED) {
          // Re-validate the listing at confirm time: it may have dropped the
          // exchange intent or changed/cleared its mode since the request was
          // made.
          const targetProperty = await findPropertyBookingBasis(db, exchangeRequest.propertyId);
          if (!targetProperty) {
            return next(new AppError('Property no longer exists', 404, 'NOT_FOUND'));
          }
          if (!hasExchangeOffering(targetProperty)) {
            return next(new AppError('This property is no longer open to home exchange', 409, 'NOT_EXCHANGEABLE'));
          }
          const listingMode = targetProperty.exchangeMode;
          if (!listingMode || !modeAccepts(listingMode, exchangeRequest.mode)) {
            return next(new AppError(`This listing no longer accepts "${exchangeRequest.mode}" exchanges`, 409, 'MODE_NOT_ACCEPTED'));
          }

          // Re-check conflicts before committing, excluding this request so it
          // never collides with itself. The TARGET first…
          const requested = {
            start: exchangeRequest.requestedWindowStart,
            end: exchangeRequest.requestedWindowEnd,
          };
          if (await hasPropertyConflict(db, exchangeRequest.propertyId, requested, { excludeId: exchangeRequest.id })) {
            return next(new AppError('Another confirmed exchange now conflicts with this one', 409, 'DATE_CONFLICT'));
          }
          // …and, for a SWAP, the OFFERED home.
          if (exchangeRequest.mode === ExchangeMode.SWAP) {
            // `exchange_requests_offered_window_check` is all-or-none, so these
            // three are present together or not at all — but a swap whose offer
            // was never recorded cannot be confirmed against a calendar.
            if (
              !exchangeRequest.offeredPropertyId ||
              !exchangeRequest.offeredWindowStart ||
              !exchangeRequest.offeredWindowEnd
            ) {
              return next(new AppError('Invalid offered window', 400, 'INVALID_WINDOW'));
            }
            const offered = {
              start: exchangeRequest.offeredWindowStart,
              end: exchangeRequest.offeredWindowEnd,
            };
            if (await hasPropertyConflict(db, exchangeRequest.offeredPropertyId, offered, { excludeId: exchangeRequest.id })) {
              return next(new AppError('The offered home now conflicts with a confirmed exchange', 409, 'OFFERED_DATE_CONFLICT'));
            }
          }
        }
        fromStatuses = [ExchangeRequestStatus.PENDING];
        updated = await transitionExchangeRequest(db, id, nextStatus, fromStatuses, { message: nextMessage });
        if (!updated) {
          return next(new AppError('Only pending requests can be confirmed or declined', 400, 'INVALID_STATE'));
        }
      } else if (nextStatus === ExchangeRequestStatus.CANCELLED) {
        if (!isRequester) return next(new AppError('Only the requester can cancel', 403, 'FORBIDDEN'));
        if (exchangeRequest.status === ExchangeRequestStatus.CANCELLED) {
          // Already in the state the caller asked for. The message is still
          // applied, matching the Mongoose handler's convergence path.
          const converged = nextMessage === undefined
            ? exchangeRequest
            : (await setExchangeRequestMessage(db, id, nextMessage)) ?? exchangeRequest;
          res.json(successResponse(serializeExchangeRequest(converged), 'Exchange request already cancelled'));
          return;
        }
        fromStatuses = [ExchangeRequestStatus.PENDING, ExchangeRequestStatus.CONFIRMED];
        updated = await transitionExchangeRequest(db, id, nextStatus, fromStatuses, { message: nextMessage });
        if (!updated) {
          return next(new AppError('Only pending or confirmed requests can be cancelled', 400, 'INVALID_STATE'));
        }
      } else if (nextStatus === ExchangeRequestStatus.COMPLETED) {
        if (exchangeRequest.status !== ExchangeRequestStatus.CONFIRMED) {
          return next(new AppError('Only confirmed exchanges can be completed', 400, 'INVALID_STATE'));
        }
        if (exchangeRequest.requestedWindowEnd.getTime() > now.getTime()) {
          return next(new AppError('An exchange can only be completed after the stay window has passed', 400, 'STAY_NOT_ENDED'));
        }
        // A SWAP only completes once BOTH legs have ended. Host-mode requests
        // have no offered window and keep the requested-only check above.
        if (exchangeRequest.mode === ExchangeMode.SWAP) {
          if (!exchangeRequest.offeredWindowEnd || exchangeRequest.offeredWindowEnd.getTime() > now.getTime()) {
            return next(new AppError('A swap can only be completed after both stay windows have passed', 400, 'STAY_NOT_ENDED'));
          }
        }
        fromStatuses = [ExchangeRequestStatus.CONFIRMED];
        updated = await transitionExchangeRequest(db, id, nextStatus, fromStatuses, { message: nextMessage });
        if (!updated) {
          return next(new AppError('Only confirmed exchanges can be completed', 400, 'INVALID_STATE'));
        }
      } else {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      logger.info('Exchange request status updated', {
        exchangeRequestId: updated.id,
        nextStatus: updated.status,
        byHost: isHost,
        byRequester: isRequester,
      });

      res.json(successResponse(serializeExchangeRequest(updated), 'Exchange request updated'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ExchangeController();
