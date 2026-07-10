/**
 * Neighborhood TanStack Query hooks.
 *
 * ONE data path: every read delegates to `neighborhoodService`, which hits the
 * public `/api/neighborhoods/*` endpoints. Metrics are derived from Homiio's own
 * listings — there are no mocks, no invented scores, and no local fallbacks. A
 * lookup that resolves nothing returns `null`, which consumers render as hidden.
 */

import { useQuery } from '@tanstack/react-query';
import type { NeighborhoodMetrics } from '@homiio/shared-types';
import { neighborhoodService } from '@/services/neighborhoodService';

/** Neighborhood geo + listing metrics change slowly; cache generously. */
const NEIGHBORHOOD_STALE_TIME = 1000 * 60 * 10;
const NEIGHBORHOOD_GC_TIME = 1000 * 60 * 60;

export interface UseNeighborhoodArgs {
  /** Preferred selector: resolve the neighborhood a property sits in. */
  propertyId?: string;
  /** Fallback selector: resolve by neighborhood name (optionally city-scoped). */
  name?: string;
  /** City id or name, used only with `name`. */
  city?: string;
}

/**
 * Resolve a single neighborhood's metrics. Prefers `propertyId`; otherwise uses
 * `name` (+ optional `city`). Disabled (and returns `undefined`) when neither a
 * property id nor a name is supplied. `null` means "resolved, but no matching
 * neighborhood" — consumers hide the surface in that case.
 */
export function useNeighborhood({ propertyId, name, city }: UseNeighborhoodArgs) {
  const trimmedName = name?.trim();
  const byProperty = Boolean(propertyId);
  const byName = !byProperty && Boolean(trimmedName);

  return useQuery<NeighborhoodMetrics | null>({
    queryKey: byProperty
      ? ['neighborhood', 'by-property', propertyId]
      : ['neighborhood', 'by-name', trimmedName ?? '', city ?? ''],
    queryFn: async () => {
      if (propertyId) return neighborhoodService.getByProperty(propertyId);
      if (trimmedName) return neighborhoodService.getByName(trimmedName, city);
      return null;
    },
    enabled: byProperty || byName,
    staleTime: NEIGHBORHOOD_STALE_TIME,
    gcTime: NEIGHBORHOOD_GC_TIME,
    retry: false,
  });
}

/** A city's neighborhoods ranked by real listing count. */
export function usePopularNeighborhoods(city: string | undefined, limit = 10) {
  return useQuery<NeighborhoodMetrics[]>({
    queryKey: ['neighborhood', 'popular', city ?? '', limit],
    queryFn: async () => (city ? neighborhoodService.getPopular(city, limit) : []),
    enabled: Boolean(city),
    staleTime: NEIGHBORHOOD_STALE_TIME,
    gcTime: NEIGHBORHOOD_GC_TIME,
  });
}
