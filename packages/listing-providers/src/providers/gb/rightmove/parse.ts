/**
 * Rightmove JSON parsers (pure).
 *
 * Discover prefers typeahead JSON + search-page `__NEXT_DATA__` properties
 * array. Detail prefers `window.__PAGE_MODEL` (compressed JSON graph) which
 * carries address, price, images, and contactInfo — not DOM scraping.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../parse/contact';
import { asNumberUs as asNumber, asString, isRecord } from '../../../parse/guards';
import { parseNextData } from '../../../parse/nextData';
import { isGbHousingType, rejectGbNonHousing } from '../housing';
import { RIGHTMOVE_BASE_URL } from './fixtures';

const PAGE_MODEL_RE = /window\.__PAGE_MODEL\s*=\s*(\{[\s\S]*?\})\s*;/;

/** 1 sq ft in square metres — Rightmove exposes both units in `sizings[]`. */
const SQFT_TO_SQM = 0.092903;

export type RightmoveFurnishedStatus = 'furnished' | 'unfurnished' | 'partially_furnished';


/** Flatten Rightmove's compressed `__PAGE_MODEL` integer-pointer graph. */
export function resolvePageModelGraph(data: unknown[]): Record<string, unknown> | undefined {
  if (!Array.isArray(data) || data.length === 0 || !isRecord(data[0])) return undefined;
  const root = data[0];
  const propIdx = root.propertyData;
  if (typeof propIdx !== 'number' || !isRecord(data[propIdx])) return undefined;

  const resolve = (node: unknown, depth = 0): unknown => {
    if (depth > 24) return node;
    if (typeof node === 'number' && node >= 0 && node < data.length) {
      const target = data[node];
      if (typeof target === 'number' || typeof target === 'string' || typeof target === 'boolean' || target === null) {
        return target;
      }
      return resolve(target, depth + 1);
    }
    if (Array.isArray(node)) return node.map((entry) => resolve(entry, depth + 1));
    if (isRecord(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node)) {
        out[key] = resolve(value, depth + 1);
      }
      return out;
    }
    return node;
  };

  const resolved = resolve(data[propIdx]);
  return isRecord(resolved) ? resolved : undefined;
}

export interface RightmoveListingJson {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  displayAddress?: string;
  summary?: string;
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  propertySubType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  priceFrequency?: string;
  countryCode?: string;
  outcode?: string;
  incode?: string;
  latitude?: number;
  longitude?: number;
  /** Living area in square metres (converted from sqft when needed). */
  squareMeters?: number;
  /** Portal `keyFeatures` strings, passed to ingest as amenities for derivation. */
  amenities?: string[];
  furnishedStatus?: RightmoveFurnishedStatus;
  images: string[];
  contact?: NormalizedListingContact;
}

export function rightmoveSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/properties\/(\d+)/i);
  return match?.[1];
}

export function rightmoveDetailUrl(sourceId: string): string {
  return `${RIGHTMOVE_BASE_URL}/properties/${sourceId}`;
}

/** Parse typeahead JSON into the first REGION^id locationIdentifier. */
export function parseRightmoveTypeahead(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as unknown;
    const matches = isRecord(parsed) && Array.isArray(parsed.matches) ? parsed.matches : undefined;
    if (!matches) return undefined;
    for (const entry of matches) {
      if (!isRecord(entry)) continue;
      const id = asString(entry.id);
      const type = asString(entry.type) ?? 'REGION';
      if (id) return `${type}^${id}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function priceFromSearchProperty(record: Record<string, unknown>): {
  amount?: number;
  currency?: string;
  frequency?: string;
} {
  if (!isRecord(record.price)) return {};
  return {
    amount: asNumber(record.price.amount),
    currency: asString(record.price.currencyCode) ?? 'GBP',
    frequency: asString(record.price.frequency),
  };
}

function imagesFromSearchProperty(record: Record<string, unknown>): string[] {
  if (!Array.isArray(record.images)) return [];
  const out: string[] = [];
  for (const image of record.images) {
    if (!isRecord(image)) continue;
    const url = asString(image.srcUrl) ?? asString(image.url);
    if (url?.startsWith('http')) out.push(url.replace(':443/', '/'));
  }
  return out;
}

function isHousingSearchProperty(record: Record<string, unknown>): boolean {
  const sub = asString(record.propertySubType) ?? asString(record.propertyTypeFullDescription);
  return isGbHousingType(sub);
}

/** Extract listing refs (+ optional card JSON) from search `__NEXT_DATA__`. */
export function parseRightmoveSearchJson(html: string): {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  card?: RightmoveListingJson;
}[] {
  const parsed = parseNextData(html);
  if (!parsed) return [];
  const pageProps = isRecord(parsed.props) ? parsed.props.pageProps : undefined;
  const searchResults = isRecord(pageProps) ? pageProps.searchResults : undefined;
  const properties =
    isRecord(searchResults) && Array.isArray(searchResults.properties) ? searchResults.properties : [];

  const out: {
    sourceId: string;
    url: string;
    kind: 'rent' | 'sale';
    card?: RightmoveListingJson;
  }[] = [];
  const seen = new Set<string>();

  for (const entry of properties) {
    if (!isRecord(entry)) continue;
    if (!isHousingSearchProperty(entry)) continue;
    const id = asNumber(entry.id) ?? asNumber(asString(entry.id));
    if (id === undefined) continue;
    const sourceId = String(Math.trunc(id));
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    const price = priceFromSearchProperty(entry);
    const kind: 'rent' | 'sale' =
      price.frequency === 'monthly' || price.frequency === 'weekly' || price.frequency === 'yearly'
        ? 'rent'
        : 'sale';
    const location = isRecord(entry.location) ? entry.location : undefined;
    const card: RightmoveListingJson = {
      sourceId,
      url: rightmoveDetailUrl(sourceId),
      kind,
      displayAddress: asString(entry.displayAddress),
      summary: asString(entry.summary),
      bedrooms: asNumber(entry.bedrooms),
      bathrooms: asNumber(entry.bathrooms),
      propertySubType: asString(entry.propertySubType),
      priceAmount: price.amount,
      priceCurrency: price.currency,
      priceFrequency: price.frequency,
      countryCode: asString(entry.countryCode) ?? 'GB',
      latitude: location ? asNumber(location.latitude) : undefined,
      longitude: location ? asNumber(location.longitude) : undefined,
      images: imagesFromSearchProperty(entry),
    };
    out.push({ sourceId, url: card.url, kind, card });
  }
  return out;
}

function parsePrimaryPricePcm(prices: Record<string, unknown> | undefined): number | undefined {
  if (!prices) return undefined;
  const primary = asString(prices.primaryPrice);
  if (!primary) return undefined;
  // "£3,400 pcm" or "£450,000"
  const pcm = primary.match(/£([\d,]+)\s*pcm/i);
  if (pcm?.[1]) return asNumber(pcm[1]);
  const sale = primary.match(/£([\d,]+)/);
  return sale?.[1] ? asNumber(sale[1]) : undefined;
}

function imagesFromDetail(prop: Record<string, unknown>): string[] {
  if (!Array.isArray(prop.images)) return [];
  const out: string[] = [];
  for (const image of prop.images) {
    if (!isRecord(image)) continue;
    const url = asString(image.url);
    if (url?.startsWith('http')) out.push(url);
  }
  return out;
}

function contactFromDetail(prop: Record<string, unknown>): NormalizedListingContact | undefined {
  const contactInfo = isRecord(prop.contactInfo) ? prop.contactInfo : undefined;
  const phones = contactInfo && isRecord(contactInfo.telephoneNumbers) ? contactInfo.telephoneNumbers : undefined;
  const customer = isRecord(prop.customer) ? prop.customer : undefined;
  return buildContact({
    phone: phones ? asString(phones.localNumber) ?? asString(phones.internationalNumber) : undefined,
    email: undefined,
    agencyName:
      (customer ? asString(customer.branchDisplayName) : undefined) ??
      (customer ? asString(customer.companyTradingName) : undefined) ??
      (customer ? asString(customer.companyName) : undefined),
    kind: 'agency',
  });
}

/**
 * Living area in m² from `propertyData.sizings[]`. Prefers a native `sqm` entry;
 * converts a `sqft` entry only when no metric one exists.
 */
function squareMetersFromSizings(prop: Record<string, unknown>): number | undefined {
  if (!Array.isArray(prop.sizings)) return undefined;
  let sqft: number | undefined;
  for (const entry of prop.sizings) {
    if (!isRecord(entry)) continue;
    const size = asNumber(entry.minimumSize) ?? asNumber(entry.maximumSize);
    if (size === undefined || size <= 0) continue;
    const unit = asString(entry.unit)?.toLowerCase();
    if (unit === 'sqm') return Math.round(size);
    if (unit === 'sqft' && sqft === undefined) sqft = size;
  }
  return sqft === undefined ? undefined : Math.round(sqft * SQFT_TO_SQM);
}

/** Fallback living area in m² from a `displaySize` string (e.g. "850 sq. ft."). */
function squareMetersFromDisplaySize(prop: Record<string, unknown>): number | undefined {
  const display = asString(prop.displaySize);
  if (!display) return undefined;
  const match = display
    .replace(/,/g, '')
    .match(/(\d{1,7}(?:\.\d{1,3})?)\s{0,3}(sq\.?\s*m|sqm|square\s*met|sq\.?\s*ft|sqft|square\s*f)/i);
  if (!match?.[1] || !match[2]) return undefined;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = match[2].toLowerCase();
  return /f/.test(unit) ? Math.round(value * SQFT_TO_SQM) : Math.round(value);
}

function squareMetersFromDetail(prop: Record<string, unknown>): number | undefined {
  return squareMetersFromSizings(prop) ?? squareMetersFromDisplaySize(prop);
}

/** Portal `keyFeatures[]` strings — passed to ingest as amenities for derivation. */
function keyFeaturesFromDetail(prop: Record<string, unknown>): string[] {
  if (!Array.isArray(prop.keyFeatures)) return [];
  const out: string[] = [];
  for (const feature of prop.keyFeatures) {
    const value = asString(feature);
    if (value) out.push(value);
  }
  return out;
}

/** Map `propertyData.letting.furnishType` to the normalized furnished status. */
function furnishedStatusFromDetail(prop: Record<string, unknown>): RightmoveFurnishedStatus | undefined {
  const letting = isRecord(prop.letting) ? prop.letting : undefined;
  const furnish = letting ? asString(letting.furnishType) : undefined;
  if (!furnish) return undefined;
  const normalized = furnish.toLowerCase().replace(/\s+/g, ' ').trim();
  switch (normalized) {
    case 'furnished':
      return 'furnished';
    case 'unfurnished':
      return 'unfurnished';
    case 'part furnished':
    case 'partly furnished':
    case 'partially furnished':
      return 'partially_furnished';
    default:
      // "Furnished or unfurnished" (ask agent) and unknown values stay unset.
      return undefined;
  }
}

/** Parse a detail page's `__PAGE_MODEL` into a listing JSON payload. */
export function parseRightmoveDetail(html: string, url: string): RightmoveListingJson {
  const match = PAGE_MODEL_RE.exec(html);
  if (!match?.[1]) {
    throw new Error(`rightmove: no __PAGE_MODEL JSON at ${url}`);
  }
  let outer: unknown;
  try {
    outer = JSON.parse(match[1]);
  } catch {
    throw new Error(`rightmove: invalid __PAGE_MODEL JSON at ${url}`);
  }
  if (!isRecord(outer) || typeof outer.data !== 'string') {
    throw new Error(`rightmove: unexpected __PAGE_MODEL shape at ${url}`);
  }
  let graph: unknown;
  try {
    graph = JSON.parse(outer.data);
  } catch {
    throw new Error(`rightmove: invalid __PAGE_MODEL data graph at ${url}`);
  }
  if (!Array.isArray(graph)) {
    throw new Error(`rightmove: __PAGE_MODEL data is not an array at ${url}`);
  }
  const prop = resolvePageModelGraph(graph);
  if (!prop) {
    throw new Error(`rightmove: could not resolve propertyData at ${url}`);
  }
  const sourceId =
    asString(prop.id) ??
    (asNumber(prop.id) !== undefined ? String(Math.trunc(asNumber(prop.id)!)) : undefined) ??
    rightmoveSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`rightmove: missing property id at ${url}`);
  }

  if (!isGbHousingType(asString(prop.propertySubType))) {
    rejectGbNonHousing('rightmove', sourceId, `propertySubType "${asString(prop.propertySubType) ?? ''}"`);
  }

  const address = isRecord(prop.address) ? prop.address : undefined;
  const location = isRecord(prop.location) ? prop.location : undefined;
  const prices = isRecord(prop.prices) ? prop.prices : undefined;
  const text = isRecord(prop.text) ? prop.text : undefined;
  const channel = asString(prop.channel)?.toUpperCase();
  const transaction = asString(prop.transactionType)?.toUpperCase();
  const kind: 'rent' | 'sale' =
    channel === 'RENT' || transaction === 'RENT' || /pcm/i.test(asString(prices?.primaryPrice) ?? '')
      ? 'rent'
      : 'sale';

  const outcode = address ? asString(address.outcode) : undefined;
  const incode = address ? asString(address.incode) : undefined;

  return {
    sourceId,
    url: rightmoveDetailUrl(sourceId),
    kind,
    displayAddress: address ? asString(address.displayAddress) : undefined,
    description: text ? asString(text.description) ?? asString(text.shortDescription) : undefined,
    bedrooms: asNumber(prop.bedrooms),
    bathrooms: asNumber(prop.bathrooms),
    propertySubType: asString(prop.propertySubType),
    priceAmount: parsePrimaryPricePcm(prices),
    priceCurrency: 'GBP',
    priceFrequency: kind === 'rent' ? 'monthly' : undefined,
    countryCode: address ? asString(address.countryCode) ?? 'GB' : 'GB',
    outcode,
    incode,
    latitude: location ? asNumber(location.latitude) : undefined,
    longitude: location ? asNumber(location.longitude) : undefined,
    squareMeters: squareMetersFromDetail(prop),
    amenities: keyFeaturesFromDetail(prop),
    furnishedStatus: furnishedStatusFromDetail(prop),
    images: imagesFromDetail(prop),
    contact: contactFromDetail(prop),
  };
}

export function rightmoveTypeaheadUrl(city: string): string {
  return `https://los.rightmove.co.uk/typeahead?query=${encodeURIComponent(city)}`;
}

export function rightmoveSearchUrl(locationIdentifier: string, kind: 'rent' | 'sale', index = 0): string {
  const path = kind === 'rent' ? 'property-to-rent' : 'property-for-sale';
  const channel = kind === 'rent' ? 'RENT' : 'BUY';
  const params = new URLSearchParams({
    locationIdentifier,
    index: String(index),
    sortType: '6',
    viewType: 'LIST',
    channel,
  });
  return `${RIGHTMOVE_BASE_URL}/${path}/find.html?${params.toString()}`;
}
