/**
 * Storia.ro JSON parsers (pure, DOM-free).
 *
 * Prefer `__NEXT_DATA__` / GraphQL JSON over HTML card scraping. Contact phones
 * come from `pageProps.contactDetails` via shared {@link buildContact}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { parseNextData, nextDataPageProps } from '../../../nextData';
import { STORIA_BASE_URL } from './fixtures';

const ROOMS_MAP: Readonly<Record<string, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  STUDIO: 0,
};

export interface StoriaSearchRef {
  sourceId: string;
  url: string;
}

export interface StoriaRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  operation: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  floor?: number;
  address: {
    street?: string;
    city: string;
    region?: string;
    neighborhood?: string;
    countryCode: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  contact?: NormalizedListingContact;
  estate?: string;
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
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Extract Storia listing id from a detail URL or slug (`…-IDHQMd` or numeric). */
export function storiaSourceIdFromUrl(url: string): string | undefined {
  const idMatch = /[-/]ID([A-Za-z0-9]+)(?:\/|$|\?)/i.exec(url);
  if (idMatch?.[1]) return `ID${idMatch[1]}`;
  const numeric = /\/oferta\/[^/]*?(\d{5,})(?:\/|$|\?)/.exec(url);
  if (numeric?.[1]) return numeric[1];
  return undefined;
}

function absoluteOfertaUrl(hrefOrSlug: string): string {
  if (hrefOrSlug.startsWith('http')) return hrefOrSlug.split('?')[0] ?? hrefOrSlug;
  const path = hrefOrSlug.startsWith('/') ? hrefOrSlug : `/ro/oferta/${hrefOrSlug}`;
  return `${STORIA_BASE_URL}${path.split('?')[0]}`;
}

function roomsFromValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const asStr = asString(value);
  if (!asStr) return undefined;
  const mapped = ROOMS_MAP[asStr.toUpperCase()];
  if (mapped !== undefined) return mapped;
  return asNumber(asStr);
}

function floorFromAttr(value: unknown): number | undefined {
  const asStr = asString(value);
  if (!asStr) return asNumber(value);
  const match = /floor_?(\d+)/i.exec(asStr) ?? /^(\d+)$/.exec(asStr);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function cityFromLocation(location: unknown): {
  city: string;
  region?: string;
  neighborhood?: string;
  street?: string;
  coordinates?: { lat: number; lng: number };
} {
  if (!isRecord(location)) return { city: 'Romania' };
  const coords = isRecord(location.coordinates)
    ? {
        lat: asNumber(location.coordinates.latitude),
        lng: asNumber(location.coordinates.longitude),
      }
    : undefined;
  const coordinates =
    coords?.lat !== undefined && coords.lng !== undefined
      ? { lat: coords.lat, lng: coords.lng }
      : undefined;

  let city = 'Romania';
  let region: string | undefined;
  let neighborhood: string | undefined;
  const reverse = isRecord(location.reverseGeocoding) ? location.reverseGeocoding : undefined;
  const locations = reverse && Array.isArray(reverse.locations) ? reverse.locations : [];
  for (const entry of locations) {
    if (!isRecord(entry)) continue;
    const level = asString(entry.locationLevel);
    const name = asString(entry.name);
    if (!name) continue;
    if (level === 'county' || level === 'city') city = name.replace(/\s*\(judet\)/i, '').trim();
    if (level === 'sector') region = name;
    if (level === 'district') neighborhood = name;
  }

  const address = isRecord(location.address) ? location.address : undefined;
  const streetObj = address && isRecord(address.street) ? address.street : undefined;
  const streetName = streetObj ? asString(streetObj.name) : undefined;
  const streetNumber = streetObj ? asString(streetObj.number) : undefined;
  const street =
    streetName && streetNumber ? `${streetName} ${streetNumber}` : streetName;

  if (address && isRecord(address.province)) {
    const provinceName = asString(address.province.name);
    if (provinceName && city === 'Romania') {
      city = provinceName.replace(/\s*\(judet\)/i, '').trim();
    }
  }

  return { city, region, neighborhood, street, coordinates };
}

function moneyFromPrice(price: unknown): { value: number; currency: string; operation: 'rent' | 'sale' } | undefined {
  if (!isRecord(price)) return undefined;
  const typename = asString(price.__typename)?.toLowerCase() ?? '';
  if (isRecord(price.salePrice)) {
    const value = asNumber(price.salePrice.value);
    const currency = asString(price.salePrice.currency) ?? 'EUR';
    if (value !== undefined) return { value, currency, operation: 'sale' };
  }
  if (isRecord(price.rentPrice)) {
    const value = asNumber(price.rentPrice.value);
    const currency = asString(price.rentPrice.currency) ?? 'EUR';
    if (value !== undefined) return { value, currency, operation: 'rent' };
  }
  if (isRecord(price.totalPrice)) {
    const value = asNumber(price.totalPrice.value);
    const currency = asString(price.totalPrice.currency) ?? 'EUR';
    if (value !== undefined) {
      return { value, currency, operation: typename.includes('rent') ? 'rent' : 'sale' };
    }
  }
  const value = asNumber(price.value);
  const currency = asString(price.currency) ?? 'EUR';
  if (value !== undefined) {
    return { value, currency, operation: typename.includes('rent') ? 'rent' : 'sale' };
  }
  return undefined;
}

function parseContact(details: unknown): NormalizedListingContact | undefined {
  if (!isRecord(details)) return undefined;
  const name = asString(details.name);
  const type = asString(details.type)?.toLowerCase();
  const phones = details.phones;
  const phone = Array.isArray(phones)
    ? phones.map(asString).find((entry): entry is string => Boolean(entry))
    : undefined;
  return buildContact({
    name,
    agencyName: type === 'agency' ? name : undefined,
    phone,
    whatsapp: phone,
    email: asString(details.email),
    kind: type === 'agency' ? 'agency' : type === 'private' ? 'private' : undefined,
  });
}

function collectImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  for (const entry of images) {
    if (typeof entry === 'string') {
      out.push(entry);
      continue;
    }
    if (!isRecord(entry)) continue;
    const url =
      asString(entry.large) ??
      asString(entry.medium) ??
      asString(entry.small) ??
      asString(entry.url);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}

/** Parse search `__NEXT_DATA__` into de-duplicated listing refs. */
export function parseStoriaSearch(htmlOrJson: string): StoriaSearchRef[] {
  const trimmed = htmlOrJson.trim();
  let root: Record<string, unknown> | undefined;
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      root = isRecord(parsed) ? parsed : undefined;
    } catch {
      root = undefined;
    }
  }
  if (!root) root = parseNextData(htmlOrJson);
  if (!root) return [];

  const props = nextDataPageProps(root) ?? root;
  const data = isRecord(props.data) ? props.data : props;
  const searchAds = isRecord(data.searchAds) ? data.searchAds : undefined;
  const items = searchAds && Array.isArray(searchAds.items) ? searchAds.items : [];

  const out = new Map<string, string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const id = asString(item.id) ?? (typeof item.id === 'number' ? String(item.id) : undefined);
    const href = asString(item.href) ?? asString(item.slug) ?? asString(item.url);
    if (!id || !href) continue;
    out.set(id, absoluteOfertaUrl(href));
  }
  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}

/** Parse a detail page `__NEXT_DATA__` into a {@link StoriaRawListing}. */
export function parseStoriaDetail(html: string, url: string): StoriaRawListing {
  const nextData = parseNextData(html);
  if (!nextData) {
    throw new Error('storia: detail page has no __NEXT_DATA__ JSON');
  }
  const props = nextDataPageProps(nextData);
  if (!props) {
    throw new Error('storia: __NEXT_DATA__ missing pageProps');
  }

  const ad = isRecord(props.ad) ? props.ad : undefined;
  const unified = isRecord(props.unifiedAd) ? props.unifiedAd : undefined;
  if (!ad && !unified) {
    throw new Error('storia: detail JSON has no ad / unifiedAd');
  }

  const sourceId =
    asString(ad?.id) ??
    asString(unified?.id) ??
    asString(props.id) ??
    storiaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error('storia: could not resolve sourceId');
  }

  const priceInfo =
    moneyFromPrice(unified?.price) ??
    moneyFromPrice(ad?.totalPrice) ??
    moneyFromPrice(ad?.price);
  if (!priceInfo) {
    throw new Error(`storia: listing ${sourceId} has no resolvable price`);
  }

  const attrs = isRecord(unified?.attributes)
    ? unified.attributes
    : isRecord(ad?.attributes)
      ? ad.attributes
      : {};
  const location = ad?.location ?? unified?.location;
  const place = cityFromLocation(location);
  const detailUrl = asString(ad?.url) ?? url;

  const result: StoriaRawListing = {
    sourceId,
    url: detailUrl,
    title: asString(unified?.title) ?? asString(ad?.title) ?? `Listing ${sourceId}`,
    operation: priceInfo.operation,
    price: priceInfo.value,
    currency: priceInfo.currency,
    address: {
      street: place.street,
      city: place.city,
      region: place.region,
      neighborhood: place.neighborhood,
      countryCode: 'RO',
    },
    images: collectImages(ad?.images ?? unified?.images),
  };

  const description = asString(unified?.description) ?? asString(ad?.description);
  if (description) result.description = description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const bedrooms = roomsFromValue(attrs.rooms_num) ?? roomsFromValue(ad?.roomsNumber);
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const squareMeters = asNumber(attrs.m) ?? asNumber(ad?.areaInSquareMeters);
  if (squareMeters !== undefined) result.squareMeters = squareMeters;
  const floor = floorFromAttr(attrs.floor_no);
  if (floor !== undefined) result.floor = floor;
  if (place.coordinates) result.coordinates = place.coordinates;
  const estate = asString(ad?.estate) ?? asString(unified?.estate);
  if (estate) result.estate = estate;

  const contact = parseContact(props.contactDetails);
  if (contact) result.contact = contact;

  return result;
}

export function isStoriaChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /captcha|datadome|access denied|cf-challenge/i.test(html);
}
