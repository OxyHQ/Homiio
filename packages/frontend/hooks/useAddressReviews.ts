/**
 * useAddressReviews — single source of truth for a property's
 * community/address reviews.
 *
 * Both `ReviewsSection` and `CommunityNotesSection` (and the booking card's
 * rating badge) read the same `/api/reviews/address/:id` endpoint under the
 * `['addressReviews', addressId]` React Query key. Centralising the address-id
 * extraction + the fetch here keeps that ONE cache key the shared source — so
 * the booking card's rating, the reviews block, and the community-notes block
 * never fire duplicate requests, and the rating math (`averageRating`,
 * `totalReviews`) is computed once, the same way, for every consumer.
 */
import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { Property, ReviewDTO } from '@homiio/shared-types';

import { reviewService } from '@/services/reviewService';

/** Aggregated rating summary derived from a property's reviews. */
export interface ReviewRatingSummary {
  /** Mean of every review's `rating` (0 when there are no reviews). */
  averageRating: number;
  /** Total number of reviews returned for the address. */
  totalReviews: number;
}

/**
 * Pull a stable address id off a property. The id can land in a few shapes
 * depending on whether the property was hydrated from the list vs the detail
 * endpoint, so this mirrors the extraction both review sections already use.
 */
export function getReviewAddressId(property: Property | null | undefined): string | undefined {
  const address = property?.address;
  if (!address || typeof address !== 'object') return undefined;
  if ('_id' in address) {
    const id = (address as { _id?: unknown })._id;
    if (typeof id === 'string') return id;
  }
  if ('id' in address) {
    const id = (address as { id?: unknown }).id;
    if (typeof id === 'string') return id;
  }
  return undefined;
}

/** Compute the rating summary for a loaded review list. */
export function computeReviewRatingSummary(reviews: ReviewDTO[]): ReviewRatingSummary {
  if (reviews.length === 0) {
    return { averageRating: 0, totalReviews: 0 };
  }
  const ratingSum = reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
  return {
    averageRating: ratingSum / reviews.length,
    totalReviews: reviews.length,
  };
}

export interface UseAddressReviewsResult {
  /** The resolved address id (undefined when the property carries none). */
  addressId: string | undefined;
  /** Raw reviews (building + unit) for the address. */
  reviews: ReviewDTO[];
  /** Aggregated rating summary (`averageRating`, `totalReviews`). */
  ratingSummary: ReviewRatingSummary;
  /** The underlying query, exposed for loading/error/refetch handling. */
  query: UseQueryResult<ReviewDTO[], Error>;
}

/**
 * Load a property's address reviews and derive its rating summary.
 *
 * Shares the `['addressReviews', addressId]` cache key with the review
 * sections, so calling this alongside them does NOT duplicate the request.
 */
export function useAddressReviews(
  property: Property | null | undefined,
): UseAddressReviewsResult {
  const addressId = useMemo(() => getReviewAddressId(property), [property]);

  const query = useQuery<ReviewDTO[], Error>({
    queryKey: ['addressReviews', addressId],
    enabled: Boolean(addressId),
    queryFn: async () => {
      if (!addressId) return [];
      const result = await reviewService.getReviewsByAddress(addressId);
      return result.reviews;
    },
  });

  const ratingSummary = useMemo(
    () => computeReviewRatingSummary(query.data ?? []),
    [query.data],
  );

  return { addressId, reviews: query.data ?? [], ratingSummary, query };
}
