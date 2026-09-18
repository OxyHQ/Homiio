/**
 * What a review card may SHOW — the read side of ADR 0003 §5.2 and §5.6.
 *
 * The backend decides what leaves; this module decides how the three published
 * shapes are rendered, in ONE place, because the same review is drawn by
 * `ReviewCard`, by `CommunityNoteCard` and by the agency list, and three copies
 * of "what do we call an anonymous author" is how the third one ends up showing
 * a name.
 *
 * The rule these implement, so the reason is visible at the call site: unit +
 * tenancy dates + rent together narrow a building to one household. #506 stopped
 * publishing the unit; the API now publishes the dates at month grain and the
 * rent as a band, and there is no exact figure here to fall back to — `price`
 * and `livedFrom`/`livedTo` are simply ABSENT on somebody else's review.
 */
import type { TFunction } from 'i18next';

import {
  formatMoney,
  formatMoneyRange,
  ReviewAuthorIdentity,
  type ReviewDTO,
} from '@homiio/shared-types';
import type { User } from '@oxy.so/core';

/** How many characters of the pseudonym become the visible reference. */
const PSEUDONYM_REFERENCE_LENGTH = 4;

/**
 * The name a review is shown under, and whether an avatar may be drawn for it.
 *
 * Three cases, one per §5.2 form:
 *
 *  - `identified` — the Oxy display name (or handle), with the real avatar.
 *  - `pseudonymous` — a short reference derived from the per-BUILDING pseudonym,
 *    so a reader can see that two reviews of this building are by one person,
 *    and cannot follow that person to another building. Uppercased hex is
 *    deliberately not a word: a generated nickname reads as a real name.
 *  - `verified_anonymous_resident` — one label shared by every such author, so
 *    two of them are indistinguishable. That is the whole point of the form.
 *
 * `avatarUser` is `undefined` for both anonymous forms even when the parent
 * happens to have hydrated a user: an avatar is a face, and a face is an
 * identity the author did not publish.
 */
export function reviewAuthorDisplay(
  review: ReviewDTO,
  author: User | undefined,
  t: TFunction,
): { name: string; avatarUser?: User } {
  if (review.authorIdentity === ReviewAuthorIdentity.IDENTIFIED) {
    return {
      name: author?.name?.displayName?.trim() || author?.username || t('reviews.card.anonymous'),
      avatarUser: author,
    };
  }
  if (review.authorIdentity === ReviewAuthorIdentity.PSEUDONYMOUS && review.authorKey) {
    return {
      name: t('reviews.card.pseudonymousAuthor', {
        reference: review.authorKey.slice(0, PSEUDONYM_REFERENCE_LENGTH).toUpperCase(),
      }),
    };
  }
  // Also the fallback for a `pseudonymous` review whose key did not travel —
  // publishing LESS than the author chose is the safe direction, and a missing
  // key is never a reason to reach for `oxyUserId`.
  return { name: t('reviews.card.anonymousResident') };
}

/**
 * The monthly rent as this review publishes it, or `null` when it publishes
 * none.
 *
 * The author's own copy still carries the exact figure, so their own card reads
 * the way they typed it; everybody else gets the band. A band with no `max` is
 * the open top one and is rendered as "X or more" by its own key rather than by
 * a fabricated ceiling.
 */
export function reviewRentLabel(review: ReviewDTO, locale: string, t: TFunction): string | null {
  if (typeof review.price === 'number' && review.price > 0) {
    return t('reviews.card.perMonth', {
      price: review.price,
      currency: review.currency,
    });
  }
  const band = review.priceBand;
  if (!band) return null;
  const options = { maximumFractionDigits: 0, minimumFractionDigits: 0 } as const;
  if (typeof band.max !== 'number') {
    return t('reviews.card.perMonthFrom', {
      price: formatMoney(band.min, band.currency, locale, options),
    });
  }
  return t('reviews.card.perMonthBand', {
    range: formatMoneyRange(band.min, band.max, band.currency, locale, options),
  });
}

/**
 * A `YYYY-MM` tenancy month as a localised "month year".
 *
 * Parsed as UTC noon rather than midnight: `new Date('2024-03-01')` is midnight
 * UTC, and a viewer west of Greenwich renders that as February. Noon leaves 12
 * hours of slack in both directions, which covers every real zone offset.
 * Returns the raw value if it is not the shape the API promises, because a
 * visible `2024-03` is a better failure than `Invalid Date`.
 */
export function tenancyMonthDate(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1, 12));
}
