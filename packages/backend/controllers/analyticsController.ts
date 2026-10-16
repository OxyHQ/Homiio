/**
 * Analytics Controller
 * Thin adapters over `domain/analytics.ts`: per-owner analytics computed from
 * real platform data, plus public app-wide stats. The `getMyAnalytics` and
 * `getAppStats` capability tools call the same functions.
 */

import type { Request, Response, NextFunction } from 'express';

import { getAppStats, getOwnerAnalytics } from '../domain/analytics';
import { AppError, describeErrorForLog, successResponse } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

class AnalyticsController {
  /** Get analytics for the authenticated owner's listings. */
  async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
        return;
      }
      const data = await getOwnerAnalytics(oxyUserId, String(req.query.period || '30d'));
      res.json(successResponse(data, 'Analytics retrieved successfully'));
    } catch (error) {
      logger.error('Failed to retrieve analytics', { error: describeErrorForLog(error) });
      next(error);
    }
  }

  /** Get app-wide statistics (public). */
  async getAppStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(successResponse(await getAppStats(), 'App stats retrieved successfully'));
    } catch (error) {
      logger.error('Failed to retrieve app stats', { error: describeErrorForLog(error) });
      next(error);
    }
  }
}

export default new AnalyticsController();
