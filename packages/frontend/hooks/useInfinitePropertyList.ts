/**
 * useInfinitePropertyList — the shared core behind every paginated property
 * feed (the Airbnb-2026 search and a city's published listings).
 *
 * Both feeds hit a paginated `GET` that returns a batch of {@link Property} plus
 * a `hasMore` flag, page through it with the SAME React Query `useInfiniteQuery`
 * config (page-size cap, stale/gc windows, `hasMore`-driven `getNextPageParam`),
 * and expose the SAME flattened `properties` + server `total` tail. This hook
 * owns all of that once; each feed is a thin adapter that supplies only what
 * differs — the endpoint path, the pre-built params, the cache key, the enabled
 * gate, and a `mapResponse` that shapes the endpoint's body into a page.
 */
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/utils/api';
import type { Property } from '@homiio/shared-types';

/** Hard cap matching the backend `MAX_LIMIT`; both feeds page in this size. */
export const PROPERTY_LIST_PAGE_SIZE = 24;
/** Results stay fresh for a minute of panning/paging before a refetch. */
const STALE_TIME_MS = 1000 * 60;
/** Cache retention after the query goes inactive. */
const GC_TIME_MS = 1000 * 60 * 10;

/**
 * One page of a paginated property feed. Adapters may extend this with extra
 * per-page metadata (e.g. `totalPages`); the core only needs these fields to
 * flatten the list and drive `getNextPageParam`.
 */
export interface PropertyListPage {
  properties: Property[];
  page: number;
  total: number;
  hasMore: boolean;
}

/** The infinite-query result plus the flattened `properties` + server `total`. */
export type PropertyListResult<TPage extends PropertyListPage> =
  UseInfiniteQueryResult<InfiniteData<TPage>, Error> & {
    /** All loaded properties flattened across pages. */
    properties: Property[];
    /** Total match count reported by the server. */
    total: number;
  };

interface UseInfinitePropertyListArgs<TResponse, TPage extends PropertyListPage> {
  /** Cache key for this feed (namespace-first). All pages share one entry. */
  queryKey: readonly unknown[];
  /** Endpoint path fetched for each page. */
  endpoint: string;
  /** Params for a page BEFORE `page` is applied — built once by the adapter. */
  baseParams: Record<string, string | number>;
  /** Shape the raw response body for `pageParam` into a page. */
  mapResponse: (body: TResponse, pageParam: number) => TPage;
  /** Gate execution (e.g. a search panel mid-edit, or a missing city id). */
  enabled: boolean;
}

export function useInfinitePropertyList<TResponse, TPage extends PropertyListPage>({
  queryKey,
  endpoint,
  baseParams,
  mapResponse,
  enabled,
}: UseInfinitePropertyListArgs<TResponse, TPage>): PropertyListResult<TPage> {
  const result = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    enabled,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: async ({ pageParam }): Promise<TPage> => {
      const { data } = await api.get<TResponse>(endpoint, {
        params: { ...baseParams, page: pageParam },
        requireAuth: false,
      });
      return mapResponse(data, pageParam);
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
  });

  const properties = useMemo<Property[]>(
    () => result.data?.pages.flatMap((p) => p.properties) ?? [],
    [result.data],
  );
  const total = result.data?.pages[0]?.total ?? 0;

  return { ...result, properties, total };
}
