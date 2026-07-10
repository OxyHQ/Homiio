/**
 * Redfin Stingray API helpers (pure URL building + JSON parsing).
 */

import { stripStingrayPrefix } from '../portals';
import { REDFIN_BASE_URL, type RedfinHomeFixture } from './fixtures';

/** Known Redfin `region_id` values for default US discover cities. */
export const REDFIN_CITY_REGIONS: Readonly<Record<string, { regionId: number; path: string }>> = {
  'austin-tx': { regionId: 30749, path: '/city/30749/TX/Austin' },
  'new-york-ny': { regionId: 42866, path: '/city/42866/NY/New-York' },
  'los-angeles-ca': { regionId: 11203, path: '/city/11203/CA/Los-Angeles' },
  'chicago-il': { regionId: 17426, path: '/city/17426/IL/Chicago' },
  'miami-fl': { regionId: 11458, path: '/city/11458/FL/Miami' },
};

export type RedfinKind = 'rent' | 'sale';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return undefined;
}

function readNestedNumber(value: unknown): number | undefined {
  if (!isRecord(value)) return asNumber(value);
  return asNumber(value.value);
}

function readNestedString(value: unknown): string | undefined {
  if (!isRecord(value)) return asString(value);
  return asString(value.value);
}

function readLatLng(value: unknown): { lat: number; lng: number } | undefined {
  if (!isRecord(value)) return undefined;
  const nested = isRecord(value.value) ? value.value : value;
  const lat = asNumber(nested.latitude);
  const lng = asNumber(nested.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function readPhotoUrls(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.value)) return [];
  const out: string[] = [];
  for (const entry of value.value) {
    if (!isRecord(entry)) continue;
    const url = asString(entry.url);
    if (url) out.push(url);
  }
  return out;
}

function isRentalHome(home: Record<string, unknown>): boolean {
  const sashes = home.sashes;
  if (!Array.isArray(sashes)) return false;
  return sashes.some((entry) => {
    if (!isRecord(entry)) return false;
    const name = asString(entry.sashTypeName);
    return name?.toLowerCase().includes('rental') ?? false;
  });
}

export function redfinWarmUrl(citySlug: string): string {
  const region = REDFIN_CITY_REGIONS[citySlug];
  if (!region) return `${REDFIN_BASE_URL}/`;
  return `${REDFIN_BASE_URL}${region.path}`;
}

export function redfinGisUrl(regionId: number, pageNumber: number, numHomes: number): string {
  const params = new URLSearchParams({
    al: '3',
    include_nearby_homes: 'true',
    mpt: '99',
    num_homes: String(numHomes),
    ord: 'redfin-recommended-asc',
    page_number: String(pageNumber),
    region_id: String(regionId),
    region_type: '6',
    status: '9',
    uipt: '1,2,3,4,5,6,7,8',
    v: '8',
  });
  return `${REDFIN_BASE_URL}/stingray/api/gis?${params.toString()}`;
}

export function redfinInitialInfoUrl(homePath: string): string {
  const path = homePath.startsWith('/') ? homePath.slice(1) : homePath;
  return `${REDFIN_BASE_URL}/stingray/api/home/details/initialInfo?path=${encodeURIComponent(path)}`;
}

export function redfinSourceUrl(homePath: string): string {
  const path = homePath.startsWith('/') ? homePath : `/${homePath}`;
  return `${REDFIN_BASE_URL}${path}`;
}

export function redfinSourceId(propertyId: number): string {
  return String(propertyId);
}

/** Parse one Stingray home row into {@link RedfinHomeFixture}. */
export function parseRedfinHomeNode(home: unknown): RedfinHomeFixture | undefined {
  if (!isRecord(home)) return undefined;
  const propertyId = asNumber(home.propertyId);
  const listingId = asNumber(home.listingId);
  const url = asString(home.url);
  const price = readNestedNumber(home.price);
  const beds = asNumber(home.beds);
  const baths = asNumber(home.baths);
  const sqFt = readNestedNumber(home.sqFt);
  const street = readNestedString(home.streetLine);
  const city = asString(home.city);
  const state = asString(home.state);
  const zip = asString(home.zip);
  const coords = readLatLng(home.latLong);
  if (
    propertyId === undefined ||
    listingId === undefined ||
    !url ||
    price === undefined ||
    beds === undefined ||
    baths === undefined ||
    sqFt === undefined ||
    !street ||
    !city ||
    !state ||
    !zip ||
    !coords
  ) {
    return undefined;
  }
  return {
    propertyId,
    listingId,
    url,
    price,
    beds,
    baths,
    sqFt,
    street,
    city,
    state,
    zip,
    lat: coords.lat,
    lng: coords.lng,
    photoUrls: readPhotoUrls(home.photos),
  };
}

export function redfinKindFromHome(home: Record<string, unknown>): RedfinKind {
  return isRentalHome(home) ? 'rent' : 'sale';
}

export interface RedfinSearchRef {
  sourceId: string;
  url: string;
  kind: RedfinKind;
  homePath: string;
}

/** Parse a Stingray GIS body into listing refs. */
export function parseRedfinGisResponse(body: string): RedfinSearchRef[] {
  const trimmed = stripStingrayPrefix(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.payload) || !Array.isArray(parsed.payload.homes)) return [];
  const out: RedfinSearchRef[] = [];
  for (const entry of parsed.payload.homes) {
    if (!isRecord(entry)) continue;
    const propertyId = asNumber(entry.propertyId);
    const url = asString(entry.url);
    if (propertyId === undefined || !url) continue;
    out.push({
      sourceId: redfinSourceId(propertyId),
      url: redfinSourceUrl(url),
      kind: redfinKindFromHome(entry),
      homePath: url,
    });
  }
  return out;
}

/** Parse initialInfo / GIS single-home payload. */
export function parseRedfinDetailResponse(body: string): RedfinHomeFixture | undefined {
  const trimmed = stripStingrayPrefix(body);
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (isRecord(parsed.payload)) return parseRedfinHomeNode(parsed.payload);
  return parseRedfinHomeNode(parsed);
}

export function isRedfinStingrayChallenge(body: string): boolean {
  const trimmed = stripStingrayPrefix(body);
  if (!trimmed.startsWith('{')) return true;
  try {
    const parsed = JSON.parse(trimmed) as { resultCode?: unknown; errorMessage?: unknown };
    if (typeof parsed.resultCode === 'number' && parsed.resultCode !== 0) return true;
    if (typeof parsed.errorMessage === 'string' && parsed.errorMessage.length > 0) return true;
    return false;
  } catch {
    return true;
  }
}

/** CSS selector for Redfin city search warm-up. */
export const REDFIN_CONTENT_SELECTOR = '#results-display, .HomeCardsContainer, .MapAndListViewSection';
