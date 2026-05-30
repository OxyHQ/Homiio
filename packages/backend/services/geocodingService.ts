/**
 * Geocoding Service
 *
 * Forward and reverse geocoding backed by Nominatim (OpenStreetMap).
 * Nominatim is free and requires no API key, but the OSM usage policy
 * mandates a descriptive, identifying User-Agent on every request and a
 * low request rate. We therefore:
 *   - send the configured User-Agent (and Referer) on every call, and
 *   - cache results in-memory to avoid hammering the public endpoint.
 *
 * @see https://operations.osmfoundation.org/policies/nominatim/
 */

import config from '../config';

/** Longitude/latitude bounds, GeoJSON-style [west, south, east, north]. */
export type BoundingBox = [number, number, number, number];

export interface AddressData {
  street?: string;
  houseNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  fullAddress?: string;
  /** [longitude, latitude], GeoJSON order. Populated by forward geocoding. */
  coordinates?: [number, number];
  /** [west, south, east, north]. Populated by forward geocoding when available. */
  bbox?: BoundingBox;
}

export interface GeocodingResult {
  success: boolean;
  data?: AddressData;
  error?: string;
}

/** Subset of Nominatim's structured `address` object that we consume. */
interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  footway?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  quarter?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  state?: string;
  region?: string;
  country?: string;
  postcode?: string;
}

/** Shape of a Nominatim feature as returned by `format=jsonv2`. */
interface NominatimPlace {
  lat: string;
  lon: string;
  display_name?: string;
  /** Nominatim order is [south, north, west, east] as strings. */
  boundingbox?: [string, string, string, string];
  address?: NominatimAddress;
  error?: string;
}

const COORD_BOUNDS = {
  minLongitude: -180,
  maxLongitude: 180,
  minLatitude: -90,
  maxLatitude: 90,
} as const;

const CACHE = {
  maxEntries: 500,
  ttlMs: 24 * 60 * 60 * 1000, // 24h — addresses for a coordinate are stable.
} as const;

interface CacheEntry {
  result: GeocodingResult;
  expiresAt: number;
}

const geocodeCache = new Map<string, CacheEntry>();

const readCache = (key: string): GeocodingResult | null => {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    geocodeCache.delete(key);
    return null;
  }
  return entry.result;
};

const writeCache = (key: string, result: GeocodingResult): void => {
  // Only cache successful lookups; failures may be transient (rate limits,
  // network) and should be retried on the next request.
  if (!result.success) return;
  if (geocodeCache.size >= CACHE.maxEntries) {
    const oldestKey = geocodeCache.keys().next().value;
    if (oldestKey !== undefined) geocodeCache.delete(oldestKey);
  }
  geocodeCache.set(key, { result, expiresAt: Date.now() + CACHE.ttlMs });
};

const nominatimHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'User-Agent': config.geocoding.userAgent,
    Accept: 'application/json',
  };
  if (config.geocoding.referer) headers.Referer = config.geocoding.referer;
  return headers;
};

/** Map a Nominatim place onto our flat AddressData DTO. */
const toAddressData = (place: NominatimPlace): AddressData => {
  const address = place.address ?? {};
  const longitude = parseFloat(place.lon);
  const latitude = parseFloat(place.lat);

  const data: AddressData = {
    street: address.road || address.pedestrian || address.footway || '',
    houseNumber: address.house_number || '',
    neighborhood: address.neighbourhood || address.suburb || address.quarter || '',
    city: address.city || address.town || address.village || address.municipality || '',
    state: address.state || address.region || '',
    country: address.country || '',
    postalCode: address.postcode || '',
    fullAddress: place.display_name || '',
  };

  if (!Number.isNaN(longitude) && !Number.isNaN(latitude)) {
    data.coordinates = [longitude, latitude];
  }

  // Nominatim boundingbox is [south, north, west, east]; convert to the
  // GeoJSON-style [west, south, east, north] order the frontend expects.
  const bb = place.boundingbox;
  if (bb && bb.length === 4) {
    const south = parseFloat(bb[0]);
    const north = parseFloat(bb[1]);
    const west = parseFloat(bb[2]);
    const east = parseFloat(bb[3]);
    if (![south, north, west, east].some(Number.isNaN)) {
      data.bbox = [west, south, east, north];
    }
  }

  return data;
};

/**
 * Reverse geocode coordinates to an address.
 * @param longitude - Longitude coordinate ([-180, 180])
 * @param latitude - Latitude coordinate ([-90, 90])
 */
export async function reverseGeocode(longitude: number, latitude: number): Promise<GeocodingResult> {
  if (
    longitude < COORD_BOUNDS.minLongitude ||
    longitude > COORD_BOUNDS.maxLongitude ||
    latitude < COORD_BOUNDS.minLatitude ||
    latitude > COORD_BOUNDS.maxLatitude
  ) {
    return { success: false, error: 'Invalid coordinates provided' };
  }

  const cacheKey = `reverse:${longitude.toFixed(6)},${latitude.toFixed(6)}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL('/reverse', config.geocoding.nominatimBaseUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('addressdetails', '1');

    const response = await fetch(url.toString(), { headers: nominatimHeaders() });
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`);
    }

    const place = (await response.json()) as NominatimPlace;
    if (place.error || !place.lat || !place.lon) {
      return { success: false, error: 'No address found for the provided coordinates' };
    }

    const result: GeocodingResult = { success: true, data: toAddressData(place) };
    writeCache(cacheKey, result);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Geocoding failed',
    };
  }
}

/**
 * Forward geocode an address string to coordinates + structured address.
 * @param address - Address string to geocode
 */
export async function forwardGeocode(address: string): Promise<GeocodingResult> {
  const query = address?.trim();
  if (!query) {
    return { success: false, error: 'Address is required' };
  }

  const cacheKey = `forward:${query.toLowerCase()}`;
  const cached = readCache(cacheKey);
  if (cached) return cached;

  try {
    const url = new URL('/search', config.geocoding.nominatimBaseUrl);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('q', query);
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('limit', '1');

    const response = await fetch(url.toString(), { headers: nominatimHeaders() });
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`);
    }

    const places = (await response.json()) as NominatimPlace[];
    const place = Array.isArray(places) ? places[0] : undefined;
    if (!place) {
      return { success: false, error: 'No coordinates found for the provided address' };
    }

    const result: GeocodingResult = { success: true, data: toAddressData(place) };
    writeCache(cacheKey, result);
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Geocoding failed',
    };
  }
}

export default {
  reverseGeocode,
  forwardGeocode,
};
