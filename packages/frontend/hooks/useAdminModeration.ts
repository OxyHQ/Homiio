/**
 * Admin moderation queue hooks (React Query).
 *
 * Page-based `useInfiniteQuery` feeds (mechanics mirror `useEvictionQueries`):
 * the review queue is keyed by its `filter` tab, the eviction queue is a single
 * feed. Mutations invalidate the queue so a moderated row disappears/updates on
 * the next refetch. The reviews query is the admin GATE — the screen inspects
 * its error `status` (403 → not authorised); no client-side role logic here.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import type {
  AdminReviewDTO,
  AdminReviewModerationAction,
  AdminEvictionModerationAction,
  EvictionModerationItem,
} from '@homiio/shared-types';
import {
  adminModerationService,
  type AdminReviewsPage,
  type AdminEvictionsPage,
  type ReviewModerationFilter,
} from '@/services/adminModerationService';

const PAGE_SIZE = 20;
const STALE_TIME = 1000 * 30;

const ROOT_KEY = 'admin-moderation';

export const adminModerationKeys = {
  root: [ROOT_KEY] as const,
  reviews: (filter: ReviewModerationFilter) => [ROOT_KEY, 'reviews', filter] as const,
  evictions: () => [ROOT_KEY, 'evictions'] as const,
};

export type AdminReviewsInfiniteResult = UseInfiniteQueryResult<
  InfiniteData<AdminReviewsPage>,
  Error
> & {
  /** All loaded reviews flattened across pages. */
  reviews: AdminReviewDTO[];
};

/** Paginated review moderation queue for a given filter tab. */
export function useModerationReviews(
  filter: ReviewModerationFilter,
  options: { enabled?: boolean } = {},
): AdminReviewsInfiniteResult {
  const result = useInfiniteQuery<AdminReviewsPage, Error>({
    queryKey: adminModerationKeys.reviews(filter),
    initialPageParam: 1,
    enabled: options.enabled ?? true,
    staleTime: STALE_TIME,
    retry: false,
    queryFn: ({ pageParam }) =>
      adminModerationService.getReviews(filter, pageParam as number, PAGE_SIZE),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const reviews = useMemo<AdminReviewDTO[]>(
    () => result.data?.pages.flatMap((page) => page.reviews) ?? [],
    [result.data],
  );

  return { ...result, reviews };
}

export type AdminEvictionsInfiniteResult = UseInfiniteQueryResult<
  InfiniteData<AdminEvictionsPage>,
  Error
> & {
  /** All loaded queue items flattened across pages. */
  items: EvictionModerationItem[];
};

/** Paginated eviction moderation queue (grouped per reported case). */
export function useModerationEvictions(
  options: { enabled?: boolean } = {},
): AdminEvictionsInfiniteResult {
  const result = useInfiniteQuery<AdminEvictionsPage, Error>({
    queryKey: adminModerationKeys.evictions(),
    initialPageParam: 1,
    enabled: options.enabled ?? true,
    staleTime: STALE_TIME,
    retry: false,
    queryFn: ({ pageParam }) =>
      adminModerationService.getEvictions(pageParam as number, PAGE_SIZE),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const items = useMemo<EvictionModerationItem[]>(
    () => result.data?.pages.flatMap((page) => page.items) ?? [],
    [result.data],
  );

  return { ...result, items };
}

export function useModerateReview(): UseMutationResult<
  AdminReviewDTO,
  Error,
  { reviewId: string; action: AdminReviewModerationAction }
> {
  const queryClient = useQueryClient();
  return useMutation<AdminReviewDTO, Error, { reviewId: string; action: AdminReviewModerationAction }>({
    mutationFn: ({ reviewId, action }) => adminModerationService.moderateReview(reviewId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminModerationKeys.root });
    },
  });
}

export function useModerateEviction(): UseMutationResult<
  void,
  Error,
  { caseId: string; action: AdminEvictionModerationAction }
> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { caseId: string; action: AdminEvictionModerationAction }>({
    mutationFn: ({ caseId, action }) => adminModerationService.moderateEviction(caseId, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminModerationKeys.evictions() });
      // A cancelled case changes the public board too.
      queryClient.invalidateQueries({ queryKey: ['evictions'] });
    },
  });
}
