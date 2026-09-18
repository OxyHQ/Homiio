/**
 * What a review CARD is allowed to draw — the read side of ADR 0003 §5.2 and
 * §5.6, and the aggregate floor of §4.4 now that the author handle it counts is
 * the author's own choice.
 *
 * Three things here can only be caught by a test:
 *
 *  - **An avatar is an identity.** `reviewAuthorDisplay` must return no user for
 *    a pseudonymous or anonymous review EVEN WHEN the parent hydrated one — and
 *    the parent does, because the same list mixes identified authors in. A
 *    version that simply passed `author` through would look right and publish a
 *    face the author did not.
 *  - **The band is not a fallback.** `price` is absent on somebody else's
 *    review, so a renderer that reached for it would print nothing and nobody
 *    would notice; the assertion is that the BAND is what comes out.
 *  - **The floor under-counts rather than over-counts.** Anonymous reviews carry
 *    no handle at all, so they must collapse into one author. Over-counting
 *    publishes a share the set does not support, which is the failure that has
 *    no symptom.
 */
import { DepositReturn, ReviewAuthorIdentity, type ReviewDTO } from '@homiio/shared-types';
import type { User } from '@oxy.so/core';

import {
  distinctPublishedAuthors,
  placeReviewStats,
} from '@/components/reviews/PlaceReviewsSummary';
import {
  reviewAuthorDisplay,
  reviewRentLabel,
  tenancyMonthDate,
} from '@/components/reviews/publishedFacts';

/** The real `t` is i18next's; here the key plus its interpolation IS the assertion. */
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key}|${JSON.stringify(vars)}` : key) as never;

const AUTHOR = {
  id: 'oxy-1',
  username: 'marta',
  name: { displayName: 'Marta R.' },
  avatar: 'file-1',
} as unknown as User;

const review = (extra: Partial<ReviewDTO> = {}): ReviewDTO =>
  ({
    id: 'r1',
    rating: 4,
    recommendation: true,
    currency: 'EUR',
    authorIdentity: ReviewAuthorIdentity.PSEUDONYMOUS,
    livedFromMonth: '2023-03',
    livedToMonth: '2024-08',
    ...extra,
  }) as ReviewDTO;

describe('reviewAuthorDisplay', () => {
  it('shows the Oxy name and the avatar for an identified author', () => {
    const shown = reviewAuthorDisplay(
      review({ authorIdentity: ReviewAuthorIdentity.IDENTIFIED, oxyUserId: 'oxy-1' }),
      AUTHOR,
      t,
    );
    expect(shown.name).toBe('Marta R.');
    expect(shown.avatarUser).toBe(AUTHOR);
  });

  it('shows a short per-building reference for a pseudonymous author, and no avatar', () => {
    const shown = reviewAuthorDisplay(review({ authorKey: '4f2ab91c0d' }), AUTHOR, t);
    expect(shown.name).toBe('reviews.card.pseudonymousAuthor|{"reference":"4F2A"}');
    // The parent hydrated a user — the card must still not draw their face.
    expect(shown.avatarUser).toBeUndefined();
  });

  it('shows one shared label for an anonymous resident, whatever else is in hand', () => {
    const shown = reviewAuthorDisplay(
      review({
        authorIdentity: ReviewAuthorIdentity.VERIFIED_ANONYMOUS_RESIDENT,
        authorKey: 'should-not-be-read',
      }),
      AUTHOR,
      t,
    );
    expect(shown.name).toBe('reviews.card.anonymousResident');
    expect(shown.avatarUser).toBeUndefined();
  });

  it('falls back to the shared label when a pseudonymous key did not travel', () => {
    // Publishing LESS than the author chose is the safe direction, and a missing
    // key is never a reason to reach for `oxyUserId`.
    const shown = reviewAuthorDisplay(review({ oxyUserId: 'oxy-1' }), AUTHOR, t);
    expect(shown.name).toBe('reviews.card.anonymousResident');
    expect(shown.avatarUser).toBeUndefined();
  });
});

describe('reviewRentLabel', () => {
  it('renders the band on somebody else’s review, where there is no exact figure', () => {
    const label = reviewRentLabel(review({ priceBand: { min: 1250, max: 1500, currency: 'EUR' } }), 'en', t);
    expect(label).toContain('reviews.card.perMonthBand');
    // Both ends of the band, and no exact rent anywhere in the string.
    expect(label).toContain('1,250');
    expect(label).toContain('1,500');
  });

  it('renders the open top band with its own key rather than a fabricated ceiling', () => {
    const label = reviewRentLabel(review({ priceBand: { min: 3000, currency: 'EUR' } }), 'en', t);
    expect(label).toContain('reviews.card.perMonthFrom');
    expect(label).toContain('3,000');
  });

  it('renders the exact rent for the author, who is served one', () => {
    const label = reviewRentLabel(
      review({ price: 1337, priceBand: { min: 1250, max: 1500, currency: 'EUR' } }),
      'en',
      t,
    );
    expect(label).toBe('reviews.card.perMonth|{"price":1337,"currency":"EUR"}');
  });

  it('renders nothing when the review publishes no rent at all', () => {
    expect(reviewRentLabel(review(), 'en', t)).toBeNull();
  });
});

describe('tenancyMonthDate', () => {
  it('lands on the stated month regardless of the viewer’s zone', () => {
    const date = tenancyMonthDate('2023-03');
    expect(date?.toISOString()).toBe('2023-03-01T12:00:00.000Z');
    // Noon, not midnight: `new Date('2023-03-01')` is midnight UTC and renders
    // as February for every viewer west of Greenwich.
    expect(date?.getUTCHours()).toBe(12);
  });

  it('answers null for anything that is not the shape the API promises', () => {
    expect(tenancyMonthDate('2023-3')).toBeNull();
    expect(tenancyMonthDate('')).toBeNull();
  });
});

describe('distinctPublishedAuthors', () => {
  it('counts per-building pseudonyms as the people they stand for', () => {
    expect(
      distinctPublishedAuthors([
        review({ authorKey: 'a' }),
        review({ authorKey: 'a' }),
        review({ authorKey: 'b' }),
      ]),
    ).toBe(2);
  });

  it('counts an identified author by their account', () => {
    expect(
      distinctPublishedAuthors([
        review({ authorIdentity: ReviewAuthorIdentity.IDENTIFIED, oxyUserId: 'oxy-1' }),
        review({ authorKey: 'a' }),
      ]),
    ).toBe(2);
  });

  it('collapses every anonymous review into ONE author, which under-counts on purpose', () => {
    const anonymous = review({ authorIdentity: ReviewAuthorIdentity.VERIFIED_ANONYMOUS_RESIDENT });
    expect(distinctPublishedAuthors([anonymous, anonymous, anonymous])).toBe(1);
    // Under-counting withholds a share; over-counting publishes one the set does
    // not support. This asserts the safe direction, which is the whole decision.
    expect(distinctPublishedAuthors([anonymous, anonymous, review({ authorKey: 'a' })])).toBe(2);
  });
});

describe('placeReviewStats reads the published author handle', () => {
  const keyed = (key: string, extra: Partial<ReviewDTO> = {}) =>
    review({ id: `r-${key}-${Math.random()}`, authorKey: key, ...extra });

  it('publishes the shares when the pseudonyms clear the floor', () => {
    const stats = placeReviewStats([
      keyed('a', { depositReturned: DepositReturn.FULL }),
      keyed('b', { depositReturned: DepositReturn.FULL }),
      keyed('c', { depositReturned: DepositReturn.PARTIAL, recommendation: false }),
      keyed('d', { depositReturned: DepositReturn.NO }),
      keyed('e', { depositReturned: DepositReturn.FULL }),
    ]);
    expect(stats.recommendRate).toBeCloseTo(4 / 5);
    expect(stats.depositReturnedRate).toBeCloseTo(3 / 5);
  });

  it('withholds them when five anonymous reviews collapse to one author', () => {
    const anonymous = () => review({ authorIdentity: ReviewAuthorIdentity.VERIFIED_ANONYMOUS_RESIDENT });
    const stats = placeReviewStats([anonymous(), anonymous(), anonymous(), anonymous(), anonymous()]);
    expect(stats.totalReviews).toBe(5);
    expect(stats.recommendRate).toBeUndefined();
  });
});
