/**
 * Daft.ie JSON parsers (pure, DOM-free).
 *
 * Search + detail embed listing payloads in Next.js `__NEXT_DATA__`.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { parseNextData, nextDataPageProps } from '../../../nextData';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { citySlug } from '../../../slug';
import { DAFT_BASE_URL } from './fixtures';

export interface DaftSearchRef {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
}

export interface DaftRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  propertyType?: string;
  address: {
    street?: string;
    city: string;
    countryCode: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  contact?: NormalizedListingContact;
}

export function daftSourceIdFromUrl(url: string): string | undefined {
  const match = /\/(\d{5,})(?:\/|$|\?)/.exec(url);
  return match?.[1];
}

export function daftSearchUrl(city: string, kind: 'rent' | 'sale'): string {
  const slug = citySlug(city);
  return kind === 'rent'
    ? `${DAFT_BASE_URL}/property-for-rent/${slug}`
    : `${DAFT_BASE_URL}/property-for-sale/${slug}`;
}

export function parseEuroAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const match = /€\s*([\d,]+(?:\.\d+)?)/.exec(raw.replace(/\u00a0/g, ' '));
  if (!match?.[1]) return undefined;
  const normalized = match[1].replace(/,/g, '');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function bedroomsFromLabel(raw: unknown): number | undefined {
  const text = asString(raw);
  if (!text) return asNumber(raw);
  const match = /(\d+)/.exec(text);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function kindFromCategory(category: unknown): 'rent' | 'sale' {
  const value = asString(category)?.toLowerCase() ?? '';
  return value.includes('sale') || value.includes('buy') ? 'sale' : 'rent';
}

function cityFromTitle(title: string, fallbackCity: string): string {
  const county = /,\s*Co\.\s*([A-Za-z ]+)/i.exec(title);
  if (county?.[1]) return county[1].trim();
  const dublin = /Dublin(?:\s+\d+)?/i.exec(title);
  if (dublin?.[0]) return 'Dublin';
  return fallbackCity;
}

function listingRecord(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  if (isRecord(raw.listing)) return raw.listing;
  return raw;
}

function absoluteUrl(path: string | undefined, sourceId: string): string {
  if (path?.startsWith('http')) return path.split('?')[0] ?? path;
  if (path?.startsWith('/')) return `${DAFT_BASE_URL}${path.split('?')[0]}`;
  return `${DAFT_BASE_URL}/property/${sourceId}`;
}

function collectImages(media: unknown): string[] {
  if (!isRecord(media) || !Array.isArray(media.images)) return [];
  const out: string[] = [];
  for (const image of media.images) {
    if (!isRecord(image)) continue;
    const url =
      asString(image.size1440x960) ??
      asString(image.size1200x1200) ??
      asString(image.size720x480) ??
      asString(image.size360x240);
    if (url) out.push(url);
  }
  return [...new Set(out)];
}

function coordinatesFromPoint(point: unknown): { lat: number; lng: number } | undefined {
  if (!isRecord(point) || !Array.isArray(point.coordinates) || point.coordinates.length < 2) {
    return undefined;
  }
  const lng = asNumber(point.coordinates[0]);
  const lat = asNumber(point.coordinates[1]);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function contactFromSeller(seller: unknown): NormalizedListingContact | undefined {
  if (!isRecord(seller)) return undefined;
  const name = asString(seller.name);
  const branch = asString(seller.branch);
  const sellerType = asString(seller.sellerType)?.toLowerCase();
  return buildContact({
    name,
    agencyName: branch ?? (sellerType?.includes('agent') ? name : undefined),
    kind: sellerType?.includes('private') ? 'private' : 'agency',
  });
}

function parseListingNode(
  node: Record<string, unknown>,
  fallbackCity: string,
): DaftRawListing | undefined {
  const sourceId =
    asString(node.id) ?? (typeof node.id === 'number' ? String(node.id) : undefined);
  if (!sourceId) return undefined;

  const kind = kindFromCategory(node.category ?? node.saleType);
  const price = parseEuroAmount(asString(node.price));
  if (price === undefined) return undefined;

  const title = asString(node.title) ?? `Listing ${sourceId}`;
  const seoPath = asString(node.seoFriendlyPath);
  const url = absoluteUrl(seoPath, sourceId);
  const city = cityFromTitle(title, fallbackCity);

  const result: DaftRawListing = {
    sourceId,
    url,
    title,
    kind,
    price,
    currency: 'EUR',
    address: {
      street: title,
      city,
      countryCode: 'IE',
    },
    images: collectImages(node.media),
  };

  const description = asString(node.description);
  if (description) result.description = description;
  const bedrooms = bedroomsFromLabel(node.numBedrooms);
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const propertyType = asString(node.propertyType);
  if (propertyType) result.propertyType = propertyType;
  const coordinates = coordinatesFromPoint(node.point);
  if (coordinates) result.coordinates = coordinates;
  const contact = contactFromSeller(node.seller);
  if (contact) result.contact = contact;

  return result;
}

/** Parse search `__NEXT_DATA__` into listing refs. */
export function parseDaftSearch(htmlOrJson: string, fallbackCity = 'Ireland'): DaftSearchRef[] {
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
  const props = root ? nextDataPageProps(root) : undefined;
  if (!props || !isRecord(props.listings)) return [];

  const out = new Map<string, DaftSearchRef>();
  for (const entry of Object.values(props.listings)) {
    const listing = listingRecord(entry);
    if (!listing) continue;
    const parsed = parseListingNode(listing, fallbackCity);
    if (!parsed) continue;
    out.set(parsed.sourceId, { sourceId: parsed.sourceId, url: parsed.url, kind: parsed.kind });
  }
  return [...out.values()];
}

/** Parse a detail page `__NEXT_DATA__` into a {@link DaftRawListing}. */
export function parseDaftDetail(html: string, url: string, fallbackCity = 'Ireland'): DaftRawListing {
  const nextData = parseNextData(html);
  if (!nextData) {
    throw new Error('daft: detail page has no __NEXT_DATA__ JSON');
  }
  const props = nextDataPageProps(nextData);
  if (!props || !isRecord(props.listing)) {
    throw new Error('daft: __NEXT_DATA__ missing pageProps.listing');
  }
  const parsed = parseListingNode(props.listing, fallbackCity);
  if (!parsed) {
    const sourceId = daftSourceIdFromUrl(url);
    throw new Error(`daft: could not parse listing ${sourceId ?? url}`);
  }
  return parsed;
}

export function isDaftChallenge(html: string): boolean {
  if (html.trim().length < 256) return true;
  return /captcha|datadome|access denied|just a moment|cf-challenge/i.test(html);
}
