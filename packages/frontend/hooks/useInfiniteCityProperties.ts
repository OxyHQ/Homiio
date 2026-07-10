/**
 * useInfiniteCityProperties — paginated React Query hook for a city's published
 * listings, mirroring {@link usePropertySearch} against
 * `GET /api/cities/:id/properties`.
 *
 * The endpoint returns `{ city, properties, pagination, hasMore, totalPages }`
 * (the flat `hasMore`/`totalPages` aliases were added for parity with
 * `/properties/search`), so `getNextPageParam` reads `hasMore` exactly like the
 * search hook. Filters (verified / eco / bedrooms / bathrooms) and the sort are
 * resolved SERVER-side so pagination stays correct — no client-side re-filtering
 * of already-loaded pages.
 */
import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '@/utils/api';
import type { Property } from '@homiio/shared-types';

/** Per-page size (the city endpoint caps limit server-side). */
const PAGE_SIZE = 24;
/** Results stay fresh for a minute of paging before a refetch. */
const STALE_TIME_MS = 1000 * 60;
/** Cache retention after the query goes inactive. */
const GC_TIME_MS = 1000 * 60 * 10;

/** Sort options the city screen exposes, mapped to the backend `sort` param. */
export type CitySortBy = 'newest' | 'priceAsc' | 'priceDesc';

const CITY_SORT_PARAM: Record<CitySortBy, string> = {
  newest: 'createdAt',
  priceAsc: 'price_asc',
  priceDesc: 'price_desc',
};

/** Server-resolved filters for a city's property list. */
export interface CityPropertyFilters {
  verified?: boolean;
  eco?: boolean;
  minBedrooms?: number;
  minBathrooms?: number;
}

/** Raw response body (post-`normalizeEnvelope`) for the city properties endpoint. */
interface CityPropertiesResponseBody {
  properties?: Property[];
  pagination?: { page: number; limit: number; total: number; pages: number };
  hasMore?: boolean;
  totalPages?: number;
}

/** One page of results plus paging metadata used by `getNextPageParam`. */
interface CityPropertiesPage {
  properties: Property[];
  page: number;
  total: number;
  hasMore: boolean;
}

/** Build the endpoint query params for a page. Pure so the key derives from it. */
function buildCityParams(
  sortBy: CitySortBy,
  filters: CityPropertyFilters,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    limit: PAGE_SIZE,
    sort: CITY_SORT_PARAM[sortBy],
  };
  if (filters.verified) params.verified = 'true';
  if (filters.eco) params.eco = 'true';
  if (typeof filters.minBedrooms === 'number' && filters.minBedrooms > 0) {
    params.minBedrooms = filters.minBedrooms;
  }
  if (typeof filters.minBathrooms === 'number' && filters.minBathrooms > 0) {
    params.minBathrooms = filters.minBathrooms;
  }
  return params;
}

export type CityPropertiesResult = UseInfiniteQueryResult<
  InfiniteData<CityPropertiesPage>,
  Error
> & {
  /** All loaded properties flattened across pages. */
  properties: Property[];
  /** Total match count reported by the server. */
  total: number;
};

export function useInfiniteCityProperties(
  cityId: string | undefined,
  sortBy: CitySortBy,
  filters: CityPropertyFilters = {},
): CityPropertiesResult {
  const baseParams = useMemo(
    () => buildCityParams(sortBy, filters),
    [sortBy, filters.verified, filters.eco, filters.minBedrooms, filters.minBathrooms],
  );
  // `page`/`limit` are excluded from the key (the infinite query owns paging) so
  // all pages of one city+sort+filter set share a cache entry.
  const key = useMemo(
    () => ['cityProperties', cityId ?? '', baseParams] as const,
    [cityId, baseParams],
  );

  const result = useInfiniteQuery({
    queryKey: key,
    initialPageParam: 1,
    enabled: Boolean(cityId),
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    queryFn: async ({ pageParam }): Promise<CityPropertiesPage> => {
      const { data } = await api.get<CityPropertiesResponseBody>(
        `/api/cities/${cityId}/properties`,
        { params: { ...baseParams, page: pageParam }, requireAuth: false },
      );
      return {
        properties: data.properties ?? [],
        page: data.pagination?.page ?? pageParam,
        total: data.pagination?.total ?? (data.properties?.length ?? 0),
        hasMore: data.hasMore ?? false,
      };
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
