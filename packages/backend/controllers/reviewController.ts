/**
 * Review Controller
 *
 * Handles the reviucasa-style address review system: hierarchical address
 * reviews (STREET → BUILDING → UNIT), agency attribution, helpful votes, trust
 * & safety reports, and the review-explore aggregations (cities → neighborhoods
 * → buildings).
 *
 * Security invariants (see AGENTS.md):
 *   - WRITES never trust the client: `createReview`/`updateReview` pick an
 *     explicit allowlist (`CREATABLE_REVIEW_FIELDS` / `EDITABLE_REVIEW_FIELDS`)
 *     — never `...req.body`. `oxyUserId`, the address hierarchy, `cityId`,
 *     `neighborhoodId`, `agencyId`, moderation and verification are all resolved
 *     server-side.
 *   - Update/delete resolve ownership with `Review.findOne({ _id, oxyUserId })`
 *     → a non-owner gets a 404 (never a leaky 400).
 *   - Every read serializes through `toReviewDTO`, which strips `helpfulVoters`
 *     and `reports` and hides `moderationStatus === 'removed'` reviews.
 */

import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Review, Agency, Property, Address } from '../models';
import { forwardGeocode } from '../services/geocodingService';
import { getErrorName, getValidationMessages } from '../utils/errors';
import { getRequiredOxyUserId, getOxyUserId } from '@oxyhq/core/server';
import { ReviewReportReason, ReviewModerationStatus } from '@homiio/shared-types';
import { pickFields } from '../utils/pickFields';
import { CREATABLE_REVIEW_FIELDS, EDITABLE_REVIEW_FIELDS } from './review/editableFields';
import { toReviewDTO } from './review/toReviewDTO';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { normalizeAgencyName, escapeRegex } from '../utils/agencyName';
import { logger } from '../middlewares/logging';
import { serializePropertyAddresses, ADDRESS_GEO_POPULATE } from '../services/propertyAddressSerializer';
import { serializePropertyImages } from '../services/imageSerializer';

const ok = (res: Response, data: Record<string, unknown>) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: Record<string, unknown>) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: Record<string, unknown>) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: Record<string, unknown>) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: Record<string, unknown>) => res.status(500).json({ success: false, ...data });

const MIN_TITLE_LENGTH = 5;
const MIN_OPINION_LENGTH = 10;
const MAX_REPORT_DETAILS_LENGTH = 500;
/** A review flips to 'under_review' once this many distinct users report it. */
const REPORTS_TO_UNDER_REVIEW = 3;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const ALLOWED_REPORT_REASONS = new Set<string>(Object.values(ReviewReportReason));

/** Parse `?page`/`?limit` with sane clamps. */
function parsePageLimit(req: Request): { page: number; limit: number } {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  return { page, limit };
}

/** Address populate used for review lists that surface an address label. */
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

// ---------------------------------------------------------------------------
// Hierarchical address reads (public, community-visible).
// ---------------------------------------------------------------------------

export const getReviewsByAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const viewer = getOxyUserId(req);

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const addressLevel = address.getAddressLevel();
    const pageNumber = parseInt(page as string, 10);
    const limitNumber = parseInt(limit as string, 10);
    const toDto = (review: unknown) => toReviewDTO(review, viewer);

    let responseData: Record<string, unknown> = {};

    switch (addressLevel) {
      case 'UNIT': {
        const unitData = await Review.getUnitViewData(addressId);
        responseData = {
          level: 'UNIT',
          unitReviews: unitData.unitReviews
            .slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber)
            .map(toDto),
          buildingSummary: unitData.buildingSummary,
          totalReviews: unitData.unitReviews.length,
          pagination: {
            currentPage: pageNumber,
            totalPages: Math.ceil(unitData.unitReviews.length / limitNumber),
            limit: limitNumber,
          },
        };
        break;
      }
      case 'BUILDING': {
        const buildingData = await Review.getBuildingViewData(addressId);
        const allReviews = [...buildingData.buildingReviews, ...buildingData.unitReviews];
        responseData = {
          level: 'BUILDING',
          buildingReviews: buildingData.buildingReviews.map(toDto),
          unitReviews: buildingData.unitReviews
            .slice((pageNumber - 1) * limitNumber, pageNumber * limitNumber)
            .map(toDto),
          aggregatedStats: buildingData.aggregatedStats,
          totalReviews: allReviews.length,
          pagination: {
            currentPage: pageNumber,
            totalPages: Math.ceil(allReviews.length / limitNumber),
            limit: limitNumber,
          },
        };
        break;
      }
      case 'STREET': {
        const streetData = await Review.getStreetViewData(addressId);
        responseData = {
          level: 'STREET',
          aggregatedStats: streetData.aggregatedStats,
          buildingCount: streetData.buildingCount,
          totalReviews: streetData.aggregatedStats.totalReviews,
        };
        break;
      }
      default:
        return badRequest(res, { message: 'Invalid address level for reviews' });
    }

    return ok(res, responseData);
  } catch (error) {
    logger.error('Error fetching hierarchical reviews', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch reviews' });
  }
};

export const getAddressReviewStats = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    if (!Types.ObjectId.isValid(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await Address.findById(addressId);
    if (!address) {
      return notFound(res, { message: 'Address not found' });
    }

    const addressLevel = address.getAddressLevel();
    let statsData: Record<string, unknown> = {};

    switch (addressLevel) {
      case 'UNIT': {
        const unitData = await Review.getUnitViewData(addressId);
        statsData = {
          level: 'UNIT',
          unitStats: {
            averageRating: unitData.unitReviews.length > 0
              ? unitData.unitReviews.reduce((sum, r) => sum + r.rating, 0) / unitData.unitReviews.length
              : 0,
            totalReviews: unitData.unitReviews.length,
            recommendationPercentage: unitData.unitReviews.length > 0
              ? (unitData.unitReviews.filter((r) => r.recommendation).length / unitData.unitReviews.length) * 100
              : 0,
          },
          buildingSummary: unitData.buildingSummary,
        };
        break;
      }
      case 'BUILDING': {
        const buildingData = await Review.getBuildingViewData(addressId);
        statsData = {
          level: 'BUILDING',
          aggregatedStats: buildingData.aggregatedStats,
          buildingReviewCount: buildingData.buildingReviews.length,
          unitReviewCount: buildingData.unitReviews.length,
        };
        break;
      }
      case 'STREET': {
        const streetData = await Review.getStreetViewData(addressId);
        statsData = {
          level: 'STREET',
          aggregatedStats: streetData.aggregatedStats,
          buildingCount: streetData.buildingCount,
        };
        break;
      }
      default:
        return badRequest(res, { message: 'Invalid address level for review stats' });
    }

    return ok(res, { stats: statsData });
  } catch (error) {
    logger.error('Error fetching hierarchical review stats', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch review statistics' });
  }
};

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

/**
 * Best-effort: notify every distinct property owner at the reviewed address /
 * building (excluding the reviewer) that a new review landed. Swallow-and-log —
 * the review must succeed even if notification dispatch fails.
 */
async function notifyAddressOwners(params: {
  reviewerOxyUserId: string;
  addressId: Types.ObjectId;
  buildingLevelId?: Types.ObjectId;
  reviewId: Types.ObjectId;
}): Promise<void> {
  try {
    const addressIds = [params.addressId];
    if (params.buildingLevelId && String(params.buildingLevelId) !== String(params.addressId)) {
      addressIds.push(params.buildingLevelId);
    }

    const owners: string[] = await Property.distinct('oxyUserId', {
      addressId: { $in: addressIds },
      oxyUserId: { $nin: [null, ''] },
    });

    const recipients = Array.from(new Set(owners.filter((id) => id && id !== params.reviewerOxyUserId)));

    await Promise.all(
      recipients.map((recipientOxyUserId) =>
        notificationDispatchService.createForUser(recipientOxyUserId, {
          type: 'address_review_created',
          title: 'New review at your property address',
          message: 'Someone posted a review at an address where you have a listing.',
          priority: 'low',
          data: {
            addressId: String(params.addressId),
            reviewId: String(params.reviewId),
          },
        }),
      ),
    );
  } catch (error) {
    logger.error('Failed to dispatch address_review_created notifications', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export const createReview = async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    const addressData = (req.body || {}).address as Record<string, string> | undefined;
    const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_REVIEW_FIELDS);

    if (!addressData || !addressData.street || !addressData.city || !addressData.postal_code || !addressData.country) {
      return badRequest(res, { message: 'Address information is required (street, city, postal_code, country)' });
    }

    const title = typeof picked.title === 'string' ? picked.title.trim() : '';
    if (title.length < MIN_TITLE_LENGTH) {
      return badRequest(res, { message: `Title must be at least ${MIN_TITLE_LENGTH} characters long` });
    }

    const opinion = typeof picked.opinion === 'string' ? picked.opinion.trim() : '';
    if (opinion.length < MIN_OPINION_LENGTH) {
      return badRequest(res, { message: `Opinion must be at least ${MIN_OPINION_LENGTH} characters long` });
    }

    let coordinates = addressData.latitude && addressData.longitude
      ? { type: 'Point' as const, coordinates: [parseFloat(addressData.longitude), parseFloat(addressData.latitude)] as [number, number] }
      : undefined;

    if (!coordinates) {
      const query = [addressData.street, addressData.number, addressData.city, addressData.state, addressData.postal_code, addressData.country]
        .filter(Boolean)
        .join(', ');
      const geocoded = await forwardGeocode(query);
      if (!geocoded.success || !geocoded.data?.coordinates) {
        return badRequest(res, { message: 'Could not resolve coordinates for the address; please include latitude and longitude' });
      }
      coordinates = { type: 'Point', coordinates: geocoded.data.coordinates };
    }

    const address = await Address.findOrCreateCanonical({
      street: addressData.street.trim(),
      number: addressData.number?.trim() || undefined,
      building_name: addressData.building_name?.trim() || undefined,
      floor: addressData.floor?.trim() || undefined,
      unit: addressData.unit?.trim() || undefined,
      postal_code: addressData.postal_code.trim(),
      city: addressData.city.trim(),
      state: addressData.state?.trim() || undefined,
      country: addressData.country.trim(),
      countryCode: addressData.countryCode,
      neighborhood: addressData.neighborhood?.trim() || undefined,
      coordinates,
    });

    const addressLevel = address.getAddressLevel();

    if (!['BUILDING', 'UNIT'].includes(addressLevel)) {
      return badRequest(res, { message: 'Reviews can only be created at BUILDING or UNIT level addresses' });
    }

    const existingReview = await Review.findOne({ oxyUserId, addressId: address._id });
    if (existingReview) {
      return badRequest(res, { message: 'You have already reviewed this address' });
    }

    const hierarchicalData: {
      addressLevel: string;
      addressId: Types.ObjectId;
      unitLevelId?: Types.ObjectId;
      buildingLevelId?: Types.ObjectId;
      streetLevelId?: Types.ObjectId;
    } = {
      addressLevel,
      addressId: address._id,
    };

    if (addressLevel === 'UNIT') {
      const buildingLevelData = address.createBuildingLevel();
      let buildingLevel = await Address.findOne(buildingLevelData);
      if (!buildingLevel) {
        buildingLevel = await Address.create(buildingLevelData);
      }

      const streetLevelData = address.createStreetLevel();
      let streetLevel = await Address.findOne(streetLevelData);
      if (!streetLevel) {
        streetLevel = await Address.create(streetLevelData);
      }

      hierarchicalData.unitLevelId = address._id;
      hierarchicalData.buildingLevelId = buildingLevel._id;
      hierarchicalData.streetLevelId = streetLevel._id;
    } else if (addressLevel === 'BUILDING') {
      const streetLevelData = address.createStreetLevel();
      let streetLevel = await Address.findOne(streetLevelData);
      if (!streetLevel) {
        streetLevel = await Address.create(streetLevelData);
      }

      hierarchicalData.buildingLevelId = address._id;
      hierarchicalData.streetLevelId = streetLevel._id;
    }

    // Resolve the submitted agency name into a canonical Agency (write-only
    // input); the raw name is never persisted on the review.
    const agencyName = typeof picked.agencyName === 'string' ? picked.agencyName : undefined;
    delete picked.agencyName;
    let agencyId: Types.ObjectId | undefined;
    if (agencyName && agencyName.trim()) {
      const agency = await Agency.findOrCreateByName(agencyName);
      if (agency) agencyId = agency._id;
    }

    const review = new Review({
      ...picked,
      ...hierarchicalData,
      oxyUserId,
      cityId: address.cityId,
      neighborhoodId: address.neighborhoodId,
      agencyId,
    });

    await review.save();

    await notifyAddressOwners({
      reviewerOxyUserId: oxyUserId,
      addressId: address._id,
      buildingLevelId: hierarchicalData.buildingLevelId,
      reviewId: review._id,
    });

    const populatedReview = await Review.findById(review._id)
      .populate(REVIEW_ADDRESS_POPULATE)
      .populate({ path: 'agencyId', select: 'name slug' })
      .lean();

    return created(res, { review: toReviewDTO(populatedReview, oxyUserId) });
  } catch (error) {
    logger.error('Error creating review', { error: error instanceof Error ? error.message : String(error) });
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error),
      });
    }
    return serverError(res, { message: 'Failed to create review' });
  }
};

// ---------------------------------------------------------------------------
// Single review read / update / delete.
// ---------------------------------------------------------------------------

export const getReviewById = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const viewer = getOxyUserId(req);

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId)
      .populate(REVIEW_ADDRESS_POPULATE)
      .populate({ path: 'agencyId', select: 'name slug' })
      .lean();

    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    // Hide removed reviews from everyone but their author.
    if (review.moderationStatus === ReviewModerationStatus.REMOVED && (!viewer || String(review.oxyUserId) !== viewer)) {
      return notFound(res, { message: 'Review not found' });
    }

    return ok(res, { review: toReviewDTO(review, viewer) });
  } catch (error) {
    logger.error('Error fetching review', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch review' });
  }
};

export const updateReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    // Ownership + existence in one query: a non-owner (or missing) review is a
    // 404, never a leaky 400 that reveals the review exists.
    const review = await Review.findOne({ _id: reviewId, oxyUserId });
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    const picked = pickFields<Record<string, unknown>>(req.body, EDITABLE_REVIEW_FIELDS);

    // Re-resolve agency attribution when an agency name is (re)supplied.
    if (Object.prototype.hasOwnProperty.call(picked, 'agencyName')) {
      const agencyName = typeof picked.agencyName === 'string' ? picked.agencyName.trim() : '';
      delete picked.agencyName;
      if (agencyName) {
        const agency = await Agency.findOrCreateByName(agencyName);
        if (agency) review.agencyId = agency._id;
      }
    }

    review.set(picked);
    await review.save();

    const populatedReview = await Review.findById(review._id)
      .populate(REVIEW_ADDRESS_POPULATE)
      .populate({ path: 'agencyId', select: 'name slug' })
      .lean();

    return ok(res, { review: toReviewDTO(populatedReview, oxyUserId) });
  } catch (error) {
    logger.error('Error updating review', { error: error instanceof Error ? error.message : String(error) });
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error),
      });
    }
    return serverError(res, { message: 'Failed to update review' });
  }
};

export const deleteReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findOneAndDelete({ _id: reviewId, oxyUserId });
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    return ok(res, { message: 'Review deleted successfully' });
  } catch (error) {
    logger.error('Error deleting review', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to delete review' });
  }
};

export const getUserReviews = async (req: Request, res: Response) => {
  try {
    const { oxyUserId } = req.params;
    const viewer = getOxyUserId(req);
    const { page, limit } = parsePageLimit(req);

    if (!oxyUserId) {
      return badRequest(res, { message: 'Oxy user id is required' });
    }

    const filter = { oxyUserId, moderationStatus: { $ne: ReviewModerationStatus.REMOVED } };
    const skip = (page - 1) * limit;

    const [reviews, totalReviews] = await Promise.all([
      Review.find(filter)
        .populate(REVIEW_ADDRESS_POPULATE)
        .populate({ path: 'agencyId', select: 'name slug' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalReviews / limit);
    return ok(res, {
      reviews: reviews.map((review) => toReviewDTO(review, viewer)),
      pagination: { currentPage: page, totalPages, totalReviews, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching user reviews', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch user reviews' });
  }
};

// ---------------------------------------------------------------------------
// Helpful votes + reports.
// ---------------------------------------------------------------------------

export const toggleHelpful = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    if (String(review.oxyUserId) === oxyUserId) {
      return badRequest(res, { message: 'You cannot mark your own review as helpful' });
    }

    const alreadyVoted = (review.helpfulVoters || []).map(String).includes(oxyUserId);
    const update = alreadyVoted
      ? { $pull: { helpfulVoters: oxyUserId } }
      : { $addToSet: { helpfulVoters: oxyUserId } };

    const updated = await Review.findByIdAndUpdate(reviewId, update, { new: true });
    const helpfulCount = updated?.helpfulVoters?.length ?? 0;
    const viewerHasVotedHelpful = !alreadyVoted;

    // Notify the author on a NEW helpful vote only (never on un-vote, never for
    // one's own review — already rejected above). Best-effort.
    if (!alreadyVoted) {
      await notificationDispatchService.createForUser(String(review.oxyUserId), {
        type: 'review_helpful',
        title: 'Your review was marked helpful',
        message: 'Someone found your address review helpful.',
        priority: 'low',
        data: { reviewId: String(review._id) },
      });
    }

    return ok(res, { helpfulCount, viewerHasVotedHelpful });
  } catch (error) {
    logger.error('Error toggling helpful vote', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to toggle helpful vote' });
  }
};

export const reportReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);
    const { reason, details } = req.body || {};

    if (!Types.ObjectId.isValid(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    if (!reason || !ALLOWED_REPORT_REASONS.has(reason)) {
      return badRequest(res, { message: 'A valid report reason is required' });
    }

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    if (trimmedDetails.length > MAX_REPORT_DETAILS_LENGTH) {
      return badRequest(res, { message: 'Report details are too long' });
    }
    if (reason === ReviewReportReason.OTHER && !trimmedDetails) {
      return badRequest(res, { message: 'Details are required when the reason is "other"' });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    // Dedup: one report per reporter. Re-filing is a no-op (200).
    const alreadyReported = (review.reports || []).some((report) => String(report.oxyUserId) === oxyUserId);
    if (alreadyReported) {
      return ok(res, { message: 'Report already submitted', moderationStatus: review.moderationStatus });
    }

    review.reports.push({
      oxyUserId,
      reason,
      details: trimmedDetails || undefined,
      createdAt: new Date(),
    });

    // Escalate to moderation once enough distinct users have reported it.
    if (review.reports.length >= REPORTS_TO_UNDER_REVIEW && review.moderationStatus === ReviewModerationStatus.ACTIVE) {
      review.moderationStatus = ReviewModerationStatus.UNDER_REVIEW;
    }

    await review.save();

    return created(res, { message: 'Report submitted', moderationStatus: review.moderationStatus });
  } catch (error) {
    logger.error('Error reporting review', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to report review' });
  }
};

// ---------------------------------------------------------------------------
// Agencies (public reads).
// ---------------------------------------------------------------------------

interface AgencyLike {
  _id: unknown;
  name: string;
  slug: string;
}

function toAgencySummary(agency: AgencyLike): { id: string; name: string; slug: string } {
  return { id: String(agency._id), name: agency.name, slug: agency.slug };
}

export const searchAgencies = async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return ok(res, { agencies: [] });
    }

    const normalized = normalizeAgencyName(q);
    if (!normalized) {
      return ok(res, { agencies: [] });
    }

    const agencies = await Agency.find({ normalizedName: { $regex: `^${escapeRegex(normalized)}` } })
      .sort({ normalizedName: 1 })
      .limit(10)
      .lean();

    return ok(res, { agencies: agencies.map((agency) => toAgencySummary(agency as unknown as AgencyLike)) });
  } catch (error) {
    logger.error('Error searching agencies', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to search agencies' });
  }
};

export const getAgencyBySlug = async (req: Request, res: Response) => {
  try {
    const agency = await Agency.findOne({ slug: req.params.slug }).lean();
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }

    const [stats, listingsCount] = await Promise.all([
      Review.getAgencyStats(agency._id),
      Property.countDocuments({ agencyId: agency._id, status: 'published', deletedAt: null }),
    ]);

    return ok(res, {
      agency: toAgencySummary(agency as unknown as AgencyLike),
      stats: { ...stats, listingsCount },
    });
  } catch (error) {
    logger.error('Error fetching agency', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch agency' });
  }
};

export const getAgencyReviews = async (req: Request, res: Response) => {
  try {
    const viewer = getOxyUserId(req);
    const { page, limit } = parsePageLimit(req);

    const agency = await Agency.findOne({ slug: req.params.slug }).lean();
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }

    const filter = { agencyId: agency._id, moderationStatus: { $ne: ReviewModerationStatus.REMOVED } };
    const skip = (page - 1) * limit;

    const [reviews, totalReviews] = await Promise.all([
      Review.find(filter)
        .populate(REVIEW_ADDRESS_POPULATE)
        .populate({ path: 'agencyId', select: 'name slug' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Review.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalReviews / limit);
    return ok(res, {
      agency: toAgencySummary(agency as unknown as AgencyLike),
      reviews: reviews.map((review) => toReviewDTO(review, viewer)),
      pagination: { currentPage: page, totalPages, totalReviews, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching agency reviews', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch agency reviews' });
  }
};

export const getAgencyProperties = async (req: Request, res: Response) => {
  try {
    const { page, limit } = parsePageLimit(req);

    const agency = await Agency.findOne({ slug: req.params.slug }).lean();
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }

    const filter = { agencyId: agency._id, status: 'published', deletedAt: null };
    const skip = (page - 1) * limit;

    const [properties, total] = await Promise.all([
      Property.find(filter)
        .populate(ADDRESS_GEO_POPULATE)
        .sort({ hasImages: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Property.countDocuments(filter),
    ]);

    serializePropertyAddresses(properties);
    serializePropertyImages(properties);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({
      success: true,
      data: properties,
      pagination: { page, limit, total, totalPages },
      total,
      page,
      limit,
      totalPages,
      hasMore: (page - 1) * limit + properties.length < total,
    });
  } catch (error) {
    logger.error('Error fetching agency properties', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch agency properties' });
  }
};

// ---------------------------------------------------------------------------
// Review-explore aggregations (public reads).
// ---------------------------------------------------------------------------

export const getExploreCities = async (_req: Request, res: Response) => {
  try {
    const cities = await Review.getCitiesWithReviews();
    return ok(res, { cities });
  } catch (error) {
    logger.error('Error fetching explore cities', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch explore cities' });
  }
};

export const getExploreCity = async (req: Request, res: Response) => {
  try {
    const { cityId } = req.params;
    if (!Types.ObjectId.isValid(cityId)) {
      return badRequest(res, { message: 'Invalid city ID' });
    }
    const neighborhoods = await Review.getNeighborhoodSummaries(cityId);
    return ok(res, { neighborhoods });
  } catch (error) {
    logger.error('Error fetching explore city', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch explore city' });
  }
};

export const getExploreNeighborhood = async (req: Request, res: Response) => {
  try {
    const { neighborhoodId } = req.params;
    const { page, limit } = parsePageLimit(req);

    if (!Types.ObjectId.isValid(neighborhoodId)) {
      return badRequest(res, { message: 'Invalid neighborhood ID' });
    }

    const { buildings, total } = await Review.getBuildingSummaries(neighborhoodId, page, limit);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return ok(res, {
      buildings,
      pagination: { currentPage: page, totalPages, total, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching explore neighborhood', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch explore neighborhood' });
  }
};
