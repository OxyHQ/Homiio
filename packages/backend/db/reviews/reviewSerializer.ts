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
 * Serialize one review onto the wire.
 *
 * Column names are listed EXPLICITLY rather than spread from the row, which is
 * the same discipline `propertySerializer` and `addressSerializer` follow: a
 * spread publishes whatever the table gains next, and this table's neighbours
 * are a voter list and a report queue.
 */
export function serializeReview(hydrated: HydratedReview): Record<string, unknown> {
  const { review } = hydrated;

  return withoutAbsent({
    id: review.id,

    // The address hierarchy.
    addressId: review.addressId,
    addressLevel: review.addressLevel,
    streetLevelId: review.streetLevelId,
    buildingLevelId: review.buildingLevelId,
    unitLevelId: review.unitLevelId,
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
    populatedAddress: serializeAddressRow(hydrated.address),
  });
}
