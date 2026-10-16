/**
 * Viewing availability — the HTTP adapter for the schedule half of
 * `domain/viewings.ts` (#518 §7.5).
 *
 * Two surfaces over `property_viewing_windows`:
 *
 *  - **`GET /api/properties/:id/viewing-availability`** — PUBLIC, mounted on
 *    `routes/public.ts`. Choosing a time is something a visitor does before
 *    they have an account, exactly as choosing dates is. It is safe on that
 *    router because of what it RETURNS, not because of anything it checks: the
 *    weekly windows the owner published, the free slots they produce, and the
 *    zone those clock times are in. No requester, no owner, no viewing id, no
 *    message. It reads nothing from `req.user`, which is the condition
 *    `AGENTS.md` sets for a handler there.
 *
 *  - **`GET` / `PUT /api/properties/:id/viewing-windows`** — the owner's own
 *    schedule, on the authenticated router. Ownership is the repository's
 *    predicate, so somebody else's listing answers 404 rather than 403 and a
 *    prober cannot use the endpoint to enumerate which listings exist.
 *
 * Why the schedule is authoritative only once it exists is in the domain
 * module's header.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  getViewingAvailability,
  getViewingWindows,
  setViewingWindows,
  viewingHorizonDays,
} from '../domain/viewings';
import { AppError, successResponse } from '../middlewares/errorHandler';

function requireCaller(req: Request): string {
  const oxyUserId = req.user?.id || req.user?._id || req.userId;
  if (!oxyUserId) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return oxyUserId;
}

class ViewingAvailabilityController {
  /** The slots a listing offers. PUBLIC — see the module header. */
  async getViewingAvailability(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const outcome = await getViewingAvailability({
        propertyId: req.params.propertyId,
        days: viewingHorizonDays(req.query.days),
      });
      // External listings have no in-app viewing at all — the same refusal the
      // create path makes, stated before somebody picks a time.
      if (outcome.status === 'external_listing') {
        throw new AppError(
          'Cannot book viewings for external properties',
          400,
          'EXTERNAL_PROPERTY',
        );
      }
      res.json(successResponse(outcome.availability, 'Viewing availability retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** The owner's own schedule, including the zone it is expressed in. */
  async getViewingWindows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const schedule = await getViewingWindows(requireCaller(req), {
        propertyId: req.params.propertyId,
      });
      res.json(successResponse(schedule, 'Viewing schedule retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** Replace the schedule, and optionally the zone it is expressed in. */
  async putViewingWindows(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const schedule = await setViewingWindows(oxyUserId, {
        propertyId: req.params.propertyId,
        windows: req.body?.windows,
        timeZone: req.body?.timeZone,
      });
      res.json(successResponse(schedule, 'Viewing schedule updated'));
    } catch (error) {
      next(error);
    }
  }
}

export const viewingAvailabilityController = new ViewingAvailabilityController();
export default viewingAvailabilityController;
