/**
 * The two numbers the discover surfaces decide on their own, pinned:
 *
 *  - the confidence a comparable sample supports on "Prices in this area"
 *    (the per-offering minimums of ADR 0004 §6.9, never above `medium`
 *    because every figure is an asking price), and
 *  - whether a place's review shares publish at all (the aggregate floor of
 *    ADR 0003 §4.4: records AND distinct authors).
 */
import { DepositReturn, type ReviewDTO } from '@homiio/shared-types';

import { areaPriceConfidence } from '@/components/property/PriceRangeSection';
import { placeReviewStats } from '@/components/reviews/PlaceReviewsSummary';

describe('areaPriceConfidence', () => {
  it('places nothing below the low minimum of the offering', () => {
    expect(areaPriceConfidence(0, 'month')).toBeNull();
    expect(areaPriceConfidence(7, 'month')).toBeNull();
    expect(areaPriceConfidence(19, 'night')).toBeNull();
    expect(areaPriceConfidence(11, 'sale')).toBeNull();
  });

  it('is low between the low and medium minimums', () => {
    expect(areaPriceConfidence(8, 'month')).toBe('low');
    expect(areaPriceConfidence(14, 'month')).toBe('low');
    expect(areaPriceConfidence(24, 'sale')).toBe('low');
  });

  it('never claims more than medium, however large the sample', () => {
    expect(areaPriceConfidence(15, 'month')).toBe('medium');
    expect(areaPriceConfidence(10_000, 'month')).toBe('medium');
    expect(areaPriceConfidence(10_000, 'night')).toBe('medium');
  });

  it('reads an unknown unit with the long-term minimums', () => {
    expect(areaPriceConfidence(8, 'fortnight')).toBe('low');
  });
});

const review = (id: string, author: string, extra: Partial<ReviewDTO> = {}): ReviewDTO =>
  ({ id, oxyUserId: author, rating: 4, recommendation: true, ...extra }) as ReviewDTO;

describe('placeReviewStats', () => {
  it('has no figures without reviews', () => {
    expect(placeReviewStats([])).toEqual({ averageRating: 0, totalReviews: 0 });
  });

  it('keeps the average but withholds the shares below the record floor', () => {
    const stats = placeReviewStats([review('1', 'a'), review('2', 'b'), review('3', 'c'), review('4', 'd')]);
    expect(stats.totalReviews).toBe(4);
    expect(stats.averageRating).toBe(4);
    expect(stats.recommendRate).toBeUndefined();
    expect(stats.depositReturnedRate).toBeUndefined();
  });

  it('withholds the shares when too few distinct authors wrote enough reviews', () => {
    const stats = placeReviewStats([
      review('1', 'a'),
      review('2', 'a'),
      review('3', 'a'),
      review('4', 'b'),
      review('5', 'b'),
    ]);
    expect(stats.recommendRate).toBeUndefined();
  });

  it('publishes the shares above the floor, deposit only over answered reviews', () => {
    const stats = placeReviewStats([
      review('1', 'a', { depositReturned: DepositReturn.FULL }),
      review('2', 'b', { depositReturned: DepositReturn.FULL }),
      review('3', 'c', { depositReturned: DepositReturn.PARTIAL, recommendation: false }),
      review('4', 'd', { depositReturned: DepositReturn.NO }),
      review('5', 'e', { depositReturned: DepositReturn.FULL }),
      review('6', 'f'),
    ]);
    expect(stats.recommendRate).toBeCloseTo(5 / 6);
    expect(stats.depositReturnedRate).toBeCloseTo(3 / 5);
  });

  it('omits the deposit share when too few reviews answered it', () => {
    const stats = placeReviewStats([
      review('1', 'a', { depositReturned: DepositReturn.FULL }),
      review('2', 'b'),
      review('3', 'c'),
      review('4', 'd'),
      review('5', 'e'),
    ]);
    expect(stats.recommendRate).toBe(1);
    expect(stats.depositReturnedRate).toBeUndefined();
  });
});
