/**
 * City display helpers.
 *
 * The `/api/cities*` endpoints serialize a {@link City} with its `countryId` /
 * `regionId` populated (to `{ name, ... }`) and its `coverImageId` populated to
 * the self-hosted {@link Image} document (`{ urls, ... }`). These helpers read
 * those populated shapes defensively — falling back gracefully when a ref is a
 * bare id (un-populated) — so the home Explore section and the city page render
 * DB-backed photos + names without an external image host.
 */

import type {
  City,
  Country,
  ImageVariantName,
  Region,
} from '@homiio/shared-types';

import { resolveBackendImageUrl } from '@/utils/imageUrl';

/** A ready-to-render image source for `expo-image`, or null when none resolved. */
export type CityImageSource = { uri: string } | null;

/** Whether a value is a populated `{ name }` ref (vs a bare id string). */
function isNamedRef(value: unknown): value is { name: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string'
  );
}

/** The city's populated region, when `regionId` was expanded. */
export function cityRegion(city: City | undefined): Region | undefined {
  if (city && isNamedRef(city.regionId)) return city.regionId as Region;
  return undefined;
}

/** The city's populated country, when `countryId` was expanded. */
export function cityCountry(city: City | undefined): Country | undefined {
  if (city && isNamedRef(city.countryId)) return city.countryId as Country;
  return undefined;
}

/** The city's region NAME, or undefined when un-populated. */
export function cityRegionName(city: City | undefined): string | undefined {
  return cityRegion(city)?.name;
}

/** The city's country NAME, or undefined when un-populated. */
export function cityCountryName(city: City | undefined): string | undefined {
  return cityCountry(city)?.name;
}

/**
 * Resolve a city's cover-image URL for `expo-image`, preferring `variant`
 * (default `large`) and falling back across the available variants. Reads the
 * populated `coverImageId.urls` map; returns null when the cover image is
 * un-populated or has no usable URL (caller renders a gradient fallback).
 */
export function getCityImageSource(
  city: City | undefined,
  variant: ImageVariantName = 'large',
): CityImageSource {
  const cover = city?.coverImageId;
  if (!cover || typeof cover !== 'object' || !('urls' in cover)) return null;
  const urls = cover.urls;
  if (!urls) return null;
  const ordered: ImageVariantName[] = [variant, 'large', 'medium', 'small', 'original'];
  for (const name of ordered) {
    const url = urls[name];
    if (typeof url === 'string' && url.length > 0) {
      // City covers are self-hosted by our backend; re-home the URL onto the
      // active API origin so a baked-in dev/emulator host resolves on web too.
      return { uri: resolveBackendImageUrl(url) };
    }
  }
  return null;
}
