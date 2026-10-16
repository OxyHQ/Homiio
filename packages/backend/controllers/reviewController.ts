/**
 * Review Controller
 *
 * The HTTP edge of the review system. The address-review reads, writes,
 * helpful votes and reports are use cases in `domain/reviews.ts`, which the
 * capability catalogue calls too; the agency and explore reads below stay here.
 *
 * Handles the reviucasa-style address review system: hierarchical address
 * reviews (STREET → BUILDING → UNIT), agency attribution, helpful votes, trust
 * & safety reports, and the review-explore aggregations (cities → neighborhoods
 * → buildings).
 *
 * Postgres throughout. The repositories are `db/reviews/` (reads, writes,
 * aggregates, serialization), `db/agencies/` (the agency lookup and the
 * find-or-create), and `services/addressService.ts` (the canonical address and
 * the street/building hierarchy above it).
 *
 * Security invariants (see AGENTS.md):
 *   - WRITES never trust the client: `createReview`/`updateReview` pick an
 *     explicit allowlist (`CREATABLE_REVIEW_FIELDS` / `EDITABLE_REVIEW_FIELDS`)
 *     — never `...req.body`. `oxyUserId`, the address hierarchy, `cityId`,
 *     `neighborhoodId`, `agencyId`, `livedForMonths`, moderation and
 *     verification are all resolved server-side.
 *   - Update/delete carry `and(id, oxyUserId)` in the STATEMENT
 *     (`db/reviews/reviewWrites.ts`) → a non-owner gets a 404, never a leaky 400.
 *   - Every read serializes through `serializeReview`, which names the columns it
 *     publishes rather than spreading the row. The helpful voters and the report
 *     queue are separate TABLES that no read here selects from, so there is no
 *     key to forget to strip.
 *   - A `removed` review is visible to its author and to nobody else. That rule
 *     is applied in three places and only three: `getReviewById`,
 *     `getUserReviews`, and the `visibleModeration()` predicate every public list
 *     and aggregate carries.
 *
 * ## No `isValidObjectId` guard survives in this file
 *
 * There were eight, and every one of them BRANCHED: post-cutover every review,
 * address, city and neighborhood id is a uuid v7, for which the guard is false,
 * so each would have answered "invalid ID" about a row sitting there intact.
 * `db/ids.ts` carries the rule and the measurement. What replaces one is a bare
 * non-empty-string check, with the lookup itself answering "no such row" for
 * every id shape — a `text` primary key takes any string.
 */

import type { Request, Response } from 'express';
import { getRequiredOxyUserId, getOxyUserId } from '@oxy.so/core/server';
import { oxyService } from '../services/oxy';
import { getAgencySummaries } from '../services/organizations/directory';
import { logger } from '../middlewares/logging';
import type { SQL } from 'drizzle-orm';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
  NEWEST_FIRST,
} from '../db/properties/propertyReads';
import {
  notDeleted,
  notModerationRestricted,
  ofAgency as listingsOfAgency,
  statusIs,
} from '../db/properties/propertyFilters';
import { serializeProperty } from '../db/properties/propertySerializer';
import { findAgencyBySlug } from '../db/agencies/agencyReads';
import type { AgencyRow } from '../db/agencies/agencyWrites';
import {
  allOfReviews,
  countReviews,
  findReviews,
  NEWEST_REVIEWS_FIRST,
  ofAgency,
  visibleModeration,
} from '../db/reviews/reviewReads';
import {
  getAgencyStats,
  getBuildingSummaries,
  getCitiesWithReviews,
  getNeighborhoodSummaries,
} from '../db/reviews/reviewAggregates';
import {
  deleteReview as removeReview,
  getAddressReviewStats as readAddressReviewStats,
  getReview,
  isPossibleId,
  listAddressReviews,
  listUserReviews,
  parsePageLimit,
  reportReview as fileReviewReport,
  ReviewRequestError,
  serializeReviews,
  toggleReviewHelpful,
  updateReview as editReview,
  writeReview,
} from '../domain/reviews';
import { AppError, describeErrorForLog } from '../middlewares/errorHandler';

const ok = (res: Response, data: Record<string, unknown>) =>
  res.status(200).json({ success: true, ...data });
const created = (res: Response, data: Record<string, unknown>) =>
  res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: Record<string, unknown>) =>
  res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: Record<string, unknown>) =>
  res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: Record<string, unknown>) =>
  res.status(500).json({ success: false, ...data });

/**
 * Render a domain refusal the way each handler here always has: a
 * `ReviewRequestError` as `{ success: false, message, errors? }`; any other
 * `AppError` (create/update only) with its `code`; everything else a logged 500.
 */
function refuse(
  res: Response,
  error: unknown,
  failure: string,
  log: string,
  options: { appErrorsWithCode?: boolean } = {},
) {
  if (error instanceof ReviewRequestError) {
    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
      ...(error.errors ? { errors: error.errors } : {}),
    });
  }
  if (options.appErrorsWithCode && error instanceof AppError) {
    return res
      .status(error.statusCode)
      .json({ success: false, message: error.message, code: error.code });
  }
  logger.error(log, { error: describeErrorForLog(error) });
  return serverError(res, { message: failure });
}

// ---------------------------------------------------------------------------
// Hierarchical address reads (public, community-visible) — `domain/reviews.ts`.
// ---------------------------------------------------------------------------

export const getReviewsByAddress = async (req: Request, res: Response) => {
  try {
    return ok(res, await listAddressReviews(getOxyUserId(req), req.params.addressId, req.query));
  } catch (error) {
    return refuse(res, error, 'Failed to fetch reviews', 'Error fetching hierarchical reviews');
  }
};

export const getAddressReviewStats = async (req: Request, res: Response) => {
  try {
    return ok(res, await readAddressReviewStats(req.params.addressId));
  } catch (error) {
    return refuse(
      res,
      error,
      'Failed to fetch review statistics',
      'Error fetching hierarchical review stats',
    );
  }
};

// ---------------------------------------------------------------------------
// Create / read / update / delete — `domain/reviews.ts`.
// ---------------------------------------------------------------------------

export const createReview = async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    return created(res, await writeReview(oxyUserId, req.body));
  } catch (error) {
    return refuse(res, error, 'Failed to create review', 'Error creating review', {
      appErrorsWithCode: true,
    });
  }
};

export const getReviewById = async (req: Request, res: Response) => {
  try {
    return ok(res, await getReview(getOxyUserId(req), req.params.reviewId));
  } catch (error) {
    return refuse(res, error, 'Failed to fetch review', 'Error fetching review');
  }
};

export const updateReview = async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    return ok(res, await editReview(oxyUserId, req.params.reviewId, req.body));
  } catch (error) {
    return refuse(res, error, 'Failed to update review', 'Error updating review', {
      appErrorsWithCode: true,
    });
  }
};

export const deleteReview = async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    await removeReview(oxyUserId, req.params.reviewId);
    return ok(res, { message: 'Review deleted successfully' });
  } catch (error) {
    return refuse(res, error, 'Failed to delete review', 'Error deleting review');
  }
};

export const getUserReviews = async (req: Request, res: Response) => {
  try {
    return ok(res, await listUserReviews(getOxyUserId(req), req.params.oxyUserId, req.query));
  } catch (error) {
    return refuse(res, error, 'Failed to fetch user reviews', 'Error fetching user reviews');
  }
};

// ---------------------------------------------------------------------------
// Helpful votes + reports — `domain/reviews.ts`.
// ---------------------------------------------------------------------------

export const toggleHelpful = async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    return ok(res, await toggleReviewHelpful(oxyUserId, req.params.reviewId));
  } catch (error) {
    return refuse(res, error, 'Failed to toggle helpful vote', 'Error toggling helpful vote');
  }
};

export const reportReview = async (req: Request, res: Response) => {
  try {
    const oxyUserId = getRequiredOxyUserId(req);
    const outcome = await fileReviewReport(oxyUserId, req.params.reviewId, req.body || {});
    const body = { message: outcome.message, moderationStatus: outcome.moderationStatus };
    return outcome.created ? created(res, body) : ok(res, body);
  } catch (error) {
    return refuse(res, error, 'Failed to report review', 'Error reporting review');
  }
};

// ---------------------------------------------------------------------------
// Agencies (public reads).
// ---------------------------------------------------------------------------

/**
 * What the public may see of an agency's catalogue: published, not archived,
 * not restricted by a jury.
 *
 * A drizzle predicate shared by the agency listing count and the agency listing
 * page. It is a FUNCTION
 * because a `SQL` fragment carries its own bound parameters and must not be
 * shared between two statements as a constant.
 */
function publicAgencyListings(agencyId: string): SQL | undefined {
  return allOf([
    statusIs('published'),
    notDeleted(),
    notModerationRestricted(),
    listingsOfAgency(agencyId),
  ]);
}

async function toAgencySummary(agency: AgencyRow) {
  return (await getAgencySummaries([agency.id])).get(agency.id);
}

export const searchAgencies = async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) {
      return ok(res, { agencies: [] });
    }

    const result = await oxyService.organizations.search({
      query: q,
      organizationType: 'business',
      limit: 10,
    });
    return ok(res, {
      agencies: result.items
        .filter((company) => company.status === 'active')
        .map((company) => ({ oxyAccountId: company.accountId, name: company.name })),
    });
  } catch (error) {
    logger.error('Error searching agencies', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to search agencies' });
  }
};

export const getAgencyBySlug = async (req: Request, res: Response) => {
  try {
    const agency = await findAgencyBySlug(req.params.slug);
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }
    if (agency.identityStatus !== 'linked')
      return res.status(409).json({
        success: false,
        error: 'agency_identity_unresolved',
        message: 'This historical agency reference is awaiting organization identity resolution.',
      });
    const company = await toAgencySummary(agency);
    if (!company) return notFound(res, { message: 'Agency not found' });

    const [stats, listingsCount] = await Promise.all([
      getAgencyStats(agency.id),
      countProperties(publicAgencyListings(agency.id)),
    ]);

    return ok(res, {
      agency: company,
      stats: { ...stats, listingsCount },
    });
  } catch (error) {
    logger.error('Error fetching agency', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to fetch agency' });
  }
};

export const getAgencyReviews = async (req: Request, res: Response) => {
  try {
    const viewer = getOxyUserId(req);
    const { page, limit } = parsePageLimit(req.query);

    const agency = await findAgencyBySlug(req.params.slug);
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }
    if (agency.identityStatus !== 'linked')
      return res.status(409).json({
        success: false,
        error: 'agency_identity_unresolved',
        message: 'This historical agency reference is awaiting organization identity resolution.',
      });
    const company = await toAgencySummary(agency);
    if (!company) return notFound(res, { message: 'Agency not found' });

    const where = allOfReviews([ofAgency(agency.id), visibleModeration()]);
    const offset = (page - 1) * limit;

    const [hydrated, totalReviews] = await Promise.all([
      findReviews({ where, orderBy: [NEWEST_REVIEWS_FIRST], limit, offset, viewer }),
      countReviews(where),
    ]);

    const totalPages = Math.ceil(totalReviews / limit);
    return ok(res, {
      agency: company,
      reviews: serializeReviews(hydrated, viewer),
      pagination: { currentPage: page, totalPages, totalReviews, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching agency reviews', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to fetch agency reviews' });
  }
};

export const getAgencyProperties = async (req: Request, res: Response) => {
  try {
    const { page, limit } = parsePageLimit(req.query);

    const agency = await findAgencyBySlug(req.params.slug);
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }
    if (agency.identityStatus !== 'linked')
      return res.status(409).json({
        success: false,
        error: 'agency_identity_unresolved',
        message: 'This historical agency reference is awaiting organization identity resolution.',
      });
    const company = await toAgencySummary(agency);
    if (!company) return notFound(res, { message: 'Agency not found' });

    const where = publicAgencyListings(agency.id);
    const skip = (page - 1) * limit;

    const [hydrated, total] = await Promise.all([
      // Image-bearing listings first (product rule), then newest.
      findProperties({ where, orderBy: propertyOrderBy(NEWEST_FIRST), limit, offset: skip }),
      countProperties(where),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));
    return res.json({
      success: true,
      data: hydrated.map((listing) => serializeProperty(listing, 'public')),
      pagination: { page, limit, total, totalPages },
      total,
      page,
      limit,
      totalPages,
      hasMore: (page - 1) * limit + hydrated.length < total,
    });
  } catch (error) {
    logger.error('Error fetching agency properties', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to fetch agency properties' });
  }
};

// ---------------------------------------------------------------------------
// Review-explore aggregations (public reads).
// ---------------------------------------------------------------------------

export const getExploreCities = async (_req: Request, res: Response) => {
  try {
    const cities = await getCitiesWithReviews();
    return ok(res, { cities });
  } catch (error) {
    logger.error('Error fetching explore cities', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to fetch explore cities' });
  }
};

export const getExploreCity = async (req: Request, res: Response) => {
  try {
    const { cityId } = req.params;
    if (!isPossibleId(cityId)) {
      return badRequest(res, { message: 'Invalid city ID' });
    }
    const neighborhoods = await getNeighborhoodSummaries(cityId);
    return ok(res, { neighborhoods });
  } catch (error) {
    logger.error('Error fetching explore city', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to fetch explore city' });
  }
};

export const getExploreNeighborhood = async (req: Request, res: Response) => {
  try {
    const { neighborhoodId } = req.params;
    const { page, limit } = parsePageLimit(req.query);

    if (!isPossibleId(neighborhoodId)) {
      return badRequest(res, { message: 'Invalid neighborhood ID' });
    }

    const { buildings, total } = await getBuildingSummaries({ neighborhoodId, page, limit });
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return ok(res, {
      buildings,
      pagination: { currentPage: page, totalPages, total, limit },
      hasMore: page < totalPages,
      totalPages,
    });
  } catch (error) {
    logger.error('Error fetching explore neighborhood', { error: describeErrorForLog(error) });
    return serverError(res, { message: 'Failed to fetch explore neighborhood' });
  }
};
