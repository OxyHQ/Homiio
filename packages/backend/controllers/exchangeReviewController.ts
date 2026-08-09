/**
 * Exchange Review Controller
 *
 * Reviews written by the two parties of a COMPLETED home exchange. Each party
 * reviews the OTHER one. A unique compound index (exchangeRequestId, reviewer)
 * guarantees one review per reviewer per exchange; the duplicate-key error is
 * surfaced as a clean 409.
 *
 * Mirrors `reservationController`/`exchangeController` for structure, auth and
 * error conventions (successResponse / paginationResponse / next(AppError)).
 */

import type { Request, Response, NextFunction } from 'express';
import type { ExchangeReviewCategories } from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { findExchangeRequestById } from '../db/exchanges/exchangeReads';
import {
  createExchangeReview,
  ExchangeAlreadyReviewedError,
  listReviewsForExchange,
  listReviewsForSubject,
  serializeExchangeReview,
} from '../db/exchanges/exchangeReviewReads';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { ExchangeRequestStatus } from '@homiio/shared-types';

// ---- Tunable constants (no magic numbers inline) ----
/** Default page size for the profile-reviews list. */
const DEFAULT_PAGE_SIZE = 10;
/** Hard cap on page size to protect the database. */
const MAX_PAGE_SIZE = 100;

function resolveOxyUserId(req: Request): string | undefined {
  const user = (req as Request & { user?: { id?: string; _id?: string }; userId?: string });
  return user.user?.id || user.user?._id || user.userId;
}

class ExchangeReviewController {
  /**
   * POST /api/exchanges/:id/reviews
   * Only after the exchange is COMPLETED, only by the requester or host, and at
   * most once per reviewer. The subject is automatically the OTHER party.
   */
  async createExchangeReview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { rating, comment, categories } = req.body as {
        rating?: number;
        comment?: string;
        categories?: ExchangeReviewCategories;
      };

      const oxyUserId = resolveOxyUserId(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      // The `ObjectId.isValid` guard is deleted rather than widened
      // (`db/ids.ts`) — the lookup already 404s for an id naming nothing.
      const db = getDb();
      const exchangeRequest = await findExchangeRequestById(db, id);
      if (!exchangeRequest) return next(new AppError('Exchange request not found', 404, 'NOT_FOUND'));

      const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
      const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
      if (!isRequester && !isHost) {
        return next(new AppError('Not authorized to review this exchange', 403, 'FORBIDDEN'));
      }

      if (exchangeRequest.status !== ExchangeRequestStatus.COMPLETED) {
        return next(new AppError('You can only review a completed exchange', 400, 'EXCHANGE_NOT_COMPLETED'));
      }

      if (typeof rating !== 'number' || !Number.isFinite(rating)) {
        return next(new AppError('A rating is required', 400, 'INVALID_RATING'));
      }

      // The reviewer reviews the other party. Resolved server-side, which is
      // also what makes `exchange_reviews_distinct_parties_check` unreachable
      // through this path — it rejects only a bug.
      const subjectOxyUserId = isRequester
        ? exchangeRequest.hostOxyUserId
        : exchangeRequest.requesterOxyUserId;

      // No "already reviewed?" pre-read: `exchange_reviews_request_reviewer_key`
      // is a real UNIQUE, so the INSERT is the check and the 409 comes from its
      // own violation. The Mongoose version did both, which left a redundant
      // round trip in front of a constraint that already decides it.
      let review;
      try {
        review = await createExchangeReview(db, {
          exchangeRequestId: exchangeRequest.id,
          reviewerOxyUserId: oxyUserId,
          subjectOxyUserId,
          rating,
          comment,
          categories,
        });
      } catch (error) {
        if (error instanceof ExchangeAlreadyReviewedError) {
          return next(new AppError('You have already reviewed this exchange', 409, 'ALREADY_REVIEWED'));
        }
        throw error;
      }

      logger.info('Exchange review created', {
        exchangeReviewId: review.id,
        exchangeRequestId: exchangeRequest.id,
      });

      res.status(201).json(successResponse(serializeExchangeReview(review), 'Exchange review created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/exchanges/:id/reviews
   * Both reviews tied to a single exchange. Readable by the requester or host.
   */
  async getExchangeReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const oxyUserId = resolveOxyUserId(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const exchangeRequest = await findExchangeRequestById(db, id);
      if (!exchangeRequest) return next(new AppError('Exchange request not found', 404, 'NOT_FOUND'));

      const isRequester = exchangeRequest.requesterOxyUserId === oxyUserId;
      const isHost = exchangeRequest.hostOxyUserId === oxyUserId;
      if (!isRequester && !isHost) {
        return next(new AppError('Not authorized to view these reviews', 403, 'FORBIDDEN'));
      }

      const reviews = await listReviewsForExchange(db, exchangeRequest.id);

      res.json(successResponse(reviews.map(serializeExchangeReview), 'Exchange reviews retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/profiles/:profileId/exchange-reviews
   * Reviews where a profile is the SUBJECT, newest first, paginated, with an
   * aggregate average rating + count. Public to any authed user.
   */
  async getProfileExchangeReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { oxyUserId } = req.params;
      const { page = 1, limit = DEFAULT_PAGE_SIZE } = req.query;

      if (!oxyUserId) {
        return next(new AppError('Oxy user id is required', 400, 'OXY_USER_ID_REQUIRED'));
      }

      const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNumber = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(limit), 10) || DEFAULT_PAGE_SIZE));
      const skip = (pageNumber - 1) * limitNumber;

      const result = await listReviewsForSubject(getDb(), oxyUserId, {
        limit: limitNumber,
        offset: skip,
      });

      res.json(
        paginationResponse(
          result.rows.map(serializeExchangeReview),
          pageNumber,
          limitNumber,
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
