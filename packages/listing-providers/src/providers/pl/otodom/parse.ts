/**
 * Otodom.pl JSON parsers (pure, DOM-free) — OLX vertical / __NEXT_DATA__.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { parseNextData, nextDataPageProps } from '../../../nextData';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { citySlug } from '../../../slug';
import { OTODOM_BASE_URL, OTODOM_REGION_BY_CITY } from './fixtures';

const ROOMS_MAP: Readonly<Record<string, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
  SIX: 6,
  STUDIO: 0,
};

export interface OtodomSearchRef {
  sourceId: string;
  url: string;
}

export interface OtodomRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  operation: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  squareMeters?: number;
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

export function otodomSourceIdFromUrl(url: string): string | undefined {
  const idMatch = /[-/]ID([A-Za-z0-9]+)(?:\/|$|\?)/i.exec(url);
  if (idMatch?.[1]) return idMatch[1].match(/^\d+$/) ? idMatch[1] : `ID${idMatch[1]}`;
  const numeric = /\/oferta\/[^/]*?(\d{5,})(?:\/|$|\?)/.exec(url);
  if (numeric?.[1]) return numeric[1];
  return undefined;
}

export function otodomSearchUrl(city: string, kind: 'rent' | 'sale', page = 1): string {
  const slug = citySlug(city);
  const region = OTODOM_REGION_BY_CITY[slug] ?? slug;
  const tx = kind === 'rent' ? 'wynajem' : 'sprzedaz';
  const base = `${OTODOM_BASE_URL}/pl/wyniki/${tx}/mieszkanie/${region}/${slug}/${slug}/${slug}`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

/**
 * Build a canonical Otodom detail URL. Search results expose a clean `slug`
 * plus an `href` template of the form `[lang]/ad/<slug>`; the canonical detail
 * path is `/pl/oferta/<slug>` (the `[lang]/ad/` template path 404s). Reduce
 * whatever we get to its slug and rebuild against the canonical path.
 */
function absoluteOfferUrl(hrefOrSlug: string): string {
  const value = hrefOrSlug.trim();
  if (value.startsWith('http')) return value.split('?')[0] ?? value;
  const slug = value
    .split('?')[0]
    .replace(/^\[lang\]/, '')
    .replace(/^\/+/, '')
    .replace(/^(?:pl\/)?(?:oferta|ad)\//, '');
  return `${OTODOM_BASE_URL}/pl/oferta/${slug}`;
}

function operationFromTransaction(value: unknown): 'rent' | 'sale' {
  const tx = asString(value)?.toUpperCase() ?? '';
  return tx.includes('SELL') || tx.includes('SALE') ? 'sale' : 'rent';
}

function roomsFromValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const asStr = asString(value);
  if (!asStr) return undefined;
  const mapped = ROOMS_MAP[asStr.toUpperCase()];
  if (mapped !== undefined) return mapped;
  return asNumber(asStr);
}

function cityFromLocation(location: unknown): {
  city: string;
  region?: string;
  neighborhood?: string;
  street?: string;
  coordinates?: { lat: number; lng: number };
} {
  if (!isRecord(location)) return { city: 'Poland' };
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

  let city = 'Poland';
  let region: string | undefined;
  let neighborhood: string | undefined;
  const reverse = isRecord(location.reverseGeocoding) ? location.reverseGeocoding : undefined;
  const locations = reverse && Array.isArray(reverse.locations) ? reverse.locations : [];
  for (const entry of locations) {
    if (!isRecord(entry)) continue;
    const level = asString(entry.locationLevel);
    const name = asString(entry.name);
    if (!name) continue;
    if (level === 'voivodeship') region = name;
    if (level === 'city_or_village' || level === 'city') city = name;
    if (level === 'district' || level === 'residential') neighborhood = name;
  }

  const address = isRecord(location.address) ? location.address : undefined;
  const streetObj = address && isRecord(address.street) ? address.street : undefined;
  const streetName = streetObj ? asString(streetObj.name) : undefined;
  const streetNumber = streetObj ? asString(streetObj.number) : undefined;
  const street =
    streetName && streetNumber ? `${streetName} ${streetNumber}` : streetName;

  return { city, region, neighborhood, street, coordinates };
}

function moneyFromItem(item: Record<string, unknown>): { value: number; currency: string; operation: 'rent' | 'sale' } | undefined {
  const operation = operationFromTransaction(item.transaction);
  const total = isRecord(item.totalPrice) ? item.totalPrice : undefined;
  if (total) {
    const value = asNumber(total.value);
    const currency = asString(total.currency) ?? 'PLN';
    if (value !== undefined) return { value, currency, operation };
  }
  const price = isRecord(item.price) ? item.price : undefined;
  if (price) {
    const value = asNumber(price.value);
    const currency = asString(price.currency) ?? 'PLN';
    if (value !== undefined) return { value, currency, operation };
  }
  return undefined;
}

/** Read a `{ value, currency }` Money node (Otodom unifiedAd nested price). */
function moneyFromObject(value: unknown): { value: number; currency: string } | undefined {
  if (!isRecord(value)) return undefined;
  const amount = asNumber(value.value);
  if (amount === undefined || amount <= 0) return undefined;
  return { value: amount, currency: asString(value.currency) ?? 'PLN' };
}

/** Resolve rent/sale for a detail ad from category / price typename / offer type. */
function detailOperation(
  ad: Record<string, unknown> | undefined,
  unified: Record<string, unknown> | undefined,
): 'rent' | 'sale' {
  const categoryType = ad && isRecord(ad.adCategory) ? asString(ad.adCategory.type) : undefined;
  if (categoryType) {
    if (/sell|sale/i.test(categoryType)) return 'sale';
    if (/rent/i.test(categoryType)) return 'rent';
  }
  const priceType = unified && isRecord(unified.price) ? asString(unified.price.__typename) : undefined;
  if (priceType) {
    if (/sell|sale/i.test(priceType)) return 'sale';
    if (/rent/i.test(priceType)) return 'rent';
  }
  const offerType = ad && isRecord(ad.target) ? asString(ad.target.OfferType) : undefined;
  if (offerType) {
    if (/sprzeda/i.test(offerType)) return 'sale';
    if (/wynaj/i.test(offerType)) return 'rent';
  }
  return operationFromTransaction(ad?.transaction ?? unified?.transaction);
}

/** Headline price from `ad.characteristics` (`[{ key: 'price', value, currency }]`). */
function characteristicPrice(
  ad: Record<string, unknown> | undefined,
): { value: number; currency: string } | undefined {
  if (!ad || !Array.isArray(ad.characteristics)) return undefined;
  for (const entry of ad.characteristics) {
    if (!isRecord(entry) || asString(entry.key) !== 'price') continue;
    const amount = asNumber(entry.value);
    if (amount !== undefined && amount > 0) {
      return { value: amount, currency: asString(entry.currency) ?? 'PLN' };
    }
  }
  return undefined;
}

/**
 * Resolve the headline price + currency + operation from a detail ad/unifiedAd.
 * Detail pages no longer carry `ad.price.value` / `ad.transaction`; the amount
 * lives in `unifiedAd.price.{rentalPrice,sellingPrice,price}`, in
 * `ad.characteristics`, or in `ad.target.Price`.
 */
function detailMoney(
  ad: Record<string, unknown> | undefined,
  unified: Record<string, unknown> | undefined,
): { value: number; currency: string; operation: 'rent' | 'sale' } | undefined {
  const operation = detailOperation(ad, unified);
  const unifiedPrice = unified && isRecord(unified.price) ? unified.price : undefined;
  const fromUnified =
    moneyFromObject(unifiedPrice?.rentalPrice) ??
    moneyFromObject(unifiedPrice?.sellingPrice) ??
    moneyFromObject(unifiedPrice?.price) ??
    moneyFromObject(unifiedPrice);
  if (fromUnified) return { ...fromUnified, operation };
  const fromCharacteristics = characteristicPrice(ad);
  if (fromCharacteristics) return { ...fromCharacteristics, operation };
  const fromTarget = ad && isRecord(ad.target) ? asNumber(ad.target.Price) : undefined;
  if (fromTarget !== undefined && fromTarget > 0) return { value: fromTarget, currency: 'PLN', operation };
  // Legacy markup: `ad.totalPrice` / `ad.price.value` (kept for older payloads).
  const legacy = (ad ? moneyFromItem(ad) : undefined) ?? (unified ? moneyFromItem(unified) : undefined);
  if (legacy) return legacy;
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

export function parseOtodomSearch(htmlOrJson: string): OtodomSearchRef[] {
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
    // Prefer the clean `slug`; `href` is a `[lang]/ad/<slug>` template whose
    // path segment 404s — `absoluteOfferUrl` rebuilds the canonical URL either way.
    const href = asString(item.slug) ?? asString(item.href) ?? asString(item.url);
    if (!id || !href) continue;
    const money = moneyFromItem(item);
    if (!money || money.value <= 0) continue;
    out.set(id, absoluteOfferUrl(href));
  }
  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}

export function parseOtodomDetail(html: string, url: string): OtodomRawListing {
  const nextData = parseNextData(html);
  if (!nextData) {
    throw new Error('otodom: detail page has no __NEXT_DATA__ JSON');
  }
  const props = nextDataPageProps(nextData);
  if (!props) {
    throw new Error('otodom: __NEXT_DATA__ missing pageProps');
  }

  const ad = isRecord(props.ad) ? props.ad : undefined;
  const unified = isRecord(props.unifiedAd) ? props.unifiedAd : undefined;
  if (!ad && !unified) {
    throw new Error('otodom: detail JSON has no ad / unifiedAd');
  }

  const sourceId =
    asString(ad?.id) ??
    asString(unified?.id) ??
    asString(props.id) ??
    otodomSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error('otodom: could not resolve sourceId');
  }

  const priceInfo = detailMoney(ad, unified);
  if (!priceInfo) {
    throw new Error(`otodom: listing ${sourceId} has no resolvable price`);
  }

  const attrs = isRecord(unified?.attributes)
    ? unified.attributes
    : isRecord(ad?.attributes)
      ? ad.attributes
      : {};
  const location = ad?.location ?? unified?.location;
  const place = cityFromLocation(location);
  const detailUrl = asString(ad?.url) ?? url;

  const result: OtodomRawListing = {
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
      countryCode: 'PL',
    },
    images: collectImages(ad?.images ?? unified?.images),
  };

  const description = asString(unified?.description) ?? asString(ad?.description);
  if (description) result.description = description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  const bedrooms = roomsFromValue(attrs.rooms_num) ?? roomsFromValue(ad?.roomsNumber);
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const squareMeters = asNumber(attrs.m) ?? asNumber(ad?.areaInSquareMeters);
  if (squareMeters !== undefined) result.squareMeters = squareMeters;
  if (place.coordinates) result.coordinates = place.coordinates;
  // `ad.estate` is gone from current markup; derive the dwelling kind from the
  // OLX category name (`FLAT`/`HOUSE`) or the `building_type` attribute so houses
  // are not all misclassified as apartments.
  const adCategoryName = ad && isRecord(ad.adCategory) ? asString(ad.adCategory.name) : undefined;
  const estate =
    asString(ad?.estate) ??
    asString(unified?.estate) ??
    adCategoryName ??
    asString(attrs.building_type);
  if (estate) result.estate = estate;

  const contact = parseContact(props.contactDetails);
  if (contact) result.contact = contact;

  return result;
}

export function isOtodomChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /captcha|datadome|access denied|cf-challenge/i.test(html);
}
