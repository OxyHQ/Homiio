/**
 * A review, everything a read has to fetch WITH it, and the ONE way it reaches
 * the wire.
 *
 * Replaces `controllers/review/toReviewDTO.ts`, which existed to reconcile the
 * three shapes a Mongoose review could arrive in — a hydrated document, a
 * `.lean()` object, and `.toJSON()` output — and to detect, per reference,
 * whether `agencyId` / `addressId` held a bare `ObjectId` or a populated
 * sub-document. None of that exists here: a read either joined the agency and
 * the address or it did not, and the row type says which, so there is nothing
 * left to sniff.
 *
 * ## Three things this serializer computes that Mongo did not, or did unevenly
 *
 *  - **`helpfulCount` / `viewerHasVotedHelpful`** were `helpfulVoters.length` and
 *    `.includes(viewer)` over an embedded `[String]`. They are now counted and
 *    tested in SQL, per review, by `reviewReads.ts` — the array itself is a
 *    table, and shipping it to the application to be counted would ship the
 *    whole voter list to a process that must never publish it.
 *  - **`livedDurationText`** was a Mongoose VIRTUAL, and virtuals do not survive
 *    `.lean()`. Five of the six read paths in `reviewController` were lean, so
 *    the field reached the wire from the hierarchical address reads and from
 *    nowhere else. It is computed here for every review, which makes the field
 *    consistent for the first time — stated as a behaviour change rather than
 *    discovered as one.
 *  - **`populatedAddress`** was a hand-written `select` string plus four nested
 *    `populate`s, which produced `cityId: { _id, name }` — a shape nothing else
 *    in the product emits. It is now `serializeAddressRow`, the single address
 *    wire shape every other endpoint already uses.
 *
 * ## What is stripped, and why it is stronger than it was
 *
 * `helpfulVoters` and `reports` were deleted from the DTO by key. Here they are
 * separate TABLES that no read in this domain selects from, so there is no key
 * to forget to delete — the same strengthening `eviction_case_attendees` got.
 * `_id` and `__v` are gone with the store.
 */

import { serializeAddressRow, type AddressWithGeoNames } from '../addresses/addressSerializer';
import type { reviews } from '../schema/reviews';

export type ReviewRow = typeof reviews.$inferSelect;

/** The agency projection a review carries inline, when it names one. */
export interface ReviewAgencySummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

/** A review plus everything a single read fetched alongside it. */
export interface HydratedReview {
  readonly review: ReviewRow;
  /**
   * The address the review is attached to, with its geo display names.
   *
   * NOT optional: `reviews.address_id` is `NOT NULL` with an `ON DELETE
   * RESTRICT` foreign key, so the inner join in `reviewReads.ts` can neither
   * drop a review nor multiply one.
   */
  readonly address: AddressWithGeoNames;
  /** `null` when the review names no agency, which is the ordinary case. */
  readonly agency: ReviewAgencySummary | null;
  readonly helpfulCount: number;
  readonly viewerHasVotedHelpful: boolean;
}

/** Months in a year — spelled out because it is the boundary the text switches at. */
const MONTHS_PER_YEAR = 12;

/**
 * `livedForMonths` as the sentence the review card renders.
 *
 * The port of `ReviewSchema.virtual('livedDurationText')`, character for
 * character including the pluralisation, because it is user-visible copy rather
 * than a derived number.
 */
export function livedDurationText(months: number): string {
  if (months < MONTHS_PER_YEAR) {
    return `${months} month${months !== 1 ? 's' : ''}`;
  }
  const years = Math.floor(months / MONTHS_PER_YEAR);
  const remainingMonths = months % MONTHS_PER_YEAR;
  if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }
  return `${years} year${years !== 1 ? 's' : ''} ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
}

/** Drop keys whose value is null/undefined, matching Mongoose's omission of unset paths. */
function withoutAbsent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * WHO a review body is being built for — ADR 0003 §4.1's `audience`, which a
 * serializer takes explicitly and never infers.
 *
 *  - `public` — anybody who did not write this review, signed in or not.
 *  - `author` — the session user the row's `oxy_user_id` names.
 *  - `system` — a body that never leaves the process.
 */
export type ReviewAudience = 'public' | 'author' | 'system';

/**
 * `author` when the session user wrote this review, otherwise `public`.
 *
 * The id must be the SESSION's, never one from a path or a body: `GET
 * /api/reviews/user/:oxyUserId` takes an author id in its URL, and comparing
 * that against the row would let anybody read any author's reviews at full
 * precision by naming them.
 */
export function reviewAudienceFor(
  hydrated: HydratedReview,
  sessionOxyUserId: string | null | undefined,
): ReviewAudience {
  return typeof sessionOxyUserId === 'string' &&
    sessionOxyUserId.length > 0 &&
    hydrated.review.oxyUserId === sessionOxyUserId
    ? 'author'
    : 'public';
}

/**
 * Serialize one review onto the wire, for a stated audience.
 *
 * Column names are listed EXPLICITLY rather than spread from the row, which is
 * the same discipline `propertySerializer` and `addressSerializer` follow: a
 * spread publishes whatever the table gains next, and this table's neighbours
 * are a voter list and a report queue.
 *
 * ## A review is FILED at a unit and PUBLISHED at the building
 *
 * ADR 0003 §5.1. The binding and the publication are two different facts, and
 * the schema already separates them (`reviews.address_level` plus the three
 * level ids). For anybody but the author:
 *
 *  - `populatedAddress` is built at `building`, so the floor, the door, the
 *    subunit and the free-form address fields are ABSENT and the coordinate is
 *    rounded.
 *  - `addressId` and the address's own `id` name the **building** the review
 *    rolls up to — its recorded `building_level_id`, which is the authority for
 *    where this review is filed — and `addressLevel` names that place's level.
 *    Publishing the unit row's id instead would hand back the one handle that
 *    names a single household, which is the whole of §3.4.
 *  - `unitLevelId` is absent: §9's matrix gives the review's unit binding to the
 *    record's owner and to nobody else, including a caller with a named
 *    relationship to the place.
 *
 * The author reads their own review exactly as stored, which is what makes
 * "reviews of this exact flat" theirs to correct and to appeal.
 *
 * **What this does NOT yet do**, stated rather than implied: §5.2's three author
 * identity forms, §5.6's month-grained tenancy dates and banded rent, and the
 * author's opt-in to publishing the unit are all still open (#365). `oxyUserId`,
 * `livedFrom`, `livedTo` and `price` are published here as they always were.
 */
export function serializeReview(
  hydrated: HydratedReview,
  audience: ReviewAudience,
): Record<string, unknown> {
  const { review } = hydrated;
  const published = audience === 'public';
  // The place this review is PUBLISHED against. `building_level_id` is NOT NULL
  // and, for a BUILDING-level review, is the review's own address — so this is
  // the row's id in every case but the one it exists for.
  const placeId = published ? review.buildingLevelId : review.addressId;

  return withoutAbsent({
    id: review.id,

    // The address hierarchy.
    addressId: placeId,
    addressLevel: published && placeId !== review.addressId ? 'BUILDING' : review.addressLevel,
    streetLevelId: review.streetLevelId,
    buildingLevelId: review.buildingLevelId,
    unitLevelId: published ? undefined : review.unitLevelId,
    cityId: review.cityId,
    neighborhoodId: review.neighborhoodId,
    agencyId: review.agencyId,

    // The review.
    oxyUserId: review.oxyUserId,
    title: review.title,
    greenHouse: review.greenHouse,
    price: review.price,
    currency: review.currency,
    livedFrom: review.livedFrom,
    livedTo: review.livedTo,
    livedForMonths: review.livedForMonths,
    livedDurationText: livedDurationText(review.livedForMonths),
    rating: review.rating,
    recommendation: review.recommendation,
    opinion: review.opinion,
    prosItems: review.prosItems,
    consItems: review.consItems,
    adviceToAgency: review.adviceToAgency,
    adviceToLandlord: review.adviceToLandlord,
    positiveComment: review.positiveComment,
    negativeComment: review.negativeComment,
    images: review.images,

    // Environmental conditions.
    summerTemperature: review.summerTemperature,
    winterTemperature: review.winterTemperature,
    noise: review.noise,
    light: review.light,
    conditionAndMaintenance: review.conditionAndMaintenance,
    services: review.services,

    // Management.
    landlordTreatment: review.landlordTreatment,
    problemResponse: review.problemResponse,
    depositReturned: review.depositReturned,

    // Neighbours and community.
    staircaseNeighbors: review.staircaseNeighbors,
    touristApartments: review.touristApartments,
    neighborRelations: review.neighborRelations,
    cleaning: review.cleaning,

    // The area.
    areaTourists: review.areaTourists,
    areaSecurity: review.areaSecurity,
    areaNoise: review.areaNoise,
    areaCleanliness: review.areaCleanliness,

    moderationStatus: review.moderationStatus,
    verified: review.verified,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,

    helpfulCount: hydrated.helpfulCount,
    viewerHasVotedHelpful: hydrated.viewerHasVotedHelpful,
    agency: hydrated.agency ?? undefined,
    // The review's OWN publication rule, not a listing's ceiling: a listing at
    // this address may publish its floor, and that is the advertiser's choice
    // about their advertisement — it is not a resident's consent to be named.
    populatedAddress: published
      ? serializeAddressRow(hydrated.address, 'building', placeId)
      : serializeAddressRow(hydrated.address, 'exact'),
  });
}
