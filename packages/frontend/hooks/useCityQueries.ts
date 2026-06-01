/**
 * City TanStack Query hooks.
 *
 * Read-side hooks over the DB-owned relational geo layer (`/api/cities*`). Cities
 * carry their country/region (populated) and a self-hosted cover image
 * (`coverImageId.urls`), so consumers render DB-backed city photos with no
 * external image dependency. Mirrors the shape/conventions of
 * `usePropertyQueries` (stale/gc times, `{ data }` envelope unwrapping).
 */

import { useQuery } from '@tanstack/react-query';
import type { City, CityFilters, CityPropertiesResponse } from '@homiio/shared-types';
import { cityService } from '@/services/cityService';

/** Cities change slowly (seed-time geo + counts), so cache them generously. */
const CITIES_STALE_TIME = 1000 * 60 * 10;
const CITIES_GC_TIME = 1000 * 60 * 60;

/** Stable query-key roots so related caches invalidate together. */
export const cityQueryKeys = {
  all: ['cities'] as const,
  list: (filters: CityFilters) => ['cities', 'list', filters] as const,
  popular: (limit: number, filters: CityFilters) =>
    ['cities', 'popular', { limit, ...filters }] as const,
  byId: (id: string) => ['cities', 'detail', id] as const,
  properties: (id: string, limit: number) =>
    ['cities', 'detail', id, 'properties', { limit }] as const,
};

/** Options accepted when listing a city's properties. */
export interface CityPropertiesOptions {
  limit?: number;
  sort?: string;
}

/**
 * Popular cities (by property count), optionally narrowed to a country/region.
 * Backed by `GET /api/cities/popular`, then filtered client-side by
 * `countryId`/`regionId` when provided (the popular endpoint returns a small,
 * already-ranked set, so a post-filter avoids a second round trip).
 */
export function usePopularCities(limit = 8, filters: CityFilters = {}) {
  return useQuery<City[]>({
    queryKey: cityQueryKeys.popular(limit, filters),
    queryFn: async () => {
      const res = await cityService.getPopularCities(limit);
      const cities = res.data ?? [];
      const countryId = filters.countryId;
      const regionId = filters.regionId;
      if (!countryId && !regionId) return cities;
      return cities.filter((city) => {
        const cityCountryId = typeof city.countryId === 'object'
          ? (city.countryId as { _id?: string })._id
          : city.countryId;
        const cityRegionId = typeof city.regionId === 'object'
          ? (city.regionId as { _id?: string })._id
          : city.regionId;
        if (regionId && cityRegionId !== regionId) return false;
        if (countryId && cityCountryId !== countryId) return false;
        return true;
      });
    },
    staleTime: CITIES_STALE_TIME,
    gcTime: CITIES_GC_TIME,
  });
}

/**
 * A filtered list of cities. Backed by `GET /api/cities` (server-side filtering
 * by `countryId`/`countryCode`/`regionId`/`search`).
 */
export function useCities(filters: CityFilters = {}) {
  return useQuery<City[]>({
    queryKey: cityQueryKeys.list(filters),
    queryFn: async () => {
      const res = await cityService.getCities(filters);
      return res.data ?? [];
    },
    staleTime: CITIES_STALE_TIME,
    gcTime: CITIES_GC_TIME,
  });
}

/**
 * A single city by id, with its populated country/region and cover image.
 * Backed by `GET /api/cities/:id`. Disabled when no id is supplied.
 */
export function useCity(cityId: string | undefined) {
  return useQuery<City | null>({
    queryKey: cityQueryKeys.byId(cityId ?? ''),
    queryFn: async () => {
      if (!cityId) return null;
      const res = await cityService.getCityById(cityId);
      return res.data ?? null;
    },
    enabled: Boolean(cityId),
    staleTime: CITIES_STALE_TIME,
    gcTime: CITIES_GC_TIME,
  });
}

/**
 * Published properties in a city (resolved relationally by `Address.cityId`),
 * each serialized with its resolved geo display names. Backed by
 * `GET /api/cities/:id/properties`. Disabled when no id is supplied.
 */
export function usePropertiesByCity(
  cityId: string | undefined,
  options: CityPropertiesOptions = {},
) {
  const limit = options.limit ?? 50;
  return useQuery<CityPropertiesResponse | null>({
    queryKey: cityQueryKeys.properties(cityId ?? '', limit),
    queryFn: async () => {
      if (!cityId) return null;
      return cityService.getPropertiesByCity(cityId, { limit, sort: options.sort ?? 'createdAt' });
    },
    enabled: Boolean(cityId),
    staleTime: 1000 * 60,
    gcTime: CITIES_GC_TIME,
  });
}
