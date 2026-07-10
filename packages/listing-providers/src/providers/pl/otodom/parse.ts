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

function absoluteOfferUrl(hrefOrSlug: string): string {
  const normalized = hrefOrSlug.replace('[lang]', 'pl');
  if (normalized.startsWith('http')) return normalized.split('?')[0] ?? normalized;
  const path = normalized.startsWith('/') ? normalized : `/pl/oferta/${normalized}`;
  return `${OTODOM_BASE_URL}${path.split('?')[0]}`;
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
    const href = asString(item.href) ?? asString(item.slug) ?? asString(item.url);
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

  const priceInfo =
    (ad ? moneyFromItem(ad) : undefined) ??
    (unified
      ? moneyFromItem({
          ...unified,
          transaction: unified.transaction ?? ad?.transaction,
          totalPrice: unified.totalPrice ?? unified.price,
        })
      : undefined);
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
  const estate = asString(ad?.estate) ?? asString(unified?.estate);
  if (estate) result.estate = estate;

  const contact = parseContact(props.contactDetails);
  if (contact) result.contact = contact;

  return result;
}

export function isOtodomChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /captcha|datadome|access denied|cf-challenge/i.test(html);
}
