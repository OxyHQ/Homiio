/**
 * Agency data hooks — profile header, paginated reviews, paginated listings.
 *
 * The two lists are page-based `useInfiniteQuery`s mirroring
 * {@link useInfiniteCityProperties}: `getNextPageParam` reads the flat `hasMore`
 * alias the backend attaches, and the consumer flattens `pages` for rendering.
 * The reviews query key is `['agencyReviews', slug]` so `useToggleHelpful`'s
 * optimistic flip reaches it.
 */
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Property, ReviewDTO } from '@homiio/shared-types';

import {
  reviewService,
  type AgencyProfile,
  type AgencyReviewsPage,
  type AgencyPropertiesPage,
} from '@/services/reviewService';

const STALE_TIME_MS = 1000 * 60;
const GC_TIME_MS = 1000 * 60 * 10;

export function useAgency(slug: string | undefined): UseQueryResult<AgencyProfile, Error> {
  return useQuery<AgencyProfile, Error>({
    queryKey: ['agency', slug ?? ''],
    enabled: Boolean(slug),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: () => reviewService.getAgency(slug ?? ''),
  });
}

export type AgencyReviewsResult = UseInfiniteQueryResult<
  InfiniteData<AgencyReviewsPage>,
  Error
> & {
  /** All loaded reviews flattened across pages. */
  reviews: ReviewDTO[];
};

export function useAgencyReviews(slug: string | undefined): AgencyReviewsResult {
  const result = useInfiniteQuery({
    queryKey: ['agencyReviews', slug ?? ''],
    initialPageParam: 1,
    enabled: Boolean(slug),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: ({ pageParam }) => reviewService.getAgencyReviews(slug ?? '', pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const reviews = useMemo<ReviewDTO[]>(
    () => result.data?.pages.flatMap((page) => page.reviews) ?? [],
    [result.data],
  );

  return { ...result, reviews };
}

export type AgencyPropertiesResult = UseInfiniteQueryResult<
  InfiniteData<AgencyPropertiesPage>,
  Error
> & {
  /** All loaded properties flattened across pages. */
  properties: Property[];
  /** Total match count reported by the server. */
  total: number;
};

export function useAgencyProperties(slug: string | undefined): AgencyPropertiesResult {
  const result = useInfiniteQuery({
    queryKey: ['agencyProperties', slug ?? ''],
    initialPageParam: 1,
    enabled: Boolean(slug),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: ({ pageParam }) => reviewService.getAgencyProperties(slug ?? '', pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const properties = useMemo<Property[]>(
    () => result.data?.pages.flatMap((page) => page.properties) ?? [],
    [result.data],
  );
  const total = result.data?.pages[0]?.total ?? 0;

  return { ...result, properties, total };
}
