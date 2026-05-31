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

const { ExchangeRequest, ExchangeReview, Profile } = require('../models');
const { logger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');
const { ExchangeRequestStatus } = require('@homiio/shared-types');
const { Types } = require('mongoose');

// ---- Tunable constants (no magic numbers inline) ----
/** Default page size for the profile-reviews list. */
const DEFAULT_PAGE_SIZE = 10;
/** Hard cap on page size to protect the database. */
const MAX_PAGE_SIZE = 100;
/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY_CODE = 11000;
/** Decimal places kept on the aggregate average rating. */
const RATING_DECIMALS = 2;

function resolveOxyUserId(req: Request): string | undefined {
  const user = (req as Request & { user?: { id?: string; _id?: string }; userId?: string });
  return user.user?.id || user.user?._id || user.userId;
}

/** Round to `RATING_DECIMALS` decimal places. */
function roundRating(value: number): number {
  const factor = 10 ** RATING_DECIMALS;
  return Math.round(value * factor) / factor;
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
        return next(new AppError('Not authorized to review this exchange', 403, 'FORBIDDEN'));
      }

      if (exchangeRequest.status !== ExchangeRequestStatus.COMPLETED) {
        return next(new AppError('You can only review a completed exchange', 400, 'EXCHANGE_NOT_COMPLETED'));
      }

      // The reviewer reviews the other party.
      const subjectProfileId = isRequester
        ? exchangeRequest.hostProfileId
        : exchangeRequest.requesterProfileId;

      // Defensive pre-check: one review per reviewer per exchange. The unique
      // compound index is the race-safe backstop (handled below); this gives a
      // clean 409 immediately and stays correct even before the index finishes
      // building on a freshly-created collection.
      const existingReview = await ExchangeReview.findOne({
        exchangeRequestId: exchangeRequest._id,
        reviewerProfileId: activeProfile._id,
      })
        .select('_id')
        .lean();
      if (existingReview) {
        return next(new AppError('You have already reviewed this exchange', 409, 'ALREADY_REVIEWED'));
      }

      try {
        const review = await ExchangeReview.create({
          exchangeRequestId: exchangeRequest._id,
          reviewerProfileId: activeProfile._id,
          subjectProfileId,
          rating,
          comment,
          categories,
        });

        logger.info('Exchange review created', {
          exchangeReviewId: String(review._id),
          exchangeRequestId: String(exchangeRequest._id),
        });

        res.status(201).json(successResponse(review.toJSON(), 'Exchange review created'));
      } catch (error) {
        if ((error as { code?: number }).code === DUPLICATE_KEY_CODE) {
          return next(new AppError('You have already reviewed this exchange', 409, 'ALREADY_REVIEWED'));
        }
        throw error;
      }
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
        return next(new AppError('Not authorized to view these reviews', 403, 'FORBIDDEN'));
      }

      const reviews = await ExchangeReview.find({ exchangeRequestId: exchangeRequest._id })
        .sort({ createdAt: -1 })
        .lean();

      res.json(successResponse(reviews, 'Exchange reviews retrieved'));
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
      const { profileId } = req.params;
      const { page = 1, limit = DEFAULT_PAGE_SIZE } = req.query;

      if (!Types.ObjectId.isValid(profileId)) {
        return next(new AppError('Invalid profile ID', 400, 'INVALID_ID'));
      }

      const subjectId = new Types.ObjectId(profileId);
      const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNumber = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(limit), 10) || DEFAULT_PAGE_SIZE));
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total, aggregate] = await Promise.all([
        ExchangeReview.find({ subjectProfileId: subjectId })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        ExchangeReview.countDocuments({ subjectProfileId: subjectId }),
        ExchangeReview.aggregate([
          { $match: { subjectProfileId: subjectId } },
          { $group: { _id: null, averageRating: { $avg: '$rating' }, count: { $sum: 1 } } },
        ]),
      ]);

      const averageRating = aggregate.length > 0 ? roundRating(aggregate[0].averageRating) : 0;

      res.json(
        paginationResponse(items, pageNumber, limitNumber, total, 'Profile exchange reviews retrieved', {
          averageRating,
          reviewCount: total,
        }),
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ExchangeReviewController();
