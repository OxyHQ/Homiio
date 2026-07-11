/**
 * Review mutation hooks — helpful votes + reports.
 *
 * `useToggleHelpful` optimistically flips `viewerHasVotedHelpful` +
 * `helpfulCount` on EVERY loaded review list that could contain the review: the
 * address-review caches (`['addressReviews', addressId]`, a flat `ReviewDTO[]`)
 * AND the agency-review caches (`['agencyReviews', slug]`, an infinite query of
 * `{ reviews }` pages). It snapshots every matched cache, applies the flip, and
 * rolls back on error; on success it writes the server's authoritative
 * `{ helpfulCount, viewerHasVotedHelpful }`.
 */
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type Query,
} from '@tanstack/react-query';

import type { ReviewDTO, ReviewReportReason } from '@homiio/shared-types';

import { reviewService, type HelpfulResult } from '@/services/reviewService';

/** True for any cache that holds review lists a helpful-flip should touch. */
const isReviewListQuery = (query: Query): boolean => {
  const root = query.queryKey[0];
  return root === 'addressReviews' || root === 'agencyReviews';
};

type ReviewPage = { reviews: ReviewDTO[] };

/** Apply `mapFn` to every review inside either cache shape (flat array or infinite pages). */
function mapReviewsInCache(old: unknown, mapFn: (review: ReviewDTO) => ReviewDTO): unknown {
  if (Array.isArray(old)) {
    return (old as ReviewDTO[]).map(mapFn);
  }
  if (old && typeof old === 'object' && 'pages' in old) {
    const infinite = old as InfiniteData<ReviewPage>;
    return {
      ...infinite,
      pages: infinite.pages.map((page) => ({
        ...page,
        reviews: Array.isArray(page.reviews) ? page.reviews.map(mapFn) : page.reviews,
      })),
    };
  }
  return old;
}

export function useToggleHelpful() {
  const queryClient = useQueryClient();

  return useMutation<HelpfulResult, Error, string, { snapshots: [readonly unknown[], unknown][] }>({
    mutationFn: (reviewId: string) => reviewService.toggleHelpful(reviewId),
    onMutate: async (reviewId) => {
      await queryClient.cancelQueries({ predicate: isReviewListQuery });
      const snapshots = queryClient.getQueriesData({ predicate: isReviewListQuery });
      queryClient.setQueriesData({ predicate: isReviewListQuery }, (old) =>
        mapReviewsInCache(old, (review) =>
          review.id === reviewId
            ? {
                ...review,
                viewerHasVotedHelpful: !review.viewerHasVotedHelpful,
                helpfulCount: review.helpfulCount + (review.viewerHasVotedHelpful ? -1 : 1),
              }
            : review,
        ),
      );
      return { snapshots };
    },
    onError: (_error, _reviewId, context) => {
      context?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data);
      });
    },
    onSuccess: (result, reviewId) => {
      queryClient.setQueriesData({ predicate: isReviewListQuery }, (old) =>
        mapReviewsInCache(old, (review) =>
          review.id === reviewId
            ? {
                ...review,
                viewerHasVotedHelpful: result.viewerHasVotedHelpful,
                helpfulCount: result.helpfulCount,
              }
            : review,
        ),
      );
    },
  });
}

export interface ReportReviewInput {
  reviewId: string;
  reason: ReviewReportReason;
  details?: string;
}

export function useReportReview() {
  return useMutation({
    mutationFn: ({ reviewId, reason, details }: ReportReviewInput) =>
      reviewService.reportReview(reviewId, reason, details),
  });
}
