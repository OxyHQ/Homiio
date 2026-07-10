import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';

import { OfferingType, type PropertyFilters } from '@homiio/shared-types';

import { propertyService } from '@/services/propertyService';
import { getCategoryFilters } from '@/store/getCategoryFilters';
import type { HomeCategory } from '@/store/homeCategoryStore';

/** How many listings the home feed loads (carousel 0–8 + grid 8–16). */
export const HOME_FEED_LIMIT = 16;

export type UserCoordinates = { latitude: number; longitude: number };

export const homeFeedQueryKeys = {
  all: ['homeFeed'] as const,
  feed: (filters: PropertyFilters, blocked: boolean) =>
    ['homeFeed', { filters, blocked }] as const,
  coordinates: ['userCoordinates'] as const,
};

/**
 * `near_you` requires device coordinates. While coordinates are still
 * resolving, or when location is denied/unavailable, the feed query stays
 * disabled and the carousel shows loading or an explicit empty state.
 */
export function isNearYouBlocked(
  category: HomeCategory | null,
  userLocation: UserCoordinates | null | undefined,
  coordsLoading: boolean,
): boolean {
  if (category !== 'near_you') return false;
  return coordsLoading || !userLocation;
}

export function buildHomeFeedFilters(
  offering: OfferingType,
  category: HomeCategory | null,
  userLocation: UserCoordinates | null,
): PropertyFilters {
  return {
    limit: HOME_FEED_LIMIT,
    status: 'published',
    offering,
    ...getCategoryFilters(category, { userLocation, offering }),
  };
}

/** One-shot foreground geolocation for home personalization (nearby cities, near_you). */
export function useUserCoordinates() {
  return useQuery({
    queryKey: homeFeedQueryKeys.coordinates,
    queryFn: async (): Promise<UserCoordinates | null> => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return null;
        const location = await Location.getCurrentPositionAsync({});
        return {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
      } catch {
        return null;
      }
    },
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 1000 * 60 * 60,
    retry: false,
  });
}

export function useHomeFeedProperties(
  offering: OfferingType,
  category: HomeCategory | null,
  userLocation: UserCoordinates | null | undefined,
  coordsLoading: boolean,
) {
  const blocked = isNearYouBlocked(category, userLocation, coordsLoading);
  const filters = buildHomeFeedFilters(offering, category, userLocation ?? null);

  return useQuery({
    queryKey: homeFeedQueryKeys.feed(filters, blocked),
    queryFn: () => propertyService.getProperties(filters),
    enabled: !blocked,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });
}
