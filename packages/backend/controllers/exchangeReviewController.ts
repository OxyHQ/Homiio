/**
 * Exchange Review Controller — the HTTP adapter for the review half of
 * `domain/exchanges.ts`.
 *
 * Reviews written by the two parties of a COMPLETED home exchange; each party
 * reviews the OTHER one, at most once (`exchange_reviews_request_reviewer_key`
 * surfaces a duplicate as a clean 409).
 */

import type { NextFunction, Request, Response } from 'express';

import {
  exchangePage,
  listExchangeReviews,
  listUserExchangeReviews,
  writeExchangeReview,
} from '../domain/exchanges';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';

function requireCaller(req: Request): string {
  const user = req as Request & { user?: { id?: string; _id?: string }; userId?: string };
  const oxyUserId = user.user?.id || user.user?._id || user.userId;
  if (!oxyUserId) throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  return oxyUserId;
}

class ExchangeReviewController {
  /** POST /api/exchanges/:id/reviews — only after completion, only by a party, once. */
  async createExchangeReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const { rating, comment, categories } = req.body ?? {};
      const review = await writeExchangeReview(oxyUserId, {
        exchangeRequestId: req.params.id,
        rating,
        comment,
        categories,
      });
      res.status(201).json(successResponse(review, 'Exchange review created'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/exchanges/:id/reviews — readable by the requester or the host. */
  async getExchangeReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireCaller(req);
      const reviews = await listExchangeReviews(oxyUserId, { exchangeRequestId: req.params.id });
      res.json(successResponse(reviews, 'Exchange reviews retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profiles/oxy/:oxyUserId/exchange-reviews — reviews where a person
   * is the SUBJECT, newest first, with an aggregate. Any signed-in person.
   */
  async getProfileExchangeReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await listUserExchangeReviews({
        subjectOxyUserId: req.params.oxyUserId,
        ...exchangePage(req.query.page, req.query.limit),
      });
      res.json(
        paginationResponse(
          result.rows,
          result.page,
          result.limit,
          result.total,
          'Profile exchange reviews retrieved',
          { averageRating: result.averageRating, reviewCount: result.total },
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new ExchangeReviewController();
