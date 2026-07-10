/**
 * Blueground HTML parser.
 *
 * Blueground retired the unauthenticated `/api/v2/properties` JSON search API.
 * Discovery and detail acquisition now scrape SSR city pages and property detail
 * pages, extracting embedded JSON fields plus OpenGraph metadata.
 */

import type { ExternalListingRef } from '../../types';
import type { BluegroundRawListing, BluegroundRawPhoto } from './fixtures';

const BASE_HOST = 'https://www.theblueground.com';

/** Property detail URLs: `/p/furnished-apartments/<city>-<id>p`. */
const DETAIL_URL_RE =
  /https?:\/\/(?:www\.)?theblueground\.com\/p\/furnished-apartments\/[a-z0-9-]+/gi;

/** Map Blueground `cityCode` tokens to a display city + country metadata. */
const CITY_CODE_LOOKUP: Readonly<
  Record<string, { city: string; country?: string; countryCode: string; region?: string }>
> = {
  MAD: { city: 'Madrid', country: 'Spain', countryCode: 'ES', region: 'Community of Madrid' },
  BCN: { city: 'Barcelona', country: 'Spain', countryCode: 'ES', region: 'Catalonia' },
  NYC: { city: 'New York', country: 'United States', countryCode: 'US', region: 'New York' },
  LAX: { city: 'Los Angeles', country: 'United States', countryCode: 'US', region: 'California' },
  BOS: { city: 'Boston', country: 'United States', countryCode: 'US', region: 'Massachusetts' },
  CHI: { city: 'Chicago', country: 'United States', countryCode: 'US', region: 'Illinois' },
  WDC: { city: 'Washington', country: 'United States', countryCode: 'US', region: 'District of Columbia' },
};

function readMeta(html: string, property: string): string | undefined {
  const match = html.match(new RegExp(`property="${property}" content="([^"]+)"`, 'i'));
  return match?.[1]?.trim() || undefined;
}

function readJsonField(html: string, field: string): string | undefined {
  const match = html.match(new RegExp(`"${field}"\\s*:\\s*("([^"]+)"|(\\d+))`));
  if (!match) return undefined;
  return match[2] ?? match[3];
}

function readPhotos(html: string): BluegroundRawPhoto[] {
  const urls = [
    ...new Set(
      [...html.matchAll(/https:\/\/photos2\.theblueground\.com\/[^"'\s<>]+/g)].map((m) => m[0]),
    ),
  ];
  return urls.map((url, index) => ({
    url,
    isCover: index === 0,
  }));
}

/** Derive a stable source id from a detail URL's final slug segment. */
export function bluegroundSourceIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? url;
}

/** Extract property detail refs from a city search page's HTML. */
export function parseBluegroundSearch(html: string): ExternalListingRef[] {
  const bySlug = new Map<string, ExternalListingRef>();
  for (const match of html.matchAll(DETAIL_URL_RE)) {
    const url = match[0].replace(/\/?$/, '');
    const sourceId = bluegroundSourceIdFromUrl(url);
    if (bySlug.has(sourceId)) continue;
    bySlug.set(sourceId, { provider: 'blueground', sourceId, url });
  }
  return [...bySlug.values()];
}

function parseOgTitle(title: string | undefined): { street?: string; neighborhood?: string; city?: string } {
  if (!title) return {};
  const dashSplit = title.split(' - ');
  const street = dashSplit[0]?.trim();
  const locationPart = dashSplit[1]?.replace(/\s*\|\s*Blueground.*$/i, '').trim();
  if (!locationPart) return { street };
  const inMatch = locationPart.match(/in\s+(.+)$/i);
  if (!inMatch) return { street };
  const parts = inMatch[1].split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { street, neighborhood: parts[0], city: parts[parts.length - 1] };
  }
  return { street, city: parts[0] };
}

/** Parse a property detail page into the provider raw payload. */
export function parseBluegroundDetail(html: string, ref: ExternalListingRef): BluegroundRawListing {
  const amountRaw = readJsonField(html, 'amount');
  const amount = amountRaw ? Number.parseInt(amountRaw, 10) : Number.NaN;
  const currency = readJsonField(html, 'currency') ?? 'USD';
  const cityCode = readJsonField(html, 'cityCode')?.toUpperCase();
  const cityMeta = cityCode ? CITY_CODE_LOOKUP[cityCode] : undefined;
  const ogTitle = readMeta(html, 'og:title');
  const ogLocation = parseOgTitle(ogTitle);
  const photos = readPhotos(html);

  if (!Number.isFinite(amount) || photos.length === 0) {
    throw new Error(`blueground: insufficient detail data at ${ref.url}`);
  }

  const bedrooms = readJsonField(html, 'bedrooms');
  const bathrooms = readJsonField(html, 'bathrooms');
  const sizeSqm = readJsonField(html, 'sizeSqm');
  const description = readMeta(html, 'og:description') ?? readJsonField(html, 'description');

  return {
    id: ref.sourceId,
    slug: ref.sourceId,
    url: readMeta(html, 'og:url') ?? ref.url,
    title: ogTitle,
    description,
    propertyType: readJsonField(html, 'propertyType') ?? 'apartment',
    monthlyRent: { amount, currency },
    bedrooms: bedrooms ? Number.parseInt(bedrooms, 10) : undefined,
    bathrooms: bathrooms ? Number.parseInt(bathrooms, 10) : undefined,
    sizeSqm: sizeSqm ? Number.parseInt(sizeSqm, 10) : undefined,
    furnished: true,
    amenities: [],
    address: {
      line1: ogLocation.street,
      neighborhood: ogLocation.neighborhood,
      city: ogLocation.city ?? cityMeta?.city ?? '',
      region: cityMeta?.region,
      country: cityMeta?.country,
      countryCode: cityMeta?.countryCode,
    },
    photos,
  };
}

/** Build the SSR city search page URL for a Blueground city slug. */
export function bluegroundCitySearchUrl(citySlug: string): string {
  return `${BASE_HOST}/m/furnished-apartments/${citySlug}`;
}
