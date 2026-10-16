/**
 * Exchange Controller — the HTTP adapter for `domain/exchanges.ts`.
 *
 * The home-exchange lifecycle (swap / free hosting, the two-home locks, the
 * occupancy question, the guest-points ledger riding on the transitions) lives
 * in the domain module, which the catalogue tools call too. Each handler reads
 * the session and the request and answers what the route has always answered
 * — including the historical 400 `EXTERNAL_PROPERTY` for an external target
 * listing, which the domain reports as a typed `external_listing` outcome.
 */

import type { NextFunction, Request, Response } from 'express';
import type { CreateExchangeRequestData, UpdateExchangeRequestData } from '@homiio/shared-types';

import {
  exchangePage,
  getExchangeRequest,
  listMyExchangeRequests,
  requestExchange,
  updateExchangeRequest,
} from '../domain/exchanges';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';

function requireCaller(req: Request): string {
  const user = req as Request & { user?: { id?: string; _id?: string }; userId?: string };
  const oxyUserId = user.user?.id || user.user?._id || user.userId;
  if (!oxyUserId) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return oxyUserId;
}

class ExchangeController {
  /** POST /api/exchanges — requester proposes a swap or hosting stay. */
  async createExchangeRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const outcome = await requestExchange(oxyUserId, req.body as CreateExchangeRequestData);
      if (outcome.status === 'external_listing') {
        throw new AppError(
          'Cannot request an exchange on external listings',
          400,
          'EXTERNAL_PROPERTY',
        );
      }
      res.status(201).json(successResponse(outcome.exchangeRequest, 'Exchange request created'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/exchanges — the guest view, or the host view with `?asHost=true`. */
  async listMyExchangeRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const result = await listMyExchangeRequests(oxyUserId, {
        ...exchangePage(req.query.page, req.query.limit),
        status: req.query.status,
        asHost: String(req.query.asHost) === 'true',
      });
      res.json(
        paginationResponse(
          result.rows,
          result.page,
          result.limit,
          result.total,
          'Exchange requests retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/exchanges/:id — only the requester or the host. */
  async getExchangeRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const exchangeRequest = await getExchangeRequest(oxyUserId, {
        exchangeRequestId: req.params.id,
      });
      res.json(successResponse(exchangeRequest, 'Exchange request retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** PATCH /api/exchanges/:id — host confirms/declines, requester cancels, either completes. */
  async updateExchangeRequestStatus(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const body = req.body as UpdateExchangeRequestData;
      const outcome = await updateExchangeRequest(oxyUserId, {
        exchangeRequestId: req.params.id,
        status: body.status,
        message: body.message,
        guestPointsIdempotencyKey: body.guestPointsIdempotencyKey,
      });
      res.json(
        successResponse(
          outcome.exchangeRequest,
          outcome.alreadyCancelled
            ? 'Exchange request already cancelled'
            : 'Exchange request updated',
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new ExchangeController();
