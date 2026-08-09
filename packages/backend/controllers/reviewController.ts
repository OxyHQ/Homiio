/**
 * Review Controller
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

import { Request, Response } from 'express';
import { forwardGeocode } from '../services/geocodingService';
import { getRequiredOxyUserId, getOxyUserId } from '@oxyhq/core/server';
import {
  ReviewReportReason,
  ReviewModerationStatus,
  ModerationReportedType,
} from '@homiio/shared-types';
import { pickFields } from '../utils/pickFields';
import { CREATABLE_REVIEW_FIELDS, EDITABLE_REVIEW_FIELDS } from './review/editableFields';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { normalizeAgencyName } from '../utils/agencyName';
import { logger } from '../middlewares/logging';
import { eq, type SQL } from 'drizzle-orm';
import {
  allOf,
  countProperties,
  findOwnerOxyUserIdsAtAddresses,
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
import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../services/moderation/ReportIntakeService';
import { DuplicateModerationReportError } from '../db/moderation/moderationReportRepository';
import {
  DuplicateReviewReportError,
  findReviewForReport,
  hasReportedReview,
  insertReviewReportAndEscalate,
} from '../db/moderation/reviewReportRepository';
import { getDb } from '../db/postgres';
import { addresses } from '../db/schema';
import { findAgenciesByNamePrefix, findAgencyBySlug } from '../db/agencies/agencyReads';
import { findOrCreateAgencyByName, type AgencyRow } from '../db/agencies/agencyWrites';
import {
  findOrCreateCanonicalAddress,
  resolveAddressHierarchy,
  selectAddressWithGeoNames,
} from '../services/addressService';
import { normalizeReviewCreateInput, normalizeReviewEditInput } from './review/reviewInput';
import {
  allOfReviews,
  atAddress,
  atBuildingLevel,
  atUnitLevel,
  byAuthor,
  countReviews,
  findReviewById,
  findReviews,
  levelIs,
  NEWEST_REVIEWS_FIRST,
  ofAgency,
  visibleModeration,
} from '../db/reviews/reviewReads';
import { serializeReview, type HydratedReview } from '../db/reviews/reviewSerializer';
import {
  countBuildingsOnStreet,
  getAgencyStats,
  getBuildingSummaries,
  getCitiesWithReviews,
  getNeighborhoodSummaries,
  summarizeBuilding,
  summarizeBuildingOfUnit,
  summarizeStreet,
  summarizeUnit,
  type ReviewSummaryStats,
} from '../db/reviews/reviewAggregates';
import {
  deleteOwnReview,
  DuplicateReviewError,
  findReviewAuthor,
  insertReview,
  toggleHelpfulVote,
  updateOwnReview,
  type ReviewPatch,
} from '../db/reviews/reviewWrites';

const ok = (res: Response, data: Record<string, unknown>) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: Record<string, unknown>) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: Record<string, unknown>) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: Record<string, unknown>) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: Record<string, unknown>) => res.status(500).json({ success: false, ...data });

const MIN_TITLE_LENGTH = 5;
const MIN_OPINION_LENGTH = 10;
const MAX_REPORT_DETAILS_LENGTH = 500;
// The escalation threshold moved to `db/moderation/reviewReportRepository.ts`,
// beside the count it is compared against — a copy here could disagree with the
// one the transaction actually applies.
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

const ALLOWED_REPORT_REASONS = new Set<string>(Object.values(ReviewReportReason));

/**
 * Narrow a request-supplied reason to the stored vocabulary.
 *
 * A predicate rather than a cast: `review_reports.reason` carries a CHECK
 * derived from the same tuple, so a cast would let a value the database refuses
 * reach the insert and surface as a 500 instead of the 400 it is.
 */
function isReviewReportReason(value: string): value is ReviewReportReason {
  return ALLOWED_REPORT_REASONS.has(value);
}

/** Parse `?page`/`?limit` with sane clamps. */
function parsePageLimit(req: Request): { page: number; limit: number } {
  const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(req.query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, rawLimit));
  return { page, limit };
}

/**
 * A route parameter that could name a row.
 *
 * This is what replaced the eight `Types.ObjectId.isValid` guards, and it is
 * deliberately the weakest possible check: it rejects a missing or empty
 * segment, and everything else goes to the query, which answers "no such row"
 * for a nonsense id without help. Using `isLiveEntityId` here instead would
 * re-introduce the fail-open bug in a new costume — `db/ids.ts` says so
 * explicitly.
 */
function isPossibleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** Serialize a page of reviews. */
function serializeReviews(hydrated: readonly HydratedReview[]): Record<string, unknown>[] {
  return hydrated.map(serializeReview);
}

// ---------------------------------------------------------------------------
// Hierarchical address reads (public, community-visible).
// ---------------------------------------------------------------------------

/**
 * Page a list in the APPLICATION, as the hierarchical reads have always done.
 *
 * Carried across verbatim rather than pushed into SQL, because these endpoints
 * publish `totalReviews` over the WHOLE set beside a page of it and the Mongo
 * implementation derived both from one array. Pushing the slice into the query
 * would need a second count and would change what `totalReviews` means for a
 * BUILDING read, where it counts building AND unit reviews while the page slices
 * only the unit ones.
 */
function pageOf<T>(items: readonly T[], page: number, limit: number): T[] {
  return items.slice((page - 1) * limit, page * limit);
}

/**
 * Everything both hierarchy endpoints need, per level.
 *
 * A discriminated union rather than two copies of the same switch: the READ
 * endpoint publishes review lists and the STATS endpoint publishes only numbers,
 * but they must agree about what those numbers are, and the surest way to make
 * two endpoints agree is for them to read one function.
 */
type HierarchyData =
  | {
      readonly level: 'UNIT';
      readonly unitReviews: HydratedReview[];
      readonly unitStats: ReviewSummaryStats;
      readonly buildingSummary: ReviewSummaryStats;
    }
  | {
      readonly level: 'BUILDING';
      readonly buildingReviews: HydratedReview[];
      readonly unitReviews: HydratedReview[];
      readonly aggregatedStats: ReviewSummaryStats;
    }
  | {
      readonly level: 'STREET';
      readonly aggregatedStats: ReviewSummaryStats;
      readonly buildingCount: number;
    };

/**
 * Load the review view for one address, at whatever level the address IS.
 *
 * `addresses.address_level` is a GENERATED column, so the level is read off the
 * row rather than re-derived. `AddressSchema.methods.getAddressLevel()` was a
 * METHOD that every `.lean()` read in this package skipped, which is exactly why
 * the derivation moved into the schema — a lean read and a hydrated document
 * cannot disagree about what level an address is.
 */
async function loadHierarchy(
  address: HierarchyAddress,
  viewer: string | null,
): Promise<HierarchyData> {
  if (address.addressLevel === 'UNIT') {
    const [unitReviews, unitStats] = await Promise.all([
      findReviews({
        where: allOfReviews([atUnitLevel(address.id), visibleModeration()]),
        orderBy: [NEWEST_REVIEWS_FIRST],
        viewer,
      }),
      summarizeUnit(address.id),
    ]);
    // The building this unit belongs to comes off the unit's own reviews, which
    // are already in hand — Mongo issued a separate `findOne` for a "sample
    // review" purely to read that one column off it.
    const buildingSummary = await summarizeBuildingOfUnit(unitReviews[0]?.review.buildingLevelId);
    return { level: 'UNIT', unitReviews, unitStats, buildingSummary };
  }

  if (address.addressLevel === 'BUILDING') {
    const [buildingReviews, unitReviews, aggregatedStats] = await Promise.all([
      findReviews({
        where: allOfReviews([atBuildingLevel(address.id), levelIs('BUILDING'), visibleModeration()]),
        orderBy: [NEWEST_REVIEWS_FIRST],
        viewer,
      }),
      findReviews({
        where: allOfReviews([atBuildingLevel(address.id), levelIs('UNIT'), visibleModeration()]),
        orderBy: [NEWEST_REVIEWS_FIRST],
        viewer,
      }),
      summarizeBuilding(address.id),
    ]);
    return { level: 'BUILDING', buildingReviews, unitReviews, aggregatedStats };
  }

  const [aggregatedStats, buildingCount] = await Promise.all([
    summarizeStreet(address.id),
    countBuildingsOnStreet(address.id),
  ]);
  return { level: 'STREET', aggregatedStats, buildingCount };
}

/** An address, reduced to what a hierarchy read needs of it. */
interface HierarchyAddress {
  readonly id: string;
  readonly addressLevel: 'STREET' | 'BUILDING' | 'UNIT';
}

/**
 * The address a hierarchy endpoint was asked about.
 *
 * `undefined` means no such address; `null` means one whose `address_level` is
 * not a level this endpoint knows — a case the CHECK on that column makes
 * unreachable, and which the caller nevertheless answers rather than ignores,
 * because drizzle types every GENERATED column as nullable and a narrowing
 * silently widened to `string` is how a level ends up mis-filed.
 */
async function findHierarchyAddress(addressId: string): Promise<HierarchyAddress | null | undefined> {
  const [address] = await selectAddressWithGeoNames({ where: eq(addresses.id, addressId), limit: 1 });
  if (!address) return undefined;
  const addressLevel = address.addressLevel;
  if (addressLevel !== 'STREET' && addressLevel !== 'BUILDING' && addressLevel !== 'UNIT') {
    return null;
  }
  return { id: address.id, addressLevel };
}

export const getReviewsByAddress = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;
    const viewer = getOxyUserId(req);
    const { page, limit } = parsePageLimit(req);

    if (!isPossibleId(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await findHierarchyAddress(addressId);
    if (address === undefined) {
      return notFound(res, { message: 'Address not found' });
    }
    if (address === null) {
      return badRequest(res, { message: 'Invalid address level for reviews' });
    }

    const data = await loadHierarchy(address, viewer);

    if (data.level === 'UNIT') {
      const total = data.unitReviews.length;
      return ok(res, {
        level: 'UNIT',
        unitReviews: serializeReviews(pageOf(data.unitReviews, page, limit)),
        buildingSummary: data.buildingSummary,
        totalReviews: total,
        pagination: { currentPage: page, totalPages: Math.ceil(total / limit), limit },
      });
    }

    if (data.level === 'BUILDING') {
      // `totalReviews` counts BOTH lists while the page slices only the unit
      // one — the source's behaviour, preserved rather than tidied, because the
      // building's own reviews are rendered above the paginated flat list.
      const total = data.buildingReviews.length + data.unitReviews.length;
      return ok(res, {
        level: 'BUILDING',
        buildingReviews: serializeReviews(data.buildingReviews),
        unitReviews: serializeReviews(pageOf(data.unitReviews, page, limit)),
        aggregatedStats: data.aggregatedStats,
        totalReviews: total,
        pagination: { currentPage: page, totalPages: Math.ceil(total / limit), limit },
      });
    }

    return ok(res, {
      level: 'STREET',
      aggregatedStats: data.aggregatedStats,
      buildingCount: data.buildingCount,
      totalReviews: data.aggregatedStats.totalReviews,
    });
  } catch (error) {
    logger.error('Error fetching hierarchical reviews', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch reviews' });
  }
};

export const getAddressReviewStats = async (req: Request, res: Response) => {
  try {
    const { addressId } = req.params;

    if (!isPossibleId(addressId)) {
      return badRequest(res, { message: 'Invalid address ID' });
    }

    const address = await findHierarchyAddress(addressId);
    if (address === undefined) {
      return notFound(res, { message: 'Address not found' });
    }
    if (address === null) {
      return badRequest(res, { message: 'Invalid address level for review stats' });
    }

    const data = await loadHierarchy(address, null);

    if (data.level === 'UNIT') {
      return ok(res, {
        stats: {
          level: 'UNIT',
          unitStats: data.unitStats,
          buildingSummary: data.buildingSummary,
        },
      });
    }

    if (data.level === 'BUILDING') {
      return ok(res, {
        stats: {
          level: 'BUILDING',
          aggregatedStats: data.aggregatedStats,
          buildingReviewCount: data.buildingReviews.length,
          unitReviewCount: data.unitReviews.length,
        },
      });
    }

    return ok(res, {
      stats: {
        level: 'STREET',
        aggregatedStats: data.aggregatedStats,
        buildingCount: data.buildingCount,
      },
    });
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
  addressId: string;
  buildingLevelId: string;
  reviewId: string;
}): Promise<void> {
  try {
    const addressIds =
      params.buildingLevelId === params.addressId
        ? [params.addressId]
        : [params.addressId, params.buildingLevelId];

    const owners = await findOwnerOxyUserIdsAtAddresses(addressIds);
    const recipients = owners.filter((id) => id !== params.reviewerOxyUserId);

    await Promise.all(
      recipients.map((recipientOxyUserId) =>
        notificationDispatchService.createForUser(recipientOxyUserId, {
          type: 'address_review_created',
          title: 'New review at your property address',
          message: 'Someone posted a review at an address where you have a listing.',
          priority: 'low',
          data: {
            addressId: params.addressId,
            reviewId: params.reviewId,
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

    // The submitted agency NAME is a write-only input: it is resolved into a
    // canonical agency and only the id is persisted, so it is removed before the
    // body is normalized into column values.
    const agencyName = typeof picked.agencyName === 'string' ? picked.agencyName : undefined;
    delete picked.agencyName;

    const normalized = normalizeReviewCreateInput(picked);
    if (!normalized.ok) {
      return badRequest(res, { message: 'Validation error', errors: normalized.errors });
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

    const address = await findOrCreateCanonicalAddress({
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

    // Captured into a local rather than read off the row twice: the narrowing
    // has to survive into the transaction callback below, and TypeScript drops a
    // narrowing on a PROPERTY at every function boundary.
    const addressLevel = address.addressLevel;
    if (addressLevel !== 'BUILDING' && addressLevel !== 'UNIT') {
      return badRequest(res, { message: 'Reviews can only be created at BUILDING or UNIT level addresses' });
    }

    const hierarchy = await resolveAddressHierarchy(address);

    // The ANSWER path, not the check. `reviews_author_address_key` is what makes
    // "one review per person per address" true — two concurrent submissions both
    // pass this read — and `insertReview` turns its violation into the same 400.
    // This read exists so the ordinary case answers without a failed write.
    const alreadyReviewed = await countReviews(
      allOfReviews([byAuthor(oxyUserId), atAddress(address.id)]),
    );
    if (alreadyReviewed > 0) {
      return badRequest(res, { message: 'You have already reviewed this address' });
    }

    let review;
    try {
      review = await getDb().transaction(async (tx) => {
        // Inside the transaction so an agency created for a review that never
        // lands rolls back with it. `findOrCreateAgencyByName` takes the handle
        // for exactly this call site.
        const agency = agencyName?.trim() ? await findOrCreateAgencyByName(agencyName, tx) : null;

        return insertReview(tx, {
          ...normalized.values,
          // Every field below is resolved SERVER-side and is absent from
          // `CREATABLE_REVIEW_FIELDS`, so nothing a client sent can reach any of
          // them — the spread above cannot overwrite them because it comes first.
          addressId: address.id,
          addressLevel,
          streetLevelId: hierarchy.streetLevelId,
          buildingLevelId: hierarchy.buildingLevelId,
          unitLevelId: hierarchy.unitLevelId,
          cityId: address.cityId,
          neighborhoodId: address.neighborhoodId,
          agencyId: agency?.id ?? null,
          oxyUserId,
        });
      });
    } catch (error) {
      if (error instanceof DuplicateReviewError) {
        return badRequest(res, { message: 'You have already reviewed this address' });
      }
      throw error;
    }

    await notifyAddressOwners({
      reviewerOxyUserId: oxyUserId,
      addressId: address.id,
      buildingLevelId: hierarchy.buildingLevelId,
      reviewId: review.id,
    });

    const hydrated = await findReviewById(review.id, oxyUserId);
    if (!hydrated) {
      return serverError(res, { message: 'Failed to create review' });
    }
    return created(res, { review: serializeReview(hydrated) });
  } catch (error) {
    logger.error('Error creating review', { error: error instanceof Error ? error.message : String(error) });
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

    if (!isPossibleId(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const hydrated = await findReviewById(reviewId, viewer);
    if (!hydrated) {
      return notFound(res, { message: 'Review not found' });
    }

    // Hide removed reviews from everyone but their author.
    if (
      hydrated.review.moderationStatus === ReviewModerationStatus.REMOVED &&
      (!viewer || hydrated.review.oxyUserId !== viewer)
    ) {
      return notFound(res, { message: 'Review not found' });
    }

    return ok(res, { review: serializeReview(hydrated) });
  } catch (error) {
    logger.error('Error fetching review', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch review' });
  }
};

export const updateReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!isPossibleId(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const picked = pickFields<Record<string, unknown>>(req.body, EDITABLE_REVIEW_FIELDS);

    // Write-only input, removed before normalization for the same reason as on
    // the create path. An EMPTY name is not a clear: Mongo ignored it, and
    // treating it as "detach" would let a stray empty field silently unlink a
    // review from the agency its author named.
    const agencyName = typeof picked.agencyName === 'string' ? picked.agencyName.trim() : '';
    const agencySupplied = Object.prototype.hasOwnProperty.call(picked, 'agencyName');
    delete picked.agencyName;

    const normalized = normalizeReviewEditInput(picked);
    if (!normalized.ok) {
      return badRequest(res, { message: 'Validation error', errors: normalized.errors });
    }
    const patch: ReviewPatch = { ...normalized.values };

    if (agencySupplied && agencyName) {
      const agency = await findOrCreateAgencyByName(agencyName);
      if (agency) patch.agencyId = agency.id;
    }

    // Ownership + existence in ONE statement: a non-owner (or missing) review is
    // a 404, never a leaky 400 that reveals the review exists.
    const updated = await updateOwnReview({ reviewId, oxyUserId, patch });
    if (!updated) {
      return notFound(res, { message: 'Review not found' });
    }

    const hydrated = await findReviewById(updated.id, oxyUserId);
    if (!hydrated) {
      return notFound(res, { message: 'Review not found' });
    }
    return ok(res, { review: serializeReview(hydrated) });
  } catch (error) {
    logger.error('Error updating review', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to update review' });
  }
};

export const deleteReview = async (req: Request, res: Response) => {
  try {
    const { reviewId } = req.params;
    const oxyUserId = getRequiredOxyUserId(req);

    if (!isPossibleId(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    if (!(await deleteOwnReview({ reviewId, oxyUserId }))) {
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

    if (!isPossibleId(oxyUserId)) {
      return badRequest(res, { message: 'Oxy user id is required' });
    }

    /**
     * The author sees their OWN removed reviews here; nobody else does.
     *
     * A deliberate change, and the schema had already committed to it:
     * `reviews_oxy_user_created_idx` is the one scoped index that is NOT partial
     * on `moderation_status <> 'removed'`, and its docblock says why — hiding a
     * removal from its author makes it indistinguishable from a lost submission.
     * The Mongo filter applied `$ne: 'removed'` to everyone including the
     * author, which contradicted both that index and `getReviewById`, where the
     * author-visibility rule was already implemented. This is the same rule in
     * both places now.
     *
     * Nothing is exposed to a third party: the branch is on the viewer BEING the
     * author, so the public shape of this endpoint is unchanged.
     */
    const where = allOfReviews([
      byAuthor(oxyUserId),
      viewer === oxyUserId ? undefined : visibleModeration(),
    ]);
    const offset = (page - 1) * limit;

    const [hydrated, totalReviews] = await Promise.all([
      findReviews({ where, orderBy: [NEWEST_REVIEWS_FIRST], limit, offset, viewer }),
      countReviews(where),
    ]);

    const totalPages = Math.ceil(totalReviews / limit);
    return ok(res, {
      reviews: serializeReviews(hydrated),
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

    if (!isPossibleId(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    const review = await findReviewAuthor(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    if (review.oxyUserId === oxyUserId) {
      return badRequest(res, { message: 'You cannot mark your own review as helpful' });
    }

    const { helpfulCount, viewerHasVotedHelpful } = await toggleHelpfulVote({ reviewId, oxyUserId });

    // Notify the author on a NEW helpful vote only (never on un-vote, never for
    // one's own review — already rejected above). Best-effort.
    if (viewerHasVotedHelpful) {
      await notificationDispatchService.createForUser(review.oxyUserId, {
        type: 'review_helpful',
        title: 'Your review was marked helpful',
        message: 'Someone found your address review helpful.',
        priority: 'low',
        data: { reviewId: review.id },
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

    // No `Types.ObjectId.isValid` guard: `db/ids.ts` states the rule, and every
    // review created after the cutover carries a uuid v7, for which it is false.
    // Keeping it would answer "invalid review ID" for every new review. The
    // lookup below already answers "no such review", for every id shape.
    if (!isPossibleId(reviewId)) {
      return badRequest(res, { message: 'Invalid review ID' });
    }

    if (typeof reason !== 'string' || !isReviewReportReason(reason)) {
      return badRequest(res, { message: 'A valid report reason is required' });
    }

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    if (trimmedDetails.length > MAX_REPORT_DETAILS_LENGTH) {
      return badRequest(res, { message: 'Report details are too long' });
    }
    if (reason === ReviewReportReason.OTHER && !trimmedDetails) {
      return badRequest(res, { message: 'Details are required when the reason is "other"' });
    }

    const review = await findReviewForReport(reviewId);
    if (!review) {
      return notFound(res, { message: 'Review not found' });
    }

    // An ANSWER path, not the check: re-filing is a no-op (200), and the read
    // below tells the reporter so without a write. What actually stops a
    // duplicate being COUNTED is `review_reports_review_user_key`, because the
    // count of these rows crossing three is what flips the review to
    // `under_review` — see `db/moderation/reviewReportRepository.ts`.
    if (await hasReportedReview(reviewId, oxyUserId)) {
      return ok(res, { message: 'Report already submitted', moderationStatus: review.moderationStatus });
    }

    /**
     * The report row, the escalation it may trigger, and the durable delivery
     * record all commit together.
     *
     * Split, a crash between them leaves either a report a jury will never see,
     * a delivery record for a report that was rolled back, or — the one the
     * table's own docstring warns about — a review escalated on a count that
     * does not match its rows. None surfaces as an error when it happens.
     */
    let outcome;
    try {
      outcome = await withReportIntakeTransaction(async (tx) => {
        const result = await insertReviewReportAndEscalate(
          tx,
          {
            reviewId,
            oxyUserId,
            reason,
            details: trimmedDetails || undefined,
          },
          review.moderationStatus,
        );

        await createModerationReport(
          {
            reportedType: ModerationReportedType.REVIEW,
            reportedId: reviewId,
            reporter: oxyUserId,
            reason,
            details: trimmedDetails || undefined,
          },
          tx,
        );

        return result;
      });
    } catch (error) {
      /**
       * Two ways to already be on record, answered identically because from the
       * reporter's side they are the same fact: the unique index caught a report
       * that raced the read above, or the delivery record knows about a report
       * filed before the two were written together.
       */
      if (
        error instanceof DuplicateReviewReportError ||
        error instanceof DuplicateModerationReportError
      ) {
        return ok(res, { message: 'Report already submitted', moderationStatus: review.moderationStatus });
      }
      throw error;
    }

    return created(res, { message: 'Report submitted', moderationStatus: outcome.moderationStatus });
  } catch (error) {
    logger.error('Error reporting review', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to report review' });
  }
};

// ---------------------------------------------------------------------------
// Agencies (public reads).
// ---------------------------------------------------------------------------

/**
 * What the public may see of an agency's catalogue: published, not archived,
 * not restricted by a jury.
 *
 * A drizzle predicate rather than a Mongo filter object — the agency listing
 * count and the agency listing page both read Postgres. It is a FUNCTION
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

function toAgencySummary(agency: AgencyRow): { id: string; name: string; slug: string } {
  return { id: agency.id, name: agency.name, slug: agency.slug };
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

    const agencies = await findAgenciesByNamePrefix(normalized);
    return ok(res, { agencies: agencies.map(toAgencySummary) });
  } catch (error) {
    logger.error('Error searching agencies', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to search agencies' });
  }
};

export const getAgencyBySlug = async (req: Request, res: Response) => {
  try {
    const agency = await findAgencyBySlug(req.params.slug);
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }

    const [stats, listingsCount] = await Promise.all([
      getAgencyStats(agency.id),
      countProperties(publicAgencyListings(agency.id)),
    ]);

    return ok(res, {
      agency: toAgencySummary(agency),
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

    const agency = await findAgencyBySlug(req.params.slug);
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }

    const where = allOfReviews([ofAgency(agency.id), visibleModeration()]);
    const offset = (page - 1) * limit;

    const [hydrated, totalReviews] = await Promise.all([
      findReviews({ where, orderBy: [NEWEST_REVIEWS_FIRST], limit, offset, viewer }),
      countReviews(where),
    ]);

    const totalPages = Math.ceil(totalReviews / limit);
    return ok(res, {
      agency: toAgencySummary(agency),
      reviews: serializeReviews(hydrated),
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

    const agency = await findAgencyBySlug(req.params.slug);
    if (!agency) {
      return notFound(res, { message: 'Agency not found' });
    }

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
      data: hydrated.map(serializeProperty),
      pagination: { page, limit, total, totalPages },
      total,
      page,
      limit,
      totalPages,
      hasMore: (page - 1) * limit + hydrated.length < total,
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
    const cities = await getCitiesWithReviews();
    return ok(res, { cities });
  } catch (error) {
    logger.error('Error fetching explore cities', { error: error instanceof Error ? error.message : String(error) });
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
    logger.error('Error fetching explore city', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch explore city' });
  }
};

export const getExploreNeighborhood = async (req: Request, res: Response) => {
  try {
    const { neighborhoodId } = req.params;
    const { page, limit } = parsePageLimit(req);

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
    logger.error('Error fetching explore neighborhood', { error: error instanceof Error ? error.message : String(error) });
    return serverError(res, { message: 'Failed to fetch explore neighborhood' });
  }
};
