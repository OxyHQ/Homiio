/**
 * Geocoding for Homiio's OWN ingest and address pipeline.
 *
 * This is no longer a geocoder. Since #351 it is a thin projection of the
 * provider layer (`services/geocoding/`) onto the flat {@link GeocodedAddress}
 * shape that `addressService`, `IngestionService`, `scraperService`,
 * `geoResolutionService` and `reviewController` already consume — so there is
 * exactly ONE Nominatim client in the backend, one rate-limit queue honouring
 * the OSM policy, and one cache, whoever is asking.
 *
 * ## Why this returns a result object where the gateway throws
 *
 * The two callers want opposite things and it is worth being explicit, because
 * the difference looks like an inconsistency and is not.
 *
 * The **ingest path** geocodes thousands of listings unattended, and a
 * geocoder failure on one of them must degrade that listing, not abort the
 * batch — so it gets `{ success: false, error }` and decides for itself.
 *
 * The **HTTP gateway** answers a person who is typing, and there a failure
 * must stay a failure all the way to the screen: a timeout that comes back as
 * an empty list is indistinguishable from "there is no such place", which is
 * how a location search silently becomes a global feed. So the gateway
 * propagates the typed error.
 *
 * {@link GeocodedAddress} is the address-FORM and ingest DTO, not the public
 * place one. The public place DTO is `GeoPlace`, built in
 * `services/geocoding/normalize.ts`. The two are not interchangeable: a
 * `GeoPlace` has no street, house number or postal code, because a country does
 * not have them.
 */

import type { GeocodedAddress } from '@homiio/shared-types';

import {
  autocompleteCacheKey,
  GEO_CACHE_TTL_MS,
  readGeoCache,
  reverseCacheKey,
  writeGeoCache,
} from './geocoding/cache';
import { withFallback } from './geocoding/registry';
import { GeocodingProviderError, type ProviderPlace } from './geocoding/types';

/** Longitude/latitude bounds, GeoJSON-style [west, south, east, north]. */
export type BoundingBox = [number, number, number, number];

export interface GeocodingResult {
  success: boolean;
  data?: GeocodedAddress;
  error?: string;
}

/**
 * The ingest pipeline has no reader and therefore no locale: a listing is
 * geocoded once, long before anybody looks at it. Asking for no particular
 * language gets the provider's local default, which is the right canonical
 * name to store. The gateway passes a real tag; these two therefore do not
 * share cache entries, which is correct rather than wasteful — they are asking
 * different questions.
 */
const INGEST_LANGUAGE = '';

/** Project a provider result onto the flat ingest DTO. */
const toGeocodedAddress = (place: ProviderPlace): GeocodedAddress => {
  const data: GeocodedAddress = {
    street: place.address.street ?? '',
    houseNumber: place.address.houseNumber ?? '',
    neighborhood: place.address.neighborhood ?? '',
    city: place.address.city ?? '',
    state: place.address.region ?? '',
    country: place.address.country ?? '',
    postalCode: place.address.postalCode ?? '',
    fullAddress: place.displayName,
    coordinates: [place.center.longitude, place.center.latitude],
  };
  if (place.bounds) {
    const { west, south, east, north } = place.bounds;
    data.bbox = [west, south, east, north];
  }
  return data;
};

/**
 * Turn a provider failure into the soft result this module's callers expect.
 *
 * The message names the reason and never the query or the coordinate, so a
 * caller that logs it cannot leak an address — several of them do log it.
 */
const toFailure = (error: unknown): GeocodingResult => {
  if (error instanceof GeocodingProviderError) {
    return { success: false, error: `Geocoding failed: ${error.reason}` };
  }
  return { success: false, error: 'Geocoding failed' };
};

const COORD_BOUNDS = {
  minLongitude: -180,
  maxLongitude: 180,
  minLatitude: -90,
  maxLatitude: 90,
} as const;

/**
 * Reverse geocode coordinates to an address.
 * @param longitude - Longitude coordinate ([-180, 180])
 * @param latitude - Latitude coordinate ([-90, 90])
 */
export async function reverseGeocode(longitude: number, latitude: number): Promise<GeocodingResult> {
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < COORD_BOUNDS.minLongitude ||
    longitude > COORD_BOUNDS.maxLongitude ||
    latitude < COORD_BOUNDS.minLatitude ||
    latitude > COORD_BOUNDS.maxLatitude
  ) {
    return { success: false, error: 'Invalid coordinates provided' };
  }

  const key = reverseCacheKey(longitude, latitude, INGEST_LANGUAGE);
  const cached = readGeoCache<ProviderPlace>(key);
  if (cached) return { success: true, data: toGeocodedAddress(cached) };

  try {
    const { value } = await withFallback((provider) =>
      provider.reverse({
        point: { longitude, latitude },
        language: INGEST_LANGUAGE,
      }),
    );
    if (!value) {
      return { success: false, error: 'No address found for the provided coordinates' };
    }
    // Only successes are cached. A transient failure cached for 24 hours turns
    // a network blip into an outage that long outlives it.
    writeGeoCache(key, value, GEO_CACHE_TTL_MS.resolved);
    return { success: true, data: toGeocodedAddress(value) };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * Forward geocode an address string to coordinates + structured address.
 *
 * Returns the single best match, which is what an unattended ingest needs. The
 * PUBLIC search endpoint deliberately does the opposite and always returns a
 * list: auto-picking one candidate for a person is how somebody's search ends
 * up in the wrong Barcelona.
 *
 * @param address - Address string to geocode
 */
export async function forwardGeocode(address: string): Promise<GeocodingResult> {
  const query = address?.trim();
  if (!query) {
    return { success: false, error: 'Address is required' };
  }

  const key = autocompleteCacheKey({ query, language: INGEST_LANGUAGE, limit: 1 });
  const cached = readGeoCache<ProviderPlace[]>(key);
  if (cached) {
    const [place] = cached;
    return place
      ? { success: true, data: toGeocodedAddress(place) }
      : { success: false, error: 'No coordinates found for the provided address' };
  }

  try {
    const { value } = await withFallback((provider) =>
      provider.autocomplete({ query, language: INGEST_LANGUAGE, limit: 1 }),
    );
    const [place] = value;
    if (!place) {
      return { success: false, error: 'No coordinates found for the provided address' };
    }
    writeGeoCache(key, value, GEO_CACHE_TTL_MS.resolved);
    return { success: true, data: toGeocodedAddress(place) };
  } catch (error) {
    return toFailure(error);
  }
}

export default {
  reverseGeocode,
  forwardGeocode,
};
