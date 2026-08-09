/**
 * Homiio address reviews, as universal material.
 *
 * A review is a `commerce.review` — a standard subject type — and the material
 * is the reviewer's own words: the opinion, the pros and cons they listed, and
 * the advice they addressed to a landlord or agency. That text is what a `fake`,
 * `offensive` or `personal_data` allegation is actually about.
 *
 * ## The location a review carries is deliberately weaker than a listing's
 *
 * `propertySubject.ts` sends the street the advert publishes, because for a
 * listing the published address IS the reported thing. A review is the opposite
 * case: the address is where the reviewer LIVED, and quite possibly where
 * somebody still lives. Nothing about judging whether a review is fabricated or
 * abusive requires knowing the street, so this provider sends the city and
 * neighbourhood only, with coarse coordinates. A jury gets enough to see the
 * review is about a real place and no more.
 *
 * If the review text itself names an address, that travels — inside the review,
 * where it belongs, as the material being judged. That is exactly what a
 * `privacy.personal_information` allegation is claiming, and redacting it would
 * remove the evidence for the report.
 *
 * ## Ratings do not travel
 *
 * A review carries thirty-odd structured ratings — noise, light, deposit
 * returned, neighbour relations. None of them can be true or false in the sense
 * a jury decides, and shipping them would hand reviewers a pile of material to
 * read that cannot change any answer. The star rating is the one exception,
 * carried as metadata rather than as material: a five-star review whose text is
 * abusive, or a one-star review with no substance, is a fact about the shape of
 * the thing being judged.
 *
 * ## The read lives HERE, and states what it selects
 *
 * There is no `db/reviews/` repository — this is the only reader of the table
 * outside the review controllers' own Mongo path, and a repository built for one
 * caller would be a shared module nothing shares. The join is the same address +
 * geo-name shape every other reader uses, through `ADDRESS_GEO_JOINS` and
 * `ADDRESS_GEO_NAME_COLUMNS`, so a snapshot cannot spell the geo chain its own
 * way.
 *
 * The selection is explicit and short, which is the port of the old
 * `SNAPSHOT_PROJECTION`: a moderation snapshot must not read thirty rating
 * columns it has already decided not to send.
 *
 * `reviews.address_id` is `NOT NULL` with an `ON DELETE RESTRICT` foreign key
 * and `addresses.longitude` / `latitude` are `NOT NULL` with a range CHECK, so
 * the permalink and the location context always travel. Under Mongoose both
 * depended on whether the `addressId` ref happened to have been populated, and
 * reading only one of the two branches was how a permalink stopped being emitted
 * for every review at once.
 */

import { eq } from 'drizzle-orm';

import { getDb } from '../../../db/postgres';
import { addresses, reviews } from '../../../db/schema';
import {
  ADDRESS_GEO_JOINS,
  ADDRESS_GEO_NAME_COLUMNS,
  toAddressWithGeoNames,
  type AddressWithGeoNames,
} from '../../../db/addresses/addressSerializer';
import config from '../../../config';
import type {
  ModerationContextResource,
  ModerationResource,
  ModerationSubjectProvider,
  ModerationSubjectSnapshot,
} from './types';

/** The contract bounds text resources; this keeps well inside it. */
const MAX_TEXT_LENGTH = 4_000;
/** The contract refuses anything finer. Roughly a kilometre. */
const COARSE_COORDINATE_DECIMALS = 2;

/** Exactly the columns a snapshot sends or decides on. */
const REVIEW_SNAPSHOT_COLUMNS = {
  id: reviews.id,
  oxyUserId: reviews.oxyUserId,
  title: reviews.title,
  opinion: reviews.opinion,
  prosItems: reviews.prosItems,
  consItems: reviews.consItems,
  adviceToAgency: reviews.adviceToAgency,
  adviceToLandlord: reviews.adviceToLandlord,
  positiveComment: reviews.positiveComment,
  negativeComment: reviews.negativeComment,
  rating: reviews.rating,
  recommendation: reviews.recommendation,
  images: reviews.images,
  createdAt: reviews.createdAt,
} as const;

interface SnapshotReview {
  id: string;
  oxyUserId: string;
  title: string | null;
  opinion: string;
  prosItems: string[];
  consItems: string[];
  adviceToAgency: string | null;
  adviceToLandlord: string | null;
  positiveComment: string | null;
  negativeComment: string | null;
  rating: number;
  recommendation: boolean;
  images: string[];
  createdAt: Date;
}

/** One review with the address it is about, or `null`. */
async function findReviewForSnapshot(
  reviewId: string,
): Promise<{ review: SnapshotReview; address: AddressWithGeoNames } | null> {
  const query = getDb()
    .select({
      review: REVIEW_SNAPSHOT_COLUMNS,
      address: addresses,
      ...ADDRESS_GEO_NAME_COLUMNS,
    })
    .from(reviews)
    .innerJoin(addresses, eq(reviews.addressId, addresses.id))
    .$dynamic();

  for (const join of ADDRESS_GEO_JOINS) query.leftJoin(join.table, join.on);

  const [row] = await query.where(eq(reviews.id, reviewId)).limit(1);
  if (!row) return null;
  return { review: row.review, address: toAddressWithGeoNames(row) };
}

function roundCoarse(value: number): number {
  const factor = 10 ** COARSE_COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

function trimmed(value: string | null): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

/**
 * The review as a reader sees it.
 *
 * Assembled from the fields the current form writes, falling back to the legacy
 * free-text ones for rows written before `pros_items`/`cons_items` existed — a
 * review from 2025 must not arrive at a jury as an empty body.
 *
 * The section labels are Homiio's, not the reviewer's, and they are here for the
 * same reason the review page has them: "the deposit was never returned" reads
 * differently under "Cons" than under "Advice to the landlord". Labelling is
 * presentation, not interpretation.
 */
function reviewText(review: SnapshotReview): string | null {
  const sections: string[] = [];

  const title = trimmed(review.title);
  if (title) sections.push(title);

  const opinion = trimmed(review.opinion);
  if (opinion) sections.push(opinion);

  const pros = review.prosItems.map(trimmed).filter((item): item is string => !!item);
  const legacyPositive = trimmed(review.positiveComment);
  if (pros.length > 0) sections.push(`Pros: ${pros.join('; ')}`);
  else if (legacyPositive) sections.push(`Pros: ${legacyPositive}`);

  const cons = review.consItems.map(trimmed).filter((item): item is string => !!item);
  const legacyNegative = trimmed(review.negativeComment);
  if (cons.length > 0) sections.push(`Cons: ${cons.join('; ')}`);
  else if (legacyNegative) sections.push(`Cons: ${legacyNegative}`);

  const toLandlord = trimmed(review.adviceToLandlord);
  if (toLandlord) sections.push(`Advice to the landlord: ${toLandlord}`);

  const toAgency = trimmed(review.adviceToAgency);
  if (toAgency) sections.push(`Advice to the agency: ${toAgency}`);

  if (sections.length === 0) return null;
  return sections.join('\n\n').slice(0, MAX_TEXT_LENGTH);
}

/** City and neighbourhood only — see the module comment. */
function locationContext(address: AddressWithGeoNames): ModerationContextResource {
  const label = [address.neighborhoodName, address.cityName]
    .map((name) => name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 0))
    .join(', ');

  return {
    role: 'context',
    type: 'location',
    data: {
      ...(label.length > 0 ? { label } : {}),
      longitude: roundCoarse(address.longitude),
      latitude: roundCoarse(address.latitude),
    },
  };
}

function describe(input: {
  review: SnapshotReview;
  address: AddressWithGeoNames;
}): ModerationSubjectSnapshot {
  const { review, address } = input;
  const text = reviewText(review);
  const photoCount = review.images.length;

  /**
   * A review with no words at all still has to be describable — the ratings
   * exist and somebody reported it. A `metadata` resource says what it consisted
   * of without pretending to carry text that was never written; the contract
   * refuses an empty text resource, and rightly so.
   */
  const content: ModerationResource =
    text === null
      ? {
          type: 'metadata',
          data: { body: 'absent', reviewPhotos: photoCount, stars: review.rating },
        }
      : {
          type: 'text',
          data: { text },
          createdAt: review.createdAt,
        };

  return {
    subject: {
      externalId: review.id,
      type: 'commerce.review',
      /**
       * Homiio has no per-review page: a review is read on the page of the
       * address it is about, which is where a Homiio user would go to see it.
       */
      permalink: `${config.web.baseUrl}/addresses/${address.id}`,
      author: { oxyUserId: review.oxyUserId },
    },
    content,
    context: [locationContext(address)],
    metadata: {
      reviewPhotos: photoCount,
      reviewStars: review.rating,
      reviewRecommends: review.recommendation,
    },
  };
}

export function createReviewSubjectProvider(input: {
  reportedType: string;
}): ModerationSubjectProvider {
  return {
    reportedType: input.reportedType,
    subjectType: 'commerce.review',

    /**
     * No id-shape guard precedes this read, and that is deliberate — see
     * `db/ids.ts`. Post-cutover every review created carries a uuid v7, for
     * which `isValidObjectId` is FALSE, so the guard that used to stand here
     * would have made every new review silently un-reportable while a valid
     * report was answered "the object is gone". The query answers "no such row"
     * for every id shape, including a malformed one, because `reviews.id` is a
     * `text` column that takes any string.
     */
    async snapshot(reportedId: string): Promise<ModerationSubjectSnapshot | null> {
      const found = await findReviewForSnapshot(reportedId);
      return found === null ? null : describe(found);
    },
  };
}
