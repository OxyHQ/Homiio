/**
 * Bien'ici JSON parsers (search + detail). Pure — no network.
 *
 * Portal JSON often redacts `price` to 0 for bot traffic; discover only yields
 * refs when a positive price (scalar or `[min,max]` range) is present. Detail
 * enriches contact / photos; price may be carried via discover hints.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromBieniciRelative } from '../contact';
import { BIENICI_BASE_URL } from './fixtures';
import { asNumber, asString, isRecord } from '../../../parse/guards';

export interface BieniciRawListing {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: 'EUR';
  city: string;
  postalCode?: string;
  street?: string;
  neighborhood?: string;
  description?: string;
  title?: string;
  propertyType?: string;
  surfaceArea?: number;
  roomsQuantity?: number;
  bedroomsQuantity?: number;
  bathroomsQuantity?: number;
  floor?: number;
  furnished?: boolean;
  images: string[];
  coordinates?: { lat: number; lng: number };
  contact?: NormalizedListingContact;
}

/**
 * Resolve a positive EUR price from a scalar or `[min, max]` range.
 * Ranges like `[1, 275000]` (new-build) use the max as the list price.
 */
export function resolveBieniciPrice(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (Array.isArray(raw)) {
    const nums = raw
      .map((entry) => asNumber(entry))
      .filter((n): n is number => n !== undefined && n > 0);
    if (nums.length === 0) return undefined;
    return Math.max(...nums);
  }
  return undefined;
}

export function bieniciDetailUrl(sourceId: string, kind: 'rent' | 'sale'): string {
  const path = kind === 'sale' ? 'achat' : 'location';
  return `${BIENICI_BASE_URL}/annonce/${path}/${encodeURIComponent(sourceId)}`;
}

export function bieniciDetailJsonUrl(sourceId: string): string {
  return `${BIENICI_BASE_URL}/realEstateAd.json?id=${encodeURIComponent(sourceId)}`;
}

/** INSEE codes for default FR discover cities. */
export const BIENICI_CITY_INSEE: Readonly<Record<string, number>> = {
  paris: 75056,
  lyon: 69123,
  marseille: 13055,
  bordeaux: 33063,
  lille: 59350,
  toulouse: 31555,
  nantes: 44109,
};

export function bieniciSearchJsonUrl(city: string, page = 1, perPage = 24): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-');
  const insee = BIENICI_CITY_INSEE[slug] ?? BIENICI_CITY_INSEE.paris;
  const filters = JSON.stringify({
    propertyType: ['flat', 'house', 'loft', 'townhouse'],
    type: ['rent', 'buy'],
  });
  const where = JSON.stringify({ inseeCodes: [insee] });
  const params = new URLSearchParams({
    filters,
    page: String(Math.max(1, page)),
    perPage: String(perPage),
    onTheMarket: 'true',
    order: 'desc',
    sortBy: 'publicationDate',
    where,
  });
  return `${BIENICI_BASE_URL}/realEstateAds.json?${params.toString()}`;
}

export function bieniciWarmSearchUrl(city: string): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-');
  const insee = BIENICI_CITY_INSEE[slug] ?? 75056;
  // Human search path; postal suffix is best-effort for warm-up only.
  const postalHint = String(insee).slice(0, 2).padEnd(5, '0');
  return `${BIENICI_BASE_URL}/recherche/location/${slug}-${postalHint}`;
}

function coordsFromBlur(blur: unknown): { lat: number; lng: number } | undefined {
  if (!isRecord(blur)) return undefined;
  const pos = isRecord(blur.position) ? blur.position : isRecord(blur.centroid) ? blur.centroid : undefined;
  if (!pos) return undefined;
  const lat = asNumber(pos.lat);
  const lng = asNumber(pos.lng) ?? asNumber(pos.lon);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function photoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  const out: string[] = [];
  for (const photo of photos) {
    if (!isRecord(photo)) continue;
    const url = asString(photo.url) ?? asString(photo.photo_url) ?? asString(photo.url_photo);
    if (url && /^https?:\/\//i.test(url)) out.push(url);
  }
  return out;
}

function kindFromAdType(adType: unknown): 'rent' | 'sale' | undefined {
  const raw = asString(adType)?.toLowerCase();
  if (!raw) return undefined;
  if (raw === 'rent' || raw === 'location') return 'rent';
  if (raw === 'buy' || raw === 'sale' || raw === 'achat') return 'sale';
  return undefined;
}

function listingFromAd(
  ad: Record<string, unknown>,
  priceOverride?: number,
): BieniciRawListing | undefined {
  const sourceId = asString(ad.id);
  if (!sourceId) return undefined;
  const kind = kindFromAdType(ad.adType) ?? kindFromAdType(ad.transactionType);
  if (!kind) return undefined;
  const price = priceOverride ?? resolveBieniciPrice(ad.price);
  if (price === undefined) return undefined;
  const city = asString(ad.city);
  if (!city) return undefined;

  const contact = contactFromBieniciRelative(ad.contactRelativeData);
  const contactAddress = isRecord(ad.contactRelativeData)
    ? isRecord(ad.contactRelativeData.address)
      ? ad.contactRelativeData.address
      : undefined
    : undefined;

  const listing: BieniciRawListing = {
    sourceId,
    url: bieniciDetailUrl(sourceId, kind),
    kind,
    price,
    currency: 'EUR',
    city,
    images: photoUrls(ad.photos),
  };

  const postalCode = asString(ad.postalCode) ?? asString(contactAddress?.postalCode);
  if (postalCode) listing.postalCode = postalCode;
  const street = asString(contactAddress?.street);
  if (street) listing.street = street;
  const neighborhood = asString(ad.district) ?? asString(ad.displayDistrictName);
  if (typeof neighborhood === 'string' && neighborhood.length > 0 && neighborhood !== 'true') {
    listing.neighborhood = neighborhood;
  }
  const description = asString(ad.description);
  if (description) listing.description = description;
  const title = asString(ad.title) ?? asString(ad.generatedTitle);
  if (title) listing.title = title;
  const propertyType = asString(ad.propertyType);
  if (propertyType) listing.propertyType = propertyType;
  const surfaceArea = asNumber(ad.surfaceArea);
  if (surfaceArea !== undefined && surfaceArea > 0) listing.surfaceArea = surfaceArea;
  const roomsQuantity = asNumber(ad.roomsQuantity);
  if (roomsQuantity !== undefined) listing.roomsQuantity = roomsQuantity;
  const bedroomsQuantity = asNumber(ad.bedroomsQuantity);
  if (bedroomsQuantity !== undefined) listing.bedroomsQuantity = bedroomsQuantity;
  const bathroomsQuantity = asNumber(ad.bathroomsQuantity);
  if (bathroomsQuantity !== undefined && bathroomsQuantity > 0) {
    listing.bathroomsQuantity = bathroomsQuantity;
  }
  const floor = asNumber(ad.floor);
  if (floor !== undefined) listing.floor = floor;
  if (ad.isFurnished === true) listing.furnished = true;
  if (ad.isFurnished === false) listing.furnished = false;
  const coordinates = coordsFromBlur(ad.blurInfo);
  if (coordinates) listing.coordinates = coordinates;
  if (contact) listing.contact = contact;

  return listing;
}

export interface BieniciSearchRef {
  sourceId: string;
  url: string;
  /** Price from search — detail often redacts it. */
  price: number;
  kind: 'rent' | 'sale';
}

/** Parse search JSON into priced listing refs (skips price-redacted ads). */
export function parseBieniciSearch(body: string): BieniciSearchRef[] {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  const ads = isRecord(parsed) && Array.isArray(parsed.realEstateAds) ? parsed.realEstateAds : [];
  const out: BieniciSearchRef[] = [];
  const seen = new Set<string>();
  for (const entry of ads) {
    if (!isRecord(entry)) continue;
    const listing = listingFromAd(entry);
    if (!listing) continue;
    if (seen.has(listing.sourceId)) continue;
    seen.add(listing.sourceId);
    out.push({
      sourceId: listing.sourceId,
      url: listing.url,
      price: listing.price,
      kind: listing.kind,
    });
  }
  return out;
}

/** Parse detail JSON; optional `priceHint` when the portal redacts detail price. */
export function parseBieniciDetail(
  body: string,
  url: string,
  priceHint?: number,
): BieniciRawListing {
  const trimmed = body.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('bienici: detail body is not JSON');
  }
  const ad = isRecord(parsed)
    ? isRecord(parsed.realEstateAd)
      ? parsed.realEstateAd
      : parsed
    : undefined;
  if (!ad) throw new Error('bienici: detail JSON missing listing object');
  const listing = listingFromAd(ad, priceHint);
  if (!listing) {
    throw new Error('bienici: detail listing has no resolvable price or city');
  }
  if (url.startsWith('http')) listing.url = url;
  return listing;
}

export function bieniciSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/annonce\/(?:location|achat)\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}
