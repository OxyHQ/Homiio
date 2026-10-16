/**
 * Viewing Controller — the HTTP adapter for `domain/viewings.ts`.
 *
 * Each handler reads the session and the request, calls the use case, and
 * answers what the route has always answered. The rules (zones, the published
 * schedule, the overlap checks, who may decide what, the notifications) live in
 * the domain module, which the catalogue tools call too.
 *
 * The one translation that happens HERE: an external listing is a typed
 * `external_listing` outcome in the domain and stays the route's historical
 * 400 `EXTERNAL_PROPERTY` on the wire.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  approveViewing,
  cancelViewing,
  declineViewing,
  listListingViewingRequests,
  listMyViewingRequests,
  requestViewing,
  rescheduleViewing,
  viewingPage,
} from '../domain/viewings';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';

/** Resolve the caller from the session, in the shape the auth layer sets. */
function callerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || req.userId || undefined;
}

function requireCaller(req: Request): string {
  const oxyUserId = callerOf(req);
  if (!oxyUserId) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return oxyUserId;
}

class ViewingController {
  /** POST /api/properties/:propertyId/viewings */
  async createViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const { date, time, modality, message } = req.body;
      const outcome = await requestViewing(oxyUserId, {
        propertyId: req.params.propertyId,
        date,
        time,
        modality,
        message,
      });
      if (outcome.status === 'external_listing') {
        throw new AppError(
          'Cannot book viewings for external properties',
          400,
          'EXTERNAL_PROPERTY',
        );
      }
      res.status(201).json(successResponse(outcome.viewing, 'Viewing request created'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/viewings/me */
  async listMyViewingRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const result = await listMyViewingRequests(oxyUserId, {
        ...viewingPage(req.query.page, req.query.limit),
        status: req.query.status,
      });
      res.json(
        paginationResponse(
          result.rows,
          result.page,
          result.limit,
          result.total,
          'Viewing requests retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/properties/:propertyId/viewings — every request for the owner,
   * only the caller's own for anybody else.
   */
  async listPropertyViewingRequests(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const result = await listListingViewingRequests(oxyUserId, {
        propertyId: req.params.propertyId,
        ...viewingPage(req.query.page, req.query.limit),
        status: req.query.status,
      });
      res.json(
        paginationResponse(
          result.rows,
          result.page,
          result.limit,
          result.total,
          'Viewing requests retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/viewings/:viewingId/approve (owner only) */
  async approveViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const viewing = await approveViewing(oxyUserId, {
        viewingId: req.params.viewingId,
        response: req.body?.response,
      });
      res.json(successResponse(viewing, 'Viewing request approved'));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/viewings/:viewingId/decline (owner only) */
  async declineViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const viewing = await declineViewing(oxyUserId, {
        viewingId: req.params.viewingId,
        response: req.body?.response,
      });
      res.json(successResponse(viewing, 'Viewing request declined'));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/viewings/:viewingId/cancel (requester or owner) */
  async cancelViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const outcome = await cancelViewing(oxyUserId, {
        viewingId: req.params.viewingId,
        response: req.body?.response,
      });
      res.json(
        successResponse(
          outcome.viewing,
          outcome.alreadyCancelled
            ? 'Viewing request already cancelled'
            : 'Viewing request cancelled',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/viewings/:viewingId — reschedule a pending request (requester only) */
  async updateViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const { date, time, modality, message } = req.body;
      const viewing = await rescheduleViewing(oxyUserId, {
        viewingId: req.params.viewingId,
        date,
        time,
        modality,
        message,
      });
      res.json(successResponse(viewing, 'Viewing request updated'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ViewingController();
