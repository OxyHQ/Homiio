/**
 * Funda.nl mobile JSON API helpers + parsers (pure).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { citySlug } from '../../../slug';
import {
  FUNDA_BASE_URL,
  FUNDA_DETAIL_BASE_URL,
  FUNDA_AREA_BY_CITY,
  FUNDA_SEARCH_INDEX,
  FUNDA_SEARCH_TEMPLATE_ID,
  FUNDA_SEARCH_URL,
} from './fixtures';

export interface FundaSearchRef {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
}

export interface FundaRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  squareMeters?: number;
  propertyType?: string;
  address: {
    street?: string;
    city: string;
    postalCode?: string;
    countryCode: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  contact?: NormalizedListingContact;
}

export const FUNDA_JSON_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/json',
  Referer: `${FUNDA_BASE_URL}/`,
  'X-Funda-App-Platform': 'android',
};

function fundaAreaSlug(city: string): string {
  const slug = citySlug(city);
  return FUNDA_AREA_BY_CITY[slug] ?? slug;
}

export function fundaSearchBody(city: string, kind: 'rent' | 'sale', page: number, pageSize = 15): string {
  const area = fundaAreaSlug(city);
  const offering = kind === 'rent' ? 'rent' : 'buy';
  const from = Math.max(0, (page - 1) * pageSize);
  const params = {
    selected_area: [area],
    offering_type: [offering],
    page: { from, size: pageSize },
  };
  return `${JSON.stringify({ index: FUNDA_SEARCH_INDEX })}\n${JSON.stringify({ id: FUNDA_SEARCH_TEMPLATE_ID, params })}`;
}

export function fundaDetailUrl(sourceId: string): string {
  return `${FUNDA_DETAIL_BASE_URL}/tinyId/${encodeURIComponent(sourceId)}`;
}

export function fundaSourceIdFromUrl(url: string): string | undefined {
  const match = /\/(\d{5,})(?:\/|$|\?)/.exec(url);
  return match?.[1];
}

function kindFromOffering(value: unknown): 'rent' | 'sale' {
  const offering = asString(value)?.toLowerCase() ?? '';
  return offering.includes('buy') || offering.includes('sale') || offering.includes('koop')
    ? 'sale'
    : 'rent';
}

function priceFromSource(source: Record<string, unknown>, kind: 'rent' | 'sale'): number | undefined {
  const price = isRecord(source.price) ? source.price : undefined;
  if (!price) return undefined;
  if (kind === 'rent') {
    return asNumber(price.rent_price) ?? asNumber(price.rentPrice);
  }
  return asNumber(price.selling_price) ?? asNumber(price.sellingPrice) ?? asNumber(price.sale_price);
}

function streetFromAddress(address: Record<string, unknown> | undefined): string | undefined {
  if (!address) return undefined;
  const street = asString(address.street_name) ?? asString(address.street);
  const number = asString(address.house_number) ?? asString(address.houseNumber);
  if (street && number) return `${street} ${number}`;
  return street;
}

function absoluteListingUrl(relative: string | undefined, tinyId: string): string {
  if (relative?.startsWith('http')) return relative.split('?')[0] ?? relative;
  if (relative?.startsWith('/')) return `${FUNDA_BASE_URL}${relative.split('?')[0]}`;
  return `${FUNDA_BASE_URL}/detail/${tinyId}`;
}

function titleFromSource(source: Record<string, unknown>, city: string): string {
  const street = streetFromAddress(isRecord(source.address) ? source.address : undefined);
  const objectType = asString(source.object_type) ?? 'property';
  if (street) return `${objectType} ${street}, ${city}`;
  return `${objectType} in ${city}`;
}

function parseListingSource(source: Record<string, unknown>): FundaRawListing | undefined {
  const sourceId =
    asString(source.tiny_id) ??
    (typeof source.tiny_id === 'number' ? String(source.tiny_id) : undefined) ??
    asString(source.tinyId);
  if (!sourceId) return undefined;

  const kind = kindFromOffering(source.offering_type ?? source.offeringType);
  const price = priceFromSource(source, kind);
  if (price === undefined || price <= 0) return undefined;

  const address = isRecord(source.address) ? source.address : undefined;
  const city = asString(address?.city) ?? 'Netherlands';
  const relative = asString(source.detail_page_relative_url) ?? asString(source.relative_url);

  const result: FundaRawListing = {
    sourceId,
    url: absoluteListingUrl(relative, sourceId),
    title: titleFromSource(source, city),
    kind,
    price,
    currency: 'EUR',
    address: {
      street: streetFromAddress(address),
      city,
      postalCode: asString(address?.postcode) ?? asString(address?.postalCode),
      countryCode: 'NL',
    },
    images: [],
  };

  const bedrooms = asNumber(source.number_of_bedrooms) ?? asNumber(source.number_of_rooms);
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const squareMeters = asNumber(source.floor_area) ?? asNumber(source.living_area);
  if (squareMeters !== undefined) result.squareMeters = squareMeters;
  const propertyType = asString(source.object_type);
  if (propertyType) result.propertyType = propertyType;
  const lat = address ? asNumber(address.latitude) : undefined;
  const lng = address ? asNumber(address.longitude) : undefined;
  if (lat !== undefined && lng !== undefined) result.coordinates = { lat, lng };

  const media = source.media;
  if (Array.isArray(media)) {
    const images: string[] = [];
    for (const entry of media) {
      if (!isRecord(entry)) continue;
      const url = asString(entry.url);
      if (url) images.push(url);
    }
    result.images = [...new Set(images)];
  }

  const broker = isRecord(source.broker) ? source.broker : undefined;
  if (broker) {
    result.contact = buildContact({
      name: asString(broker.name),
      agencyName: asString(broker.name),
      phone: asString(broker.phone),
      email: asString(broker.email),
      kind: 'agency',
    });
  }

  const description = asString(source.description);
  if (description) result.description = description;

  return result;
}

export function parseFundaSearch(body: string): FundaSearchRef[] {
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (!isRecord(parsed)) return [];
    root = parsed;
  } catch {
    return [];
  }

  const responses = Array.isArray(root.responses) ? root.responses : [];
  const out = new Map<string, FundaSearchRef>();
  for (const response of responses) {
    if (!isRecord(response)) continue;
    const hits = isRecord(response.hits) ? response.hits : undefined;
    const items = hits && Array.isArray(hits.hits) ? hits.hits : [];
    for (const hit of items) {
      if (!isRecord(hit)) continue;
      const source = isRecord(hit._source) ? hit._source : hit;
      const listing = parseListingSource(source);
      if (!listing) continue;
      out.set(listing.sourceId, {
        sourceId: listing.sourceId,
        url: listing.url,
        kind: listing.kind,
      });
    }
  }
  return [...out.values()];
}

export function parseFundaDetail(body: string, sourceId: string): FundaRawListing {
  let root: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(body.trim());
    if (!isRecord(parsed)) {
      throw new Error('funda: detail JSON is not an object');
    }
    root = parsed;
  } catch (error) {
    throw new Error(
      `funda: invalid detail JSON for ${sourceId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const listing = parseListingSource(root);
  if (!listing) {
    throw new Error(`funda: could not parse listing ${sourceId}`);
  }
  return listing;
}

export function isFundaChallenge(body: string): boolean {
  if (body.trim().length < 32) return true;
  return /access denied|akamai|<html|errors\.edgesuite\.net/i.test(body);
}

export { FUNDA_SEARCH_URL };
