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

/**
 * How long a device fix may be reused before it is taken again.
 *
 * ADR 0002 §8.3 and §15: a device position lives in memory, for at most five
 * minutes, and is re-taken rather than remembered. It was
 * `staleTime: Number.POSITIVE_INFINITY` with a one-hour `gcTime`, which is two
 * separate problems wearing one value. It kept the person's position for the
 * life of the process even though they had moved; and because the permission
 * was only ever read on the first call, REVOKING location access changed
 * nothing — the cached fix went on scoping their feed until they killed the
 * app. A permission is a decision the user is entitled to change and have
 * honoured, so the fix has to expire for the check to be re-run at all.
 */
const DEVICE_FIX_MAX_AGE_MS = 1000 * 60 * 5;

/**
 * One-shot foreground geolocation for home personalization (nearby cities,
 * near_you).
 *
 * Never written to disk — not AsyncStorage, not SecureStore, not a query-cache
 * persister. `gcTime` matches the max age so an expired fix is dropped rather
 * than lingering as a stale-but-served value.
 */
export function useUserCoordinates() {
  return useQuery({
    queryKey: homeFeedQueryKeys.coordinates,
    queryFn: async (): Promise<UserCoordinates | null> => {
      try {
        // Re-read on every refetch, not once per process: this is the only
        // thing that notices a permission the user has since revoked.
        const { status } = await Location.getForegroundPermissionsAsync();
        const granted =
          status === 'granted'
            ? true
            : (await Location.requestForegroundPermissionsAsync()).status === 'granted';
        if (!granted) return null;
        const location = await Location.getCurrentPositionAsync({});
        return {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
      } catch {
        return null;
      }
    },
    staleTime: DEVICE_FIX_MAX_AGE_MS,
    gcTime: DEVICE_FIX_MAX_AGE_MS,
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
