/**
 * One-shot foreground geolocation.
 *
 * ## What this file used to be, and why almost all of it is gone
 *
 * It was the home feed: a `PropertyFilters` builder, a `near_you` gate, and a
 * `useQuery` against `GET /api/properties`. #353 replaced that surface entirely.
 * Home no longer has a category-driven feed whose geographic lens is one chip
 * among eighteen — it has an explicit scope resolved before anything is fetched
 * (`useLocationScope`) and finite, explainable sections computed under it
 * (`useHomeSections`). Nothing was left for the feed half to do.
 *
 * `useUserCoordinates` survives because `/explore` uses it to BIAS place
 * suggestions towards the reader, which is a different job from scoping a
 * search and one that has no scope ladder behind it. The filename stays for the
 * same reason: renaming it would edit a screen this change does not own.
 */

import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';

export type UserCoordinates = { latitude: number; longitude: number };

export const homeFeedQueryKeys = {
  coordinates: ['userCoordinates'] as const,
};

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
 * The reader's position, for BIASING place suggestions.
 *
 * Never written to disk — not AsyncStorage, not SecureStore, not a query-cache
 * persister. `gcTime` matches the max age so an expired fix is dropped rather
 * than lingering as a stale-but-served value.
 *
 * Note what this is NOT: it is not how Home decides where to look. That is
 * `useLocationScope`, which reads the permission without prompting and ranks the
 * device below every explicit choice. This hook still requests permission,
 * because a suggestion bias is something the caller asks for on purpose.
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
