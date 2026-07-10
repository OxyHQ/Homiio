/**
 * Leboncoin finder JSON parsers — housing categories 9 (ventes) / 10 (locations) only.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { NonHousingListingError, assertHousingListing } from '../../../parse/classifieds';
import { contactFromUnknown } from '../../../parse/contact';
import {
  LEBONCOIN_BASE_URL,
  LEBONCOIN_HOUSING_CATEGORY_IDS,
} from './fixtures';

export interface LeboncoinRawListing {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: 'EUR';
  city: string;
  postalCode?: string;
  description?: string;
  title?: string;
  propertyType?: string;
  squareMeters?: number;
  bedrooms?: number;
  rooms?: number;
  furnished?: boolean;
  images: string[];
  coordinates?: { lat: number; lng: number };
  categoryId: string;
  categoryName?: string;
  contact?: NormalizedListingContact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function resolveLeboncoinPrice(raw: unknown): number | undefined {
  if (typeof raw === 'number' && raw > 0) return raw;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const n = asNumber(entry);
      if (n !== undefined && n > 0) return n;
    }
  }
  return undefined;
}

function attrMap(attributes: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(attributes)) return map;
  for (const attr of attributes) {
    if (!isRecord(attr)) continue;
    const key = asString(attr.key);
    if (!key) continue;
    const label = asString(attr.value_label) ?? asString(attr.value);
    if (label) map.set(key, label);
  }
  return map;
}

function imagesFromAd(ad: Record<string, unknown>): string[] {
  const images = ad.images;
  if (!isRecord(images)) return [];
  const urls = images.urls_large ?? images.urls;
  if (!Array.isArray(urls)) return [];
  return urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u));
}

function kindFromCategory(categoryId: string): 'rent' | 'sale' {
  return categoryId === '9' ? 'sale' : 'rent';
}

function listingUrl(ad: Record<string, unknown>, sourceId: string, kind: 'rent' | 'sale'): string {
  const url = asString(ad.url);
  if (url && url.startsWith('http')) return url;
  const slug = kind === 'sale' ? 'ventes_immobilieres' : 'locations';
  return `${LEBONCOIN_BASE_URL}/ad/${slug}/${sourceId}`;
}

function listingFromAd(ad: Record<string, unknown>): LeboncoinRawListing | undefined {
  const categoryId = asString(ad.category_id) ?? asString(ad.categoryId);
  if (!categoryId || !LEBONCOIN_HOUSING_CATEGORY_IDS.has(categoryId)) return undefined;

  const sourceId =
    asString(ad.list_id) ??
    (typeof ad.list_id === 'number' ? String(ad.list_id) : undefined) ??
    asString(ad.listId);
  if (!sourceId) return undefined;

  const price = resolveLeboncoinPrice(ad.price);
  if (price === undefined) return undefined;

  const location = isRecord(ad.location) ? ad.location : undefined;
  const city = asString(location?.city) ?? asString(ad.city);
  if (!city) return undefined;

  const kind = kindFromCategory(categoryId);
  const attrs = attrMap(ad.attributes);
  const rooms = asNumber(attrs.get('rooms'));
  const square = asNumber(attrs.get('square'));
  const furnishedRaw = attrs.get('furnished');
  const propertyType = attrs.get('real_estate_type') ?? attrs.get('type');

  const listing: LeboncoinRawListing = {
    sourceId,
    url: listingUrl(ad, sourceId, kind),
    kind,
    price,
    currency: 'EUR',
    city,
    images: imagesFromAd(ad),
    categoryId,
  };

  const postalCode = asString(location?.zipcode) ?? asString(location?.postal_code);
  if (postalCode) listing.postalCode = postalCode;
  const description = asString(ad.body);
  if (description) listing.description = description;
  const title = asString(ad.subject);
  if (title) listing.title = title;
  if (propertyType) listing.propertyType = propertyType;
  if (square !== undefined && square > 0) listing.squareMeters = square;
  if (rooms !== undefined) {
    listing.rooms = rooms;
    listing.bedrooms = Math.max(0, rooms - 1);
  }
  if (furnishedRaw === '1' || /meubl/i.test(furnishedRaw ?? '')) listing.furnished = true;
  if (furnishedRaw === '0') listing.furnished = false;
  const lat = asNumber(location?.lat);
  const lng = asNumber(location?.lng);
  if (lat !== undefined && lng !== undefined) listing.coordinates = { lat, lng };
  const categoryName = asString(ad.category_name);
  if (categoryName) listing.categoryName = categoryName;
  const contact = contactFromUnknown(ad.owner);
  if (contact) listing.contact = contact;

  return listing;
}

export interface LeboncoinSearchRef {
  sourceId: string;
  url: string;
  categoryId: string;
}

/** Parse finder search JSON — drops non-housing categories. */
export function parseLeboncoinSearch(body: string): LeboncoinSearchRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    return [];
  }
  const ads = isRecord(parsed) && Array.isArray(parsed.ads) ? parsed.ads : [];
  const out: LeboncoinSearchRef[] = [];
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
      categoryId: listing.categoryId,
    });
  }
  return out;
}

export function parseLeboncoinDetail(body: string, url: string): LeboncoinRawListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new Error('leboncoin: detail body is not JSON');
  }
  const ad = isRecord(parsed)
    ? isRecord(parsed.ad)
      ? parsed.ad
      : Array.isArray(parsed.ads) && isRecord(parsed.ads[0])
        ? parsed.ads[0]
        : parsed
    : undefined;
  if (!ad) throw new Error('leboncoin: detail JSON missing ad');

  const categoryId = asString(ad.category_id) ?? asString(ad.categoryId) ?? '';
  if (!LEBONCOIN_HOUSING_CATEGORY_IDS.has(categoryId)) {
    const sourceId =
      asString(ad.list_id) ?? (typeof ad.list_id === 'number' ? String(ad.list_id) : 'unknown');
    throw new NonHousingListingError('leboncoin', sourceId, `category ${categoryId}`);
  }

  const listing = listingFromAd(ad);
  if (!listing) throw new Error('leboncoin: detail listing incomplete');
  if (url.startsWith('http')) listing.url = url;

  assertHousingListing('leboncoin', listing.sourceId, {
    category: listing.categoryName ?? listing.categoryId,
    typology: listing.propertyType,
    squareMeters: listing.squareMeters,
    bedrooms: listing.bedrooms,
    hasAddressLike: Boolean(listing.city),
    hasPrice: listing.price > 0,
  });

  return listing;
}

export function leboncoinFinderBody(city: string, categoryId: '9' | '10', offset = 0, limit = 35): string {
  return JSON.stringify({
    filters: {
      category: { id: categoryId },
      enums: { ad_type: ['offer'] },
      location: {
        locations: [{ locationType: 'city', city }],
      },
    },
    limit,
    limit_alu: 0,
    offset,
  });
}

export function leboncoinWarmSearchUrl(city: string, categoryId: '9' | '10' = '10'): string {
  return `${LEBONCOIN_BASE_URL}/recherche?category=${categoryId}&locations=${encodeURIComponent(city)}`;
}

export function leboncoinSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/(?:ad\/(?:locations|ventes_immobilieres)|locations|ventes_immobilieres)\/(\d+)/i);
  return match?.[1];
}
