/**
 * PlaceReviewsSummary — the head of a place's reviews, on Bloom's
 * `place-reviews` `PlaceReviewSummary`: the average rating, the review count,
 * and the tenancy stat lines ("Deposit returned in full in 82% of tenancies",
 * "71% would recommend living here").
 *
 * Reviews attach to the ADDRESS, never to a listing (ADR 0001), so every caller
 * hands in the reviews of one address — the property detail reads them through
 * `useAddressReviews`, the address page by id.
 *
 * ## The stat lines publish only above the aggregate floor
 *
 * A share is an aggregate about the people who wrote the reviews, so the two
 * rates are drawn only when the set clears the publication floor of
 * `docs/adr/0003-privacy-verification-publication.md` §4.4 (records AND
 * distinct authors) — below it they are left out, not shown with a caveat.
 * Nothing here is invented: no category scores are drawn (Homiio's review
 * dimensions are categorical answers, not ratings), and a rate with no answers
 * behind it is omitted rather than shown as 0%.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { PlaceReviewSummary } from '@oxy.so/bloom/place-reviews';
import { DepositReturn, type ReviewDTO } from '@homiio/shared-types';

/** ADR 0003 §4.4: an aggregate needs this many records… */
export const AGGREGATE_MIN_RECORDS = 5;
/** …from at least this many distinct authors. */
export const AGGREGATE_MIN_AUTHORS = 3;

export interface PlaceReviewStats {
  averageRating: number;
  totalReviews: number;
  /** Share (0..1) recommending the place; absent below the floor. */
  recommendRate?: number;
  /** Share (0..1) of answered reviews with the deposit returned in full; absent below the floor or unanswered. */
  depositReturnedRate?: number;
}

/** The summary figures for one place's reviews. */
export function placeReviewStats(reviews: readonly ReviewDTO[]): PlaceReviewStats {
  const totalReviews = reviews.length;
  if (totalReviews === 0) return { averageRating: 0, totalReviews: 0 };
  const averageRating = reviews.reduce((sum, review) => sum + (review.rating || 0), 0) / totalReviews;

  const authors = new Set(reviews.map((review) => review.oxyUserId)).size;
  if (totalReviews < AGGREGATE_MIN_RECORDS || authors < AGGREGATE_MIN_AUTHORS) {
    return { averageRating, totalReviews };
  }

  const recommendRate = reviews.filter((review) => review.recommendation).length / totalReviews;
  const answered = reviews.filter((review) => typeof review.depositReturned === 'string' && review.depositReturned);
  const depositReturnedRate =
    answered.length >= AGGREGATE_MIN_RECORDS
      ? answered.filter((review) => review.depositReturned === DepositReturn.FULL).length / answered.length
      : undefined;

  return { averageRating, totalReviews, recommendRate, depositReturnedRate };
}

interface PlaceReviewsSummaryProps {
  stats: PlaceReviewStats;
}

export const PlaceReviewsSummary: React.FC<PlaceReviewsSummaryProps> = ({ stats }) => {
  const { t } = useTranslation();
  return (
    <PlaceReviewSummary
      rating={Number(stats.averageRating.toFixed(1))}
      title={t('reviews.summary.title')}
      reviewCount={stats.totalReviews}
      formatReviewCount={(count) => t('property.reviews.total', { count: Number(count) })}
      recommendRate={stats.recommendRate}
      formatRecommend={(percent) => t('reviews.summary.recommend', { percent })}
      depositReturnedRate={stats.depositReturnedRate}
      formatDepositReturned={(percent) => t('reviews.summary.depositReturned', { percent })}
    />
  );
};

export default PlaceReviewsSummary;
