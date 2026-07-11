/**
 * Blueground HTML parser.
 *
 * Blueground retired the unauthenticated `/api/v2/properties` JSON search API.
 * Discovery and detail acquisition now scrape SSR city pages and property detail
 * pages, extracting embedded JSON fields plus OpenGraph metadata.
 *
 * Partner-network inventory (`businessModel: PARTNERS_NETWORK` / `partnerSlug`)
 * does not expose a trustworthy firm monthly rent — Blueground UI says "add
 * dates to see prices" and embedded `lowestRent` is unreliable. Those listings
 * are skipped rather than published with a misleading monthlyAmount.
 */

import type { ExternalListingRef } from '../../types';
import { asRecord, asString } from '../../parse/guards';
import { extractBalancedJsonAfter } from '../../parse/nextData';
import type { BluegroundRawListing, BluegroundRawPhoto } from './fixtures';

const BASE_HOST = 'https://www.theblueground.com';

/** Property detail URLs: `/p/furnished-apartments/<city>-<id>p`. */
const DETAIL_URL_RE =
  /https?:\/\/(?:www\.)?theblueground\.com\/p\/furnished-apartments\/[a-z0-9-]+/gi;

/** Explicit lowestRent object — never a bare first `"amount"` match. */
const LOWEST_RENT_RE =
  /"lowestRent"\s*:\s*\{\s*"amount"\s*:\s*(\d+)\s*,\s*"currency"\s*:\s*"([A-Z]{3})"/i;

const BUSINESS_MODEL_RE = /"businessModel"\s*:\s*"([^"]+)"/;
const PARTNER_SLUG_RE = /"partnerSlug"\s*:\s*"([^"]*)"/;
/** Property inventory source (not photo/CDN source fields). */
const PROPERTY_SOURCE_RE = /"source"\s*:\s*"(partner_network)"/;

/** Map Blueground `cityCode` tokens to a display city + country metadata. */
const CITY_CODE_LOOKUP: Readonly<
  Record<string, { city: string; country?: string; countryCode: string; region?: string }>
> = {
  MAD: { city: 'Madrid', country: 'Spain', countryCode: 'ES', region: 'Community of Madrid' },
  BCN: { city: 'Barcelona', country: 'Spain', countryCode: 'ES', region: 'Catalonia' },
  VLC: { city: 'Valencia', country: 'Spain', countryCode: 'ES', region: 'Valencia' },
  SVQ: { city: 'Seville', country: 'Spain', countryCode: 'ES', region: 'Andalusia' },
  NYC: { city: 'New York', country: 'United States', countryCode: 'US', region: 'New York' },
  LAX: { city: 'Los Angeles', country: 'United States', countryCode: 'US', region: 'California' },
  BOS: { city: 'Boston', country: 'United States', countryCode: 'US', region: 'Massachusetts' },
  CHI: { city: 'Chicago', country: 'United States', countryCode: 'US', region: 'Illinois' },
  WDC: { city: 'Washington', country: 'United States', countryCode: 'US', region: 'District of Columbia' },
  MIA: { city: 'Miami', country: 'United States', countryCode: 'US', region: 'Florida' },
  SFO: { city: 'San Francisco', country: 'United States', countryCode: 'US', region: 'California' },
  ROM: { city: 'Rome', country: 'Italy', countryCode: 'IT', region: 'Lazio' },
  MIL: { city: 'Milan', country: 'Italy', countryCode: 'IT', region: 'Lombardy' },
  LON: { city: 'London', country: 'United Kingdom', countryCode: 'GB', region: 'England' },
  BER: { city: 'Berlin', country: 'Germany', countryCode: 'DE', region: 'Berlin' },
  PAR: { city: 'Paris', country: 'France', countryCode: 'FR', region: 'Île-de-France' },
};

/** Raised when a Blueground listing is partner inventory without a firm monthly rent. */
export class BluegroundPartnerListingError extends Error {
  constructor(
    readonly sourceId: string,
    readonly reason: string,
  ) {
    super(`blueground: skipping partner listing ${sourceId}: ${reason}`);
    this.name = 'BluegroundPartnerListingError';
  }
}

function readMeta(html: string, property: string): string | undefined {
  const match = html.match(new RegExp(`property="${property}" content="([^"]+)"`, 'i'));
  return match?.[1]?.trim() || undefined;
}

function readJsonField(html: string, field: string): string | undefined {
  const match = html.match(new RegExp(`"${field}"\\s*:\\s*("([^"]+)"|(\\d+))`));
  if (!match) return undefined;
  return match[2] ?? match[3];
}

/** Read the embedded `lowestRent` object only — never the first bare `"amount"`. */
export function readBluegroundLowestRent(
  html: string,
): { amount: number; currency: string } | undefined {
  const match = html.match(LOWEST_RENT_RE);
  if (!match?.[1] || !match[2]) return undefined;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  return { amount, currency: match[2].toUpperCase() };
}

export interface BluegroundPartnerSignals {
  businessModel?: string;
  partnerSlug?: string;
  propertySource?: string;
}

/** Extract partner / inventory signals from detail HTML. */
export function readBluegroundPartnerSignals(html: string): BluegroundPartnerSignals {
  const businessModel = html.match(BUSINESS_MODEL_RE)?.[1];
  const partnerSlug = html.match(PARTNER_SLUG_RE)?.[1];
  const propertySource = html.match(PROPERTY_SOURCE_RE)?.[1];
  return {
    businessModel: businessModel || undefined,
    partnerSlug: partnerSlug || undefined,
    propertySource: propertySource || undefined,
  };
}

/**
 * Partner-network inventory: dates required for price; `lowestRent` is not a
 * firm monthly quote. Skip rather than publish a misleading monthlyAmount.
 */
export function isBluegroundPartnerListing(signals: BluegroundPartnerSignals): boolean {
  if (signals.businessModel === 'PARTNERS_NETWORK') return true;
  if (signals.propertySource === 'partner_network') return true;
  if (signals.partnerSlug && signals.partnerSlug.trim().length > 0) return true;
  return false;
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

/**
 * Blueground exposes in-unit/building amenities as an object keyed by category
 * (`apartment`, `building`, `blueground`, `important`, `main`, plus
 * `struckthrough*`). Each entry carries a language-independent camelCase `key`
 * (`airConditioning`, `elevatorInTheBuilding`, …) alongside an i18n `caption`.
 * We normalize the stable `key` — never the localized caption — so extraction is
 * market-agnostic.
 *
 * Only the handful of keys whose generic slug would diverge from the canonical
 * vocabulary the ingest/search read (`elevator`, `parking`, `terrace`,
 * `washer`, `air_conditioning`) are aliased; everything else is slugified
 * generically. This is Blueground's OWN camelCase vocabulary, not a duplicate of
 * the shared ES/IT free-text amenity table in `parse/jsonLd.ts`.
 */
const BLUEGROUND_AMENITY_ALIASES: Readonly<Record<string, string>> = {
  airConditioning: 'air_conditioning',
  elevatorInTheBuilding: 'elevator',
  parkingSpace: 'parking',
  terracePrivate: 'terrace',
  laundryRoomUnit: 'washer',
  washerUnit: 'washer',
};

/** Categories that list amenities the unit does NOT have (struck through in UI). */
const BLUEGROUND_STRUCKTHROUGH_PREFIX = 'struckthrough';
/** Category holding structured facts (bedrooms/bathrooms/lotSize/floor), not amenities. */
const BLUEGROUND_FACTS_CATEGORY = 'main';
const BLUEGROUND_FLOOR_KEY = 'floor';

/** Canonicalize a Blueground amenity `key`; unknown keys → generic snake_case slug. */
function bluegroundAmenitySlug(key: string): string {
  const alias = BLUEGROUND_AMENITY_ALIASES[key];
  if (alias) return alias;
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Read the `main.floor` structured value (string like `"2"` or a number). */
function readBluegroundFloor(entries: readonly unknown[]): number | undefined {
  for (const entry of entries) {
    const record = asRecord(entry);
    if (asString(record?.['key']) !== BLUEGROUND_FLOOR_KEY) continue;
    const value = record?.['value'];
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number.parseInt(value, 10)
          : Number.NaN;
    if (Number.isInteger(numeric)) return numeric;
  }
  return undefined;
}

/**
 * Extract available in-unit/building amenities (as canonical slugs) plus the
 * building floor from a detail page's embedded `"amenities":{…}` object.
 * Struck-through (unavailable) amenities are excluded; the `main` facts block
 * contributes only the floor. Missing/malformed data degrades to `{ amenities: [] }`.
 */
export function readBluegroundAmenities(html: string): { amenities: string[]; floor?: number } {
  const body = extractBalancedJsonAfter(html, '"amenities":');
  if (!body) return { amenities: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { amenities: [] };
  }

  const categories = asRecord(parsed);
  if (!categories) return { amenities: [] };

  const amenities = new Set<string>();
  let floor: number | undefined;

  for (const [category, entries] of Object.entries(categories)) {
    if (!Array.isArray(entries)) continue;
    if (category.startsWith(BLUEGROUND_STRUCKTHROUGH_PREFIX)) continue;
    if (category === BLUEGROUND_FACTS_CATEGORY) {
      floor = floor ?? readBluegroundFloor(entries);
      continue;
    }
    for (const entry of entries) {
      const key = asString(asRecord(entry)?.['key']);
      if (!key) continue;
      const slug = bluegroundAmenitySlug(key);
      if (slug) amenities.add(slug);
    }
  }

  return { amenities: [...amenities], floor };
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
  const partnerSignals = readBluegroundPartnerSignals(html);
  if (isBluegroundPartnerListing(partnerSignals)) {
    const label =
      partnerSignals.partnerSlug?.trim() ||
      partnerSignals.businessModel ||
      partnerSignals.propertySource ||
      'partner';
    throw new BluegroundPartnerListingError(
      ref.sourceId,
      `unreliable lowestRent for ${label} (dates required for price)`,
    );
  }

  const lowestRent = readBluegroundLowestRent(html);
  if (!lowestRent) {
    throw new Error(`blueground: missing lowestRent at ${ref.url}`);
  }

  const cityCode = readJsonField(html, 'cityCode')?.toUpperCase();
  const cityMeta = cityCode ? CITY_CODE_LOOKUP[cityCode] : undefined;
  const ogTitle = readMeta(html, 'og:title');
  const ogLocation = parseOgTitle(ogTitle);
  const photos = readPhotos(html);

  if (photos.length === 0) {
    throw new Error(`blueground: insufficient detail data at ${ref.url}`);
  }

  const bedrooms = readJsonField(html, 'bedrooms');
  const bathrooms = readJsonField(html, 'bathrooms');
  const sizeSqm = readJsonField(html, 'sizeSqm');
  const description = readMeta(html, 'og:description') ?? readJsonField(html, 'description');
  const { amenities, floor } = readBluegroundAmenities(html);

  const city = ogLocation.city ?? cityMeta?.city ?? '';
  const region =
    cityMeta && city.toLowerCase() === cityMeta.city.toLowerCase() ? cityMeta.region : undefined;

  return {
    id: ref.sourceId,
    slug: ref.sourceId,
    url: readMeta(html, 'og:url') ?? ref.url,
    title: ogTitle,
    description,
    propertyType: readJsonField(html, 'propertyType') ?? 'apartment',
    businessModel: partnerSignals.businessModel,
    partnerSlug: partnerSignals.partnerSlug,
    monthlyRent: { amount: lowestRent.amount, currency: lowestRent.currency },
    bedrooms: bedrooms ? Number.parseInt(bedrooms, 10) : undefined,
    bathrooms: bathrooms ? Number.parseInt(bathrooms, 10) : undefined,
    sizeSqm: sizeSqm ? Number.parseInt(sizeSqm, 10) : undefined,
    floor,
    furnished: true,
    amenities,
    address: {
      line1: ogLocation.street,
      neighborhood: ogLocation.neighborhood,
      city,
      region,
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
