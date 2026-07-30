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
 */

import mongoose from 'mongoose';
import { Review } from '../../../models';
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

type GeoRef = mongoose.Types.ObjectId | string | { name?: unknown } | null | undefined;

interface SnapshotAddress {
  _id?: mongoose.Types.ObjectId;
  cityId?: GeoRef;
  neighborhoodId?: GeoRef;
  coordinates?: { coordinates?: number[] };
}

interface SnapshotReview {
  _id: mongoose.Types.ObjectId;
  oxyUserId?: string;
  title?: string;
  opinion?: string;
  prosItems?: string[];
  consItems?: string[];
  adviceToAgency?: string;
  adviceToLandlord?: string;
  positiveComment?: string;
  negativeComment?: string;
  rating?: number;
  recommendation?: boolean;
  images?: string[];
  createdAt?: Date | string;
  addressId?: SnapshotAddress | mongoose.Types.ObjectId | null;
}

const SNAPSHOT_PROJECTION =
  'oxyUserId title opinion prosItems consItems adviceToAgency adviceToLandlord ' +
  'positiveComment negativeComment rating recommendation images createdAt addressId';

function geoName(ref: GeoRef): string | undefined {
  if (ref && typeof ref === 'object' && !(ref instanceof mongoose.Types.ObjectId)) {
    const name: unknown = (ref as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return undefined;
}

function populatedAddress(review: SnapshotReview): SnapshotAddress | null {
  const address = review.addressId;
  if (!address || address instanceof mongoose.Types.ObjectId) return null;
  return address;
}

/**
 * The address id, whether the ref was populated or left bare.
 *
 * The query above populates it, so the populated branch is the live one — but a
 * populated ref still carries `_id`, and reading only the bare-ObjectId branch
 * is how a permalink silently stops being emitted for every review at once.
 */
function addressIdOf(review: SnapshotReview): string | undefined {
  const address = review.addressId;
  if (!address) return undefined;
  if (address instanceof mongoose.Types.ObjectId) return address.toHexString();
  return address._id === undefined ? undefined : address._id.toHexString();
}

function roundCoarse(value: number): number {
  const factor = 10 ** COARSE_COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length > 0 ? text : undefined;
}

/**
 * The review as a reader sees it.
 *
 * Assembled from the fields the current form writes, falling back to the legacy
 * free-text ones for rows written before `prosItems`/`consItems` existed — a
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

  const pros = (review.prosItems ?? []).map(trimmed).filter((item): item is string => !!item);
  const legacyPositive = trimmed(review.positiveComment);
  if (pros.length > 0) sections.push(`Pros: ${pros.join('; ')}`);
  else if (legacyPositive) sections.push(`Pros: ${legacyPositive}`);

  const cons = (review.consItems ?? []).map(trimmed).filter((item): item is string => !!item);
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
function locationContext(review: SnapshotReview): ModerationContextResource | null {
  const address = populatedAddress(review);
  if (!address) return null;

  const label = [geoName(address.neighborhoodId), geoName(address.cityId)]
    .filter((part): part is string => Boolean(part))
    .join(', ');
  const point = address.coordinates?.coordinates;
  const hasPoint =
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]);

  if (label.length === 0 && !hasPoint) return null;

  return {
    role: 'context',
    type: 'location',
    data: {
      ...(label.length > 0 ? { label } : {}),
      ...(hasPoint
        ? { longitude: roundCoarse(point[0]), latitude: roundCoarse(point[1]) }
        : {}),
    },
  };
}

export function createReviewSubjectProvider(input: {
  reportedType: string;
}): ModerationSubjectProvider {
  return {
    reportedType: input.reportedType,
    subjectType: 'commerce.review',

    async snapshot(reportedId: string): Promise<ModerationSubjectSnapshot | null> {
      if (!mongoose.isValidObjectId(reportedId)) return null;
      const review = await Review.findById(reportedId)
        .select(SNAPSHOT_PROJECTION)
        .populate({
          path: 'addressId',
          select: '_id cityId neighborhoodId coordinates',
          populate: [
            { path: 'cityId', select: 'name' },
            { path: 'neighborhoodId', select: 'name' },
          ],
        })
        .lean<SnapshotReview | null>();
      if (!review) return null;

      const text = reviewText(review);
      const location = locationContext(review);
      const photoCount = Array.isArray(review.images) ? review.images.length : 0;

      /**
       * A review with no words at all still has to be describable — the ratings
       * exist and somebody reported it. A `metadata` resource says what it
       * consisted of without pretending to carry text that was never written;
       * the contract refuses an empty text resource, and rightly so.
       */
      const content: ModerationResource =
        text === null
          ? {
              type: 'metadata',
              data: {
                body: 'absent',
                reviewPhotos: photoCount,
                ...(review.rating === undefined ? {} : { stars: review.rating }),
              },
            }
          : {
              type: 'text',
              data: { text },
              ...(review.createdAt === undefined
                ? {}
                : { createdAt: new Date(review.createdAt) }),
            };

      const addressIdString = addressIdOf(review);

      return {
        subject: {
          externalId: review._id.toHexString(),
          type: 'commerce.review',
          /**
           * Homiio has no per-review page: a review is read on the page of the
           * address it is about, which is where a Homiio user would go to see
           * it. Omitted entirely when the address ref was populated away, rather
           * than pointing at a URL that would not resolve.
           */
          ...(addressIdString === undefined
            ? {}
            : { permalink: `${config.web.baseUrl}/addresses/${addressIdString}` }),
          ...(review.oxyUserId === undefined
            ? {}
            : { author: { oxyUserId: review.oxyUserId } }),
        },
        content,
        ...(location === null ? {} : { context: [location] }),
        metadata: {
          reviewPhotos: photoCount,
          ...(review.rating === undefined ? {} : { reviewStars: review.rating }),
          ...(review.recommendation === undefined
            ? {}
            : { reviewRecommends: review.recommendation }),
        },
      };
    },
  };
}
