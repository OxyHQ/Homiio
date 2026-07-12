/**
 * Admin moderation queue controller.
 *
 * Powers the platform trust & safety review of user-reported content: reviucasa
 * reviews (`reports[]` / `moderationStatus`) and eviction-board cases
 * (`EvictionReport`). Mounted behind `requireAdmin` (`routes/admin.ts`), so
 * every handler here has already passed the env-allowlist admin gate — there is
 * NO additional role logic in these handlers.
 *
 * Security invariants (see AGENTS.md):
 *   - Reads use the admin-only serializer (`toAdminReviewDTO`) that INCLUDES the
 *     `reports` array; the public `toReviewDTO` still strips it — the public DTO
 *     is never weakened.
 *   - Writes only ever touch the fields dictated by an explicit action
 *     allowlist. `remove` on an eviction case is non-destructive (status →
 *     `cancelled`); the owner DELETE remains the only hard delete.
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Review, EvictionCase, EvictionReport } from '../../models';
import {
  ReviewModerationStatus,
  ListingReportStatus,
  EvictionCaseStatus,
  ADMIN_REVIEW_ACTIONS,
  ADMIN_EVICTION_ACTIONS,
  type AdminReviewModerationAction,
  type AdminEvictionModerationAction,
} from '@homiio/shared-types';
import { getOxyUserId } from '@oxyhq/core/server';
import { toAdminReviewDTO } from '../review/toReviewDTO';
import { toEvictionDTO, toEvictionReportDTO } from '../eviction/toEvictionDTO';
import { logger } from '../../middlewares/logging';

const ok = (res: Response, data: Record<string, unknown>) => res.status(200).json({ success: true, ...data });
const badRequest = (res: Response, data: Record<string, unknown>) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: Record<string, unknown>) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: Record<string, unknown>) => res.status(500).json({ success: false, ...data });

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Parse `?page`/`?limit` with sane clamps (mirrors the review controller). */
function parsePageLimit(req: Request): { page: number; limit: number; skip: number } {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  return { page, limit, skip: (page - 1) * limit };
}

/** Address populate used to surface a human-readable label on queued reviews. */
const REVIEW_ADDRESS_POPULATE = {
  path: 'addressId',
  select: 'street number postal_code countryCode cityId regionId countryId neighborhoodId coordinates',
  populate: [
    { path: 'cityId', select: 'name' },
    { path: 'regionId', select: 'name' },
    { path: 'countryId', select: 'name code' },
    { path: 'neighborhoodId', select: 'name' },
  ],
};

const REVIEW_FILTERS = ['under_review', 'reported', 'removed'] as const;
type ReviewFilter = (typeof REVIEW_FILTERS)[number];

const REVIEW_ACTIONS = new Set<string>(ADMIN_REVIEW_ACTIONS);
const EVICTION_ACTIONS = new Set<string>(ADMIN_EVICTION_ACTIONS);

/** Translate a queue filter into the Mongo query that selects its review set. */
function reviewFilterQuery(filter: ReviewFilter): Record<string, unknown> {
  switch (filter) {
    case 'reported':
      return { 'reports.0': { $exists: true } };
    case 'removed':
      return { moderationStatus: ReviewModerationStatus.REMOVED };
    case 'under_review':
    default:
      return { moderationStatus: ReviewModerationStatus.UNDER_REVIEW };
  }
}

// ---------------------------------------------------------------------------
// Reviews queue.
// ---------------------------------------------------------------------------

export const getModerationReviews = async (req: Request, res: Response) => {
  try {
    const rawFilter = typeof req.query.filter === 'string' ? req.query.filter : 'under_review';
    if (!REVIEW_FILTERS.includes(rawFilter as ReviewFilter)) {
      return badRequest(res, { message: 'Invalid filter' });
    }
    const filter = rawFilter as ReviewFilter;
    const query = reviewFilterQuery(filter);
    const { page, limit, skip } = parsePageLimit(req);

    const [reviews, total] = await Promise.all([
      Review.find(query)
        .populate(REVIEW_ADDRESS_POPULATE)
        .populate({ path: 'agencyId', select: 'name slug' })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(query),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return ok(res, {
      reviews: reviews.map((review) => toAdminReviewDTO(review)),
      pagination: { currentPage: page, totalPages, total, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching moderation reviews', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(res, { message: 'Failed to fetch moderation reviews' });
  }
};

export const moderateReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const action = (req.body?.action ?? '') as string;

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }
    if (!REVIEW_ACTIONS.has(action)) {
      return badRequest(res, { message: 'A valid action is required' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    switch (action as AdminReviewModerationAction) {
      case 'remove':
        review.moderationStatus = ReviewModerationStatus.REMOVED;
        break;
      case 'restore':
        review.moderationStatus = ReviewModerationStatus.ACTIVE;
        break;
      case 'dismiss_reports':
        review.reports = [];
        review.moderationStatus = ReviewModerationStatus.ACTIVE;
        break;
    }

    await review.save();

    logger.info('Admin moderated review', {
      reviewId: String(review._id),
      action,
      adminOxyUserId: getOxyUserId(req),
      moderationStatus: review.moderationStatus,
    });

    const populated = await Review.findById(reviewId)
      .populate(REVIEW_ADDRESS_POPULATE)
      .populate({ path: 'agencyId', select: 'name slug' })
      .lean();

    return ok(res, { review: toAdminReviewDTO(populated ?? review) });
  } catch (error) {
    logger.error('Error moderating review', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(res, { message: 'Failed to moderate review' });
  }
};

// ---------------------------------------------------------------------------
// Evictions queue.
// ---------------------------------------------------------------------------

export const getModerationEvictions = async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parsePageLimit(req);

    // Group open reports by case, most-recently-reported case first, and
    // paginate on the CASE (one queue row per reported case).
    const groupStages = [
      { $match: { status: ListingReportStatus.OPEN } },
      { $group: { _id: '$caseId', latest: { $max: '$createdAt' } } },
    ];

    const [totalGroups, pageGroups] = await Promise.all([
      EvictionReport.aggregate([...groupStages, { $count: 'count' }]),
      EvictionReport.aggregate([
        ...groupStages,
        { $sort: { latest: -1 } },
        { $skip: skip },
        { $limit: limit },
      ]),
    ]);
    const total = totalGroups[0]?.count ?? 0;

    const caseIds = pageGroups.map((group) => group._id).filter(Boolean);

    const [cases, reports] = await Promise.all([
      EvictionCase.find({ _id: { $in: caseIds } }).lean(),
      EvictionReport.find({ caseId: { $in: caseIds }, status: ListingReportStatus.OPEN })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const caseById = new Map(cases.map((doc) => [String(doc._id), doc]));
    const reportsByCase = new Map<string, unknown[]>();
    for (const report of reports) {
      const key = String(report.caseId);
      const bucket = reportsByCase.get(key) ?? [];
      bucket.push(report);
      reportsByCase.set(key, bucket);
    }

    // Preserve the reported-order of `pageGroups`; skip orphaned reports whose
    // case was hard-deleted by its owner (no case DTO to show).
    const items = caseIds
      .map((caseId) => {
        const key = String(caseId);
        const caseDoc = caseById.get(key);
        if (!caseDoc) return null;
        return {
          case: toEvictionDTO(caseDoc),
          reports: (reportsByCase.get(key) ?? []).map((report) => toEvictionReportDTO(report)),
        };
      })
      .filter((entry): entry is { case: ReturnType<typeof toEvictionDTO>; reports: ReturnType<typeof toEvictionReportDTO>[] } => entry !== null);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return ok(res, {
      cases: items,
      pagination: { currentPage: page, totalPages, total, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching moderation evictions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(res, { message: 'Failed to fetch moderation evictions' });
  }
};

export const moderateEviction = async (req: Request, res: Response) => {
  try {
    const { caseId } = req.params;
    const action = (req.body?.action ?? '') as string;

    if (!Types.ObjectId.isValid(caseId)) {
      return badRequest(res, { message: 'Invalid case ID' });
    }
    if (!EVICTION_ACTIONS.has(action)) {
      return badRequest(res, { message: 'A valid action is required' });
    }

    const evictionCase = await EvictionCase.findById(caseId);
    if (!evictionCase) {
      return notFound(res, { message: 'Eviction case not found' });
    }

    if ((action as AdminEvictionModerationAction) === 'remove') {
      // Non-destructive: cancel the case (owner DELETE stays the only hard
      // delete) and resolve its open reports.
      const updated = await EvictionCase.findByIdAndUpdate(
        caseId,
        { $set: { status: EvictionCaseStatus.CANCELLED } },
        { new: true },
      );
      const { modifiedCount } = await EvictionReport.updateMany(
        { caseId, status: ListingReportStatus.OPEN },
        { $set: { status: ListingReportStatus.RESOLVED } },
      );

      logger.info('Admin cancelled eviction case', {
        caseId: String(caseId),
        adminOxyUserId: getOxyUserId(req),
        resolvedReports: modifiedCount,
      });

      return ok(res, {
        case: toEvictionDTO(updated ?? evictionCase),
        resolvedReports: modifiedCount,
      });
    }

    // dismiss_reports: leave the case; mark its open reports dismissed.
    const { modifiedCount } = await EvictionReport.updateMany(
      { caseId, status: ListingReportStatus.OPEN },
      { $set: { status: ListingReportStatus.DISMISSED } },
    );

    logger.info('Admin dismissed eviction reports', {
      caseId: String(caseId),
      adminOxyUserId: getOxyUserId(req),
      dismissedReports: modifiedCount,
    });

    return ok(res, {
      case: toEvictionDTO(evictionCase),
      dismissedReports: modifiedCount,
    });
  } catch (error) {
    logger.error('Error moderating eviction case', {
      error: error instanceof Error ? error.message : String(error),
    });
    return serverError(res, { message: 'Failed to moderate eviction case' });
  }
};
