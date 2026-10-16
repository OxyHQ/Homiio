/**
 * Address reviews (STREET → BUILDING → UNIT) as use cases: the hierarchical
 * reads, writing / editing / deleting one's own review, helpful votes and
 * community reports.
 *
 * Security invariants (AGENTS.md), unchanged from the controller they came from:
 *
 *  - Writes never trust the caller: `writeReview` / `updateReview` pick an
 *    explicit allowlist (`CREATABLE_REVIEW_FIELDS` / `EDITABLE_REVIEW_FIELDS`).
 *    The author, the address hierarchy, geo ids, agency, moderation and
 *    verification are all resolved server-side.
 *  - Update/delete carry `and(id, oxyUserId)` in the STATEMENT
 *    (`db/reviews/reviewWrites.ts`), so a non-author gets 404.
 *  - Every read serializes through `serializeReview` for THIS viewer's audience,
 *    and a `removed` review is visible to its author and to nobody else.
 *  - A report is a community report (`review_reports` + the moderation outbox):
 *    3+ reports escalate to `under_review`; nothing here removes a review.
 *  - Notifications go only through `notificationDispatchService`.
 *
 * The author / viewer is the `oxyUserId` given — the session on the route, the
 * effective account on the capability lane. Refusals are
 * {@link ReviewRequestError}s with the route's message (and `errors[]` where the
 * route lists them).
 */

import {
  ReviewModerationStatus,
  ReviewReportReason,
  ModerationReportedType,
} from '@homiio/shared-types';
import { eq } from 'drizzle-orm';

import { findOrCreateAgencyReference } from '../db/agencies/agencyWrites';
import { DuplicateModerationReportError } from '../db/moderation/moderationReportRepository';
import {
  DuplicateReviewReportError,
  findReviewForReport,
  hasReportedReview,
  insertReviewReportAndEscalate,
} from '../db/moderation/reviewReportRepository';
import { getDb } from '../db/postgres';
import { findOwnerOxyUserIdsAtAddresses } from '../db/properties/propertyReads';
import {
  countBuildingsOnStreet,
  summarizeBuilding,
  summarizeBuildingOfUnit,
  summarizeStreet,
  summarizeUnit,
  type ReviewSummaryStats,
} from '../db/reviews/reviewAggregates';
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
  visibleModeration,
} from '../db/reviews/reviewReads';
import {
  reviewAudienceFor,
  serializeReview,
  type HydratedReview,
} from '../db/reviews/reviewSerializer';
import {
  deleteOwnReview,
  DuplicateReviewError,
  findReviewAuthor,
  insertReview,
  toggleHelpfulVote,
  updateOwnReview,
  type ReviewPatch,
} from '../db/reviews/reviewWrites';
import { addresses } from '../db/schema';
import { AppError, describeErrorForLog } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import {
  CREATABLE_REVIEW_FIELDS,
  EDITABLE_REVIEW_FIELDS,
} from '../controllers/review/editableFields';
import {
  normalizeReviewCreateInput,
  normalizeReviewEditInput,
} from '../controllers/review/reviewInput';
import {
  findOrCreateCanonicalAddress,
  resolveAddressHierarchy,
  selectAddressWithGeoNames,
} from '../services/addressService';
import { forwardGeocode } from '../services/geocodingService';
import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../services/moderation/ReportIntakeService';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { resolveOrganizationSelection } from '../services/organizations/directory';
import { pickFields } from '../utils/pickFields';

/** A refusal with the route's status, message and (optionally) its `errors[]`. */
export class ReviewRequestError extends AppError {
  readonly errors?: string[];

  constructor(message: string, statusCode: number, code: string, errors?: string[]) {
    super(message, statusCode, code);
    this.errors = errors;
  }
}

const badRequest = (message: string, errors?: string[]) =>
  new ReviewRequestError(message, 400, 'VALIDATION_ERROR', errors);
const notFound = (message: string) => new ReviewRequestError(message, 404, 'NOT_FOUND');

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

/** Parse `page` / `limit` with sane clamps. */
export function parsePageLimit(query: { page?: unknown; limit?: unknown }): {
  page: number;
  limit: number;
} {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const rawLimit = parseInt(String(query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
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
export function isPossibleId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Serialize a page of reviews, each for the audience THIS viewer is.
 *
 * Per review rather than per page: one list mixes a viewer's own reviews with
 * other people's (their agency's page, a building they reviewed), and a page
 * built at one audience would either publish everybody's unit or withhold the
 * author's own.
 */
export function serializeReviews(
  hydrated: readonly HydratedReview[],
  viewer: string | null | undefined,
): Record<string, unknown>[] {
  return hydrated.map((review) => serializeReview(review, reviewAudienceFor(review, viewer)));
}

/**
 * Page a list in the APPLICATION, as the hierarchical reads have always done.
 *
 * Not pushed into SQL, because these endpoints publish `totalReviews` over the
 * WHOLE set beside a page of it, and both are derived from one array. Pushing the slice into the query
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
    // are already in hand — no separate read of a "sample review" is needed.
    const buildingSummary = await summarizeBuildingOfUnit(unitReviews[0]?.review.buildingLevelId);
    return { level: 'UNIT', unitReviews, unitStats, buildingSummary };
  }

  if (address.addressLevel === 'BUILDING') {
    const [buildingReviews, unitReviews, aggregatedStats] = await Promise.all([
      findReviews({
        where: allOfReviews([
          atBuildingLevel(address.id),
          levelIs('BUILDING'),
          visibleModeration(),
        ]),
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
async function findHierarchyAddress(
  addressId: string,
): Promise<HierarchyAddress | null | undefined> {
  const [address] = await selectAddressWithGeoNames({
    where: eq(addresses.id, addressId),
    limit: 1,
  });
  if (!address) return undefined;
  const addressLevel = address.addressLevel;
  if (addressLevel !== 'STREET' && addressLevel !== 'BUILDING' && addressLevel !== 'UNIT') {
    return null;
  }
  return { id: address.id, addressLevel };
}

/**
 * The reviews at one address, at whatever level the address IS: a UNIT's
 * reviews plus its building summary, a BUILDING's own and its units', or a
 * STREET's aggregate. Each review is serialized for this viewer's audience.
 */
export async function listAddressReviews(
  viewer: string | null | undefined,
  addressId: string,
  query: { page?: unknown; limit?: unknown } = {},
) {
  const { page, limit } = parsePageLimit(query);
  if (!isPossibleId(addressId)) throw badRequest('Invalid address ID');

  const address = await findHierarchyAddress(addressId);
  if (address === undefined) throw notFound('Address not found');
  if (address === null) throw badRequest('Invalid address level for reviews');

  const data = await loadHierarchy(address, viewer ?? null);

  if (data.level === 'UNIT') {
    const total = data.unitReviews.length;
    return {
      level: 'UNIT',
      unitReviews: serializeReviews(pageOf(data.unitReviews, page, limit), viewer),
      buildingSummary: data.buildingSummary,
      totalReviews: total,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), limit },
    };
  }

  if (data.level === 'BUILDING') {
    // `totalReviews` counts BOTH lists while the page slices only the unit
    // one — the building's own reviews are rendered above the paginated list.
    const total = data.buildingReviews.length + data.unitReviews.length;
    return {
      level: 'BUILDING',
      buildingReviews: serializeReviews(data.buildingReviews, viewer),
      unitReviews: serializeReviews(pageOf(data.unitReviews, page, limit), viewer),
      aggregatedStats: data.aggregatedStats,
      totalReviews: total,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), limit },
    };
  }

  return {
    level: 'STREET',
    aggregatedStats: data.aggregatedStats,
    buildingCount: data.buildingCount,
    totalReviews: data.aggregatedStats.totalReviews,
  };
}

/** The review statistics for one address, at its level. Numbers only. */
export async function getAddressReviewStats(addressId: string) {
  if (!isPossibleId(addressId)) throw badRequest('Invalid address ID');

  const address = await findHierarchyAddress(addressId);
  if (address === undefined) throw notFound('Address not found');
  if (address === null) throw badRequest('Invalid address level for review stats');

  const data = await loadHierarchy(address, null);

  if (data.level === 'UNIT') {
    return {
      stats: { level: 'UNIT', unitStats: data.unitStats, buildingSummary: data.buildingSummary },
    };
  }
  if (data.level === 'BUILDING') {
    return {
      stats: {
        level: 'BUILDING',
        aggregatedStats: data.aggregatedStats,
        buildingReviewCount: data.buildingReviews.length,
        unitReviewCount: data.unitReviews.length,
      },
    };
  }
  return {
    stats: {
      level: 'STREET',
      aggregatedStats: data.aggregatedStats,
      buildingCount: data.buildingCount,
    },
  };
}

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
      error: describeErrorForLog(error),
    });
  }
}

/**
 * Write a review of an address (BUILDING or UNIT level), one per person per
 * address. The body is picked through `CREATABLE_REVIEW_FIELDS`; the address is
 * resolved to its canonical row (geocoded when no coordinates are given). The
 * owners of listings at that address are notified.
 */
export async function writeReview(oxyUserId: string, body: unknown) {
  const addressData = (body as { address?: Record<string, string> } | null | undefined)?.address;
  const picked = pickFields<Record<string, unknown>>(body, CREATABLE_REVIEW_FIELDS);

  if (
    !addressData?.street ||
    !addressData.city ||
    !addressData.postal_code ||
    !addressData.country
  ) {
    throw badRequest('Address information is required (street, city, postal_code, country)');
  }

  const title = typeof picked.title === 'string' ? picked.title.trim() : '';
  if (title.length < MIN_TITLE_LENGTH) {
    throw badRequest(`Title must be at least ${MIN_TITLE_LENGTH} characters long`);
  }

  const opinion = typeof picked.opinion === 'string' ? picked.opinion.trim() : '';
  if (opinion.length < MIN_OPINION_LENGTH) {
    throw badRequest(`Opinion must be at least ${MIN_OPINION_LENGTH} characters long`);
  }

  // Validate the canonical selection before opening a database transaction.
  const selectedCompanyId = await resolveOrganizationSelection(picked.agencyOxyAccountId);
  delete picked.agencyOxyAccountId;

  const normalized = normalizeReviewCreateInput(picked);
  if (!normalized.ok) throw badRequest('Validation error', normalized.errors);

  let coordinates =
    addressData.latitude && addressData.longitude
      ? {
          type: 'Point' as const,
          coordinates: [parseFloat(addressData.longitude), parseFloat(addressData.latitude)] as [
            number,
            number,
          ],
        }
      : undefined;

  if (!coordinates) {
    const query = [
      addressData.street,
      addressData.number,
      addressData.city,
      addressData.state,
      addressData.postal_code,
      addressData.country,
    ]
      .filter(Boolean)
      .join(', ');
    const geocoded = await forwardGeocode(query);
    if (!geocoded.success || !geocoded.data?.coordinates) {
      throw badRequest(
        'Could not resolve coordinates for the address; please include latitude and longitude',
      );
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

  // A local, so the narrowing survives into the transaction callback below.
  const addressLevel = address.addressLevel;
  if (addressLevel !== 'BUILDING' && addressLevel !== 'UNIT') {
    throw badRequest('Reviews can only be created at BUILDING or UNIT level addresses');
  }

  const hierarchy = await resolveAddressHierarchy(address);

  // The ANSWER path, not the check: `reviews_author_address_key` is what makes
  // "one review per person per address" true, and `insertReview` turns its
  // violation into the same 400.
  const alreadyReviewed = await countReviews(
    allOfReviews([byAuthor(oxyUserId), atAddress(address.id)]),
  );
  if (alreadyReviewed > 0) throw badRequest('You have already reviewed this address');

  let review: Awaited<ReturnType<typeof insertReview>>;
  try {
    review = await getDb().transaction(async (tx) => {
      // The local housing reference and review commit together; no network inside the transaction.
      const agency = selectedCompanyId
        ? await findOrCreateAgencyReference(selectedCompanyId, tx)
        : null;
      return insertReview(tx, {
        ...normalized.values,
        // Resolved SERVER-side and absent from `CREATABLE_REVIEW_FIELDS`; the
        // spread comes first so nothing a caller sent can overwrite them.
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
    if (error instanceof DuplicateReviewError)
      throw badRequest('You have already reviewed this address');
    throw error;
  }

  await notifyAddressOwners({
    reviewerOxyUserId: oxyUserId,
    addressId: address.id,
    buildingLevelId: hierarchy.buildingLevelId,
    reviewId: review.id,
  });

  const hydrated = await findReviewById(review.id, oxyUserId);
  if (!hydrated) throw new Error('Created review could not be read back');
  return { review: serializeReview(hydrated, 'author') };
}

/** One review, for this viewer's audience. A removed review is visible only to its author. */
export async function getReview(viewer: string | null | undefined, reviewId: string) {
  if (!isPossibleId(reviewId)) throw badRequest('Invalid review ID');
  const hydrated = await findReviewById(reviewId, viewer);
  if (!hydrated) throw notFound('Review not found');
  if (
    hydrated.review.moderationStatus === ReviewModerationStatus.REMOVED &&
    (!viewer || hydrated.review.oxyUserId !== viewer)
  ) {
    throw notFound('Review not found');
  }
  return { review: serializeReview(hydrated, reviewAudienceFor(hydrated, viewer)) };
}

/**
 * Edit one's own review through `EDITABLE_REVIEW_FIELDS`. A supplied empty
 * `agencyOxyAccountId` clears attribution; absence preserves it. Somebody
 * else's review is 404 (ownership is in the UPDATE).
 */
export async function updateReview(oxyUserId: string, reviewId: string, body: unknown) {
  if (!isPossibleId(reviewId)) throw badRequest('Invalid review ID');

  const picked = pickFields<Record<string, unknown>>(body, EDITABLE_REVIEW_FIELDS);
  const agencySupplied = Object.hasOwn(picked, 'agencyOxyAccountId');
  const selectedCompanyId = await resolveOrganizationSelection(picked.agencyOxyAccountId);
  delete picked.agencyOxyAccountId;

  const normalized = normalizeReviewEditInput(picked);
  if (!normalized.ok) throw badRequest('Validation error', normalized.errors);
  const patch: ReviewPatch = { ...normalized.values };

  const updated = await getDb().transaction(async (tx) => {
    if (agencySupplied) {
      patch.agencyId = selectedCompanyId
        ? (await findOrCreateAgencyReference(selectedCompanyId, tx)).id
        : null;
    }
    const owned = await updateOwnReview({ reviewId, oxyUserId, patch }, tx);
    if (!owned) throw new AppError('Review not found', 404, 'NOT_FOUND');
    return owned;
  });

  const hydrated = await findReviewById(updated.id, oxyUserId);
  if (!hydrated) throw notFound('Review not found');
  return { review: serializeReview(hydrated, 'author') };
}

/** Delete one's own review; somebody else's is 404. */
export async function deleteReview(oxyUserId: string, reviewId: string): Promise<void> {
  if (!isPossibleId(reviewId)) throw badRequest('Invalid review ID');
  if (!(await deleteOwnReview({ reviewId, oxyUserId }))) throw notFound('Review not found');
}

/**
 * The reviews one person wrote, newest first. The author sees their own
 * removed reviews here; nobody else does.
 */
export async function listUserReviews(
  viewer: string | null | undefined,
  authorOxyUserId: string,
  query: { page?: unknown; limit?: unknown } = {},
) {
  const { page, limit } = parsePageLimit(query);
  if (!isPossibleId(authorOxyUserId)) throw badRequest('Oxy user id is required');

  const where = allOfReviews([
    byAuthor(authorOxyUserId),
    viewer === authorOxyUserId ? undefined : visibleModeration(),
  ]);
  const offset = (page - 1) * limit;
  const [hydrated, totalReviews] = await Promise.all([
    findReviews({ where, orderBy: [NEWEST_REVIEWS_FIRST], limit, offset, viewer }),
    countReviews(where),
  ]);
  const totalPages = Math.ceil(totalReviews / limit);
  return {
    reviews: serializeReviews(hydrated, viewer),
    pagination: { currentPage: page, totalPages, totalReviews, limit },
    hasMore: page < totalPages,
    totalPages,
  };
}

/**
 * Toggle one's helpful vote on somebody else's review. The author is notified
 * on a NEW vote only (never on un-vote).
 */
export async function toggleReviewHelpful(oxyUserId: string, reviewId: string) {
  if (!isPossibleId(reviewId)) throw badRequest('Invalid review ID');
  const review = await findReviewAuthor(reviewId);
  if (!review) throw notFound('Review not found');
  if (review.oxyUserId === oxyUserId)
    throw badRequest('You cannot mark your own review as helpful');

  const { helpfulCount, viewerHasVotedHelpful } = await toggleHelpfulVote({ reviewId, oxyUserId });
  if (viewerHasVotedHelpful) {
    await notificationDispatchService.createForUser(review.oxyUserId, {
      type: 'review_helpful',
      title: 'Your review was marked helpful',
      message: 'Someone found your address review helpful.',
      priority: 'low',
      data: { reviewId: review.id },
    });
  }
  return { helpfulCount, viewerHasVotedHelpful };
}

export interface ReviewReportOutcome {
  /** False when this person had already reported the review (a 200 no-op). */
  readonly created: boolean;
  readonly message: string;
  readonly moderationStatus: string;
}

/**
 * File a community report against a review. Re-filing is a no-op. The report,
 * the escalation it may trigger (3+ → `under_review`) and the moderation
 * delivery record commit together.
 */
export async function reportReview(
  oxyUserId: string,
  reviewId: string,
  body: { reason?: unknown; details?: unknown },
): Promise<ReviewReportOutcome> {
  const { reason, details } = body;
  if (!isPossibleId(reviewId)) throw badRequest('Invalid review ID');
  if (typeof reason !== 'string' || !isReviewReportReason(reason)) {
    throw badRequest('A valid report reason is required');
  }
  const trimmedDetails = typeof details === 'string' ? details.trim() : '';
  if (trimmedDetails.length > MAX_REPORT_DETAILS_LENGTH)
    throw badRequest('Report details are too long');
  if (reason === ReviewReportReason.OTHER && !trimmedDetails) {
    throw badRequest('Details are required when the reason is "other"');
  }

  const review = await findReviewForReport(reviewId);
  if (!review) throw notFound('Review not found');

  const alreadyFiled: ReviewReportOutcome = {
    created: false,
    message: 'Report already submitted',
    moderationStatus: review.moderationStatus,
  };
  if (await hasReportedReview(reviewId, oxyUserId)) return alreadyFiled;

  try {
    const outcome = await withReportIntakeTransaction(async (tx) => {
      const result = await insertReviewReportAndEscalate(
        tx,
        { reviewId, oxyUserId, reason, details: trimmedDetails || undefined },
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
    return {
      created: true,
      message: 'Report submitted',
      moderationStatus: outcome.moderationStatus,
    };
  } catch (error) {
    // Already on record, either way the reporter sees the same fact.
    if (
      error instanceof DuplicateReviewReportError ||
      error instanceof DuplicateModerationReportError
    ) {
      return alreadyFiled;
    }
    throw error;
  }
}
