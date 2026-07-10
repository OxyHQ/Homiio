/**
 * HotPads public JSON API helpers (pure URL building + response parsing).
 */

import { asNumberUs as asNumber, asString, isRecord } from '../../../parse/guards';
import {
  HOTPADS_API_BASE,
  HOTPADS_BASE_URL,
  type HotpadsListingFixture,
} from './fixtures';

export interface HotpadsArea {
  id: string;
  resourceId: string;
  name: string;
  state: string;
  city: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface HotpadsSearchRef {
  sourceId: string;
  url: string;
  lotIdEncoded: string;
}

export function hotpadsAreaUrl(resourceId: string): string {
  return `${HOTPADS_API_BASE}/area/byResourceId?resourceId=${encodeURIComponent(resourceId)}`;
}

export function hotpadsListingsUrl(area: HotpadsArea, limit = 200): string {
  const params = new URLSearchParams({
    areas: area.id,
    minLat: String(area.minLat),
    maxLat: String(area.maxLat),
    minLon: String(area.minLon),
    maxLon: String(area.maxLon),
    searchSlug: 'apartments-for-rent',
    listingTypes: 'rental,room,sublet,corporate',
    propertyTypes: 'condo,divided,garden,house,large,medium,townhouse',
    orderBy: 'score',
    limit: String(limit),
    components: 'basic,useritem,quality,model,photos',
    trimResponse: 'true',
  });
  return `${HOTPADS_API_BASE}/listing/byCoordsV2?${params.toString()}`;
}

export function hotpadsSourceUrl(uriMalone: string): string {
  const path = uriMalone.startsWith('/') ? uriMalone : `/${uriMalone}`;
  return `${HOTPADS_BASE_URL}${path}`;
}

/** Parse area/byResourceId JSON into a {@link HotpadsArea}. */
export function parseHotpadsArea(body: string): HotpadsArea | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.data)) return undefined;
  const d = parsed.data;
  const id = asString(d.id);
  const resourceId = asString(d.resourceId);
  const name = asString(d.name);
  const state = asString(d.state);
  const city = asString(d.city);
  const minLat = asNumber(d.minLat);
  const maxLat = asNumber(d.maxLat);
  const minLon = asNumber(d.minLon);
  const maxLon = asNumber(d.maxLon);
  if (!id || !resourceId || !name || !state || !city) return undefined;
  if (minLat === undefined || maxLat === undefined || minLon === undefined || maxLon === undefined) {
    return undefined;
  }
  return { id, resourceId, name, state, city, minLat, maxLat, minLon, maxLon };
}

function readModelSummary(value: unknown): HotpadsListingFixture['modelSummary'] | undefined {
  if (!isRecord(value)) return undefined;
  const minBeds = asNumber(value.minBeds);
  const maxBeds = asNumber(value.maxBeds);
  const minPrice = asNumber(value.minPrice);
  const maxPrice = asNumber(value.maxPrice);
  const minBaths = asNumber(value.minBaths);
  const maxBaths = asNumber(value.maxBaths);
  const minSqft = asNumber(value.minSqft);
  const maxSqft = asNumber(value.maxSqft);
  if (
    minBeds === undefined ||
    maxBeds === undefined ||
    minPrice === undefined ||
    maxPrice === undefined ||
    minBaths === undefined ||
    maxBaths === undefined ||
    minSqft === undefined ||
    maxSqft === undefined
  ) {
    return undefined;
  }
  return { minBeds, maxBeds, minPrice, maxPrice, minBaths, maxBaths, minSqft, maxSqft };
}

function readListingNode(
  listing: Record<string, unknown>,
  lotIdEncoded: string,
  buildingGeo?: Record<string, unknown>,
): HotpadsListingFixture | undefined {
  const aliasEncoded = asString(listing.aliasEncoded);
  const uriMalone = asString(listing.uriMalone);
  const title = asString(listing.title);
  const propertyType = asString(listing.propertyType);
  const listingType = asString(listing.listingType);
  const addressRaw = isRecord(listing.address) ? listing.address : null;
  const geoRaw = isRecord(listing.geo) ? listing.geo : buildingGeo;
  const modelSummary = readModelSummary(listing.modelSummary);
  if (!aliasEncoded || !uriMalone || !title || !propertyType || !listingType || !addressRaw || !geoRaw || !modelSummary) {
    return undefined;
  }
  const street = asString(addressRaw.street);
  const city = asString(addressRaw.city);
  const state = asString(addressRaw.state);
  const zip = asString(addressRaw.zip);
  const lat = asNumber(geoRaw.lat);
  const lon = asNumber(geoRaw.lon);
  if (!street || !city || !state || !zip || lat === undefined || lon === undefined) return undefined;

  const medPhotoUrl = asString(listing.medPhotoUrl) ?? '';
  const medPhotoUrls: string[] = [];
  if (Array.isArray(listing.medPhotoUrls)) {
    for (const entry of listing.medPhotoUrls) {
      const url = asString(entry);
      if (url) medPhotoUrls.push(url);
    }
  }

  return {
    aliasEncoded,
    lotIdEncoded,
    uriMalone,
    title,
    propertyType,
    listingType,
    address: { street, city, state, zip },
    geo: { lat, lon },
    modelSummary,
    medPhotoUrl,
    medPhotoUrls,
  };
}

/** Parse byCoordsV2 JSON into listing refs. */
export function parseHotpadsSearch(body: string): HotpadsSearchRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !Array.isArray(parsed.data.buildings)) return [];
  const out: HotpadsSearchRef[] = [];
  for (const building of parsed.data.buildings) {
    if (!isRecord(building)) continue;
    const lotIdEncoded = asString(building.lotIdEncoded) ?? '';
    const buildingGeo = isRecord(building.geo) ? building.geo : undefined;
    const listings = building.listings;
    if (!Array.isArray(listings)) continue;
    for (const entry of listings) {
      if (!isRecord(entry)) continue;
      const listing = readListingNode(entry, lotIdEncoded, buildingGeo);
      if (!listing) continue;
      out.push({
        sourceId: listing.aliasEncoded,
        url: hotpadsSourceUrl(listing.uriMalone),
        lotIdEncoded: listing.lotIdEncoded,
      });
    }
  }
  return out;
}

/** Find one listing node in a byCoordsV2 body by alias/source id. */
export function parseHotpadsListingById(body: string, sourceId: string): HotpadsListingFixture | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed.data) || !Array.isArray(parsed.data.buildings)) return undefined;
  for (const building of parsed.data.buildings) {
    if (!isRecord(building)) continue;
    const lotIdEncoded = asString(building.lotIdEncoded) ?? '';
    const buildingGeo = isRecord(building.geo) ? building.geo : undefined;
    const listings = building.listings;
    if (!Array.isArray(listings)) continue;
    for (const entry of listings) {
      if (!isRecord(entry)) continue;
      const listing = readListingNode(entry, lotIdEncoded, buildingGeo);
      if (listing?.aliasEncoded === sourceId) return listing;
    }
  }
  return undefined;
}

export function isHotpadsApiChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  try {
    const parsed = JSON.parse(trimmed) as { success?: unknown; status?: unknown };
    if (parsed.success === false) return true;
    if (typeof parsed.status === 'string' && parsed.status !== 'OK') return true;
    return false;
  } catch {
    return true;
  }
}
