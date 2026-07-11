/**
 * Review-explore hooks — cities → neighborhoods → buildings.
 *
 * Cities and neighborhoods are flat lists (`useQuery`); the building list is
 * page-based (`useInfiniteQuery`, `getNextPageParam` reads the flat `hasMore`
 * alias) mirroring {@link useInfiniteCityProperties}. The consumer flattens
 * `pages` for rendering + wires the shared infinite-scroll primitives.
 */
import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import type {
  ExploreCitySummary,
  ExploreNeighborhoodSummary,
  ExploreBuildingSummary,
} from '@homiio/shared-types';

import { reviewService, type ExploreBuildingsPage } from '@/services/reviewService';

const STALE_TIME_MS = 1000 * 60 * 2;
const GC_TIME_MS = 1000 * 60 * 10;

export function useExploreCities(): UseQueryResult<ExploreCitySummary[], Error> {
  return useQuery<ExploreCitySummary[], Error>({
    queryKey: ['exploreCities'],
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: () => reviewService.getExploreCities(),
  });
}

export function useExploreCity(
  cityId: string | undefined,
): UseQueryResult<ExploreNeighborhoodSummary[], Error> {
  return useQuery<ExploreNeighborhoodSummary[], Error>({
    queryKey: ['exploreCity', cityId ?? ''],
    enabled: Boolean(cityId),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: () => reviewService.getExploreCity(cityId ?? ''),
  });
}

export type ExploreNeighborhoodResult = UseInfiniteQueryResult<
  InfiniteData<ExploreBuildingsPage>,
  Error
> & {
  /** All loaded buildings flattened across pages. */
  buildings: ExploreBuildingSummary[];
};

export function useExploreNeighborhood(
  neighborhoodId: string | undefined,
): ExploreNeighborhoodResult {
  const result = useInfiniteQuery({
    queryKey: ['exploreNeighborhood', neighborhoodId ?? ''],
    initialPageParam: 1,
    enabled: Boolean(neighborhoodId),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: ({ pageParam }) =>
      reviewService.getExploreNeighborhood(neighborhoodId ?? '', pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.page + 1 : undefined),
  });

  const buildings = useMemo<ExploreBuildingSummary[]>(
    () => result.data?.pages.flatMap((page) => page.buildings) ?? [],
    [result.data],
  );

  return { ...result, buildings };
}
