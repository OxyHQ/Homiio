/**
 * Fotocasa HTML parsing (pure, DOM-free).
 *
 * Fotocasa detail pages embed the listing as schema.org JSON-LD (alongside the
 * Next.js `__NEXT_DATA__` state), so `fetch()` pulls the detail HTML through the
 * shared {@link FetchRuntime} ladder and this module flattens the JSON-LD (via
 * the shared ES helper) into a {@link FotocasaRaw}. Search-results pages are
 * parsed for `…/<id>/d` detail links into de-duplicated refs.
 */

import { extractEsSchemaListings, pickEsListing, type EsSchemaListing } from '../es/jsonLd';
import { FOTOCASA_BASE_URL } from './fixtures';

/** Match Fotocasa's embedded Next.js hydration payload. */
const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

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
    const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readNestedPrice(record: Record<string, unknown>): number | undefined {
  const direct =
    asNumber(record.price) ??
    asNumber(record.rent) ??
    asNumber(record.monthlyPrice) ??
    asNumber(record.priceRent);
  if (direct !== undefined) return direct;
  if (isRecord(record.price)) {
    return asNumber(record.price.amount) ?? asNumber(record.price.value);
  }
  if (isRecord(record.offers)) {
    return asNumber(record.offers.price) ?? asNumber(record.offers.amount);
  }
  if (isRecord(record.pricing)) {
    return asNumber(record.pricing.amount) ?? asNumber(record.pricing.price);
  }
  return undefined;
}

function readNestedCity(record: Record<string, unknown>): string | undefined {
  if (isRecord(record.address)) {
    const address = record.address;
    return (
      asString(address.addressLocality) ??
      asString(address.city) ??
      asString(address.locality) ??
      asString(address.name)
    );
  }
  if (isRecord(record.location)) {
    return asString(record.location.city) ?? asString(record.location.locality);
  }
  return asString(record.city) ?? asString(record.locality) ?? asString(record.addressLocality);
}

function collectNestedImages(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (entry: unknown): void => {
    if (typeof entry === 'string') {
      out.push(entry);
      return;
    }
    if (!isRecord(entry)) return;
    const url = asString(entry.url) ?? asString(entry.src) ?? asString(entry.contentUrl);
    if (url) out.push(url);
  };
  for (const key of ['image', 'images', 'photos', 'multimedia', 'gallery']) {
    const value = record[key];
    if (Array.isArray(value)) value.forEach(push);
    else push(value);
  }
  return [...new Set(out)];
}

function findNextDataListing(node: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 14) return undefined;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findNextDataListing(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  const price = readNestedPrice(node);
  const city = readNestedCity(node);
  if (price !== undefined && city) return node;
  for (const value of Object.values(node)) {
    const found = findNextDataListing(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function listingFromNextDataCandidate(candidate: Record<string, unknown>, url: string): EsSchemaListing {
  const addressRecord = isRecord(candidate.address) ? candidate.address : {};
  const geo = isRecord(candidate.geo) ? candidate.geo : isRecord(addressRecord.geo) ? addressRecord.geo : undefined;
  const floorSize = isRecord(candidate.floorSize) ? candidate.floorSize : candidate.surface;
  const price = readNestedPrice(candidate);
  const offer = isRecord(candidate.offers) ? candidate.offers : undefined;
  const businessFunction = asString(offer?.businessFunction)?.toLowerCase() ?? '';
  let operation: 'rent' | 'sale' | undefined;
  if (businessFunction.includes('lease') || businessFunction.includes('rent')) operation = 'rent';
  else if (businessFunction.includes('sell') || businessFunction.includes('sale')) operation = 'sale';

  return {
    types: ['Residence'],
    name: asString(candidate.name) ?? asString(candidate.title),
    description: asString(candidate.description),
    url: asString(candidate.url) ?? asString(candidate.detailUrl) ?? url,
    address: {
      street: asString(addressRecord.streetAddress) ?? asString(addressRecord.street),
      city: readNestedCity(candidate) ?? '',
      region: asString(addressRecord.addressRegion) ?? asString(addressRecord.region),
      postalCode: asString(addressRecord.postalCode),
      neighborhood: asString(addressRecord.addressSubLocality) ?? asString(addressRecord.neighborhood),
      countryCode: (() => {
        const country = asString(addressRecord.addressCountry);
        return country && country.length === 2 ? country.toUpperCase() : 'ES';
      })(),
    },
    coordinates:
      geo && asNumber(geo.latitude) !== undefined && asNumber(geo.longitude) !== undefined
        ? { lat: asNumber(geo.latitude) as number, lng: asNumber(geo.longitude) as number }
        : undefined,
    images: collectNestedImages(candidate),
    bedrooms:
      asNumber(candidate.numberOfRooms) ??
      asNumber(candidate.bedrooms) ??
      asNumber(candidate.rooms),
    bathrooms: asNumber(candidate.numberOfBathroomsTotal) ?? asNumber(candidate.bathrooms),
    squareMeters: isRecord(floorSize) ? asNumber(floorSize.value) : asNumber(floorSize),
    price,
    priceCurrency:
      asString(offer?.priceCurrency) ??
      asString(candidate.priceCurrency) ??
      asString(candidate.currency) ??
      'EUR',
    operation,
    amenities: [],
  };
}

function parseFotocasaNextData(html: string, url: string): EsSchemaListing | undefined {
  const match = html.match(NEXT_DATA_RE);
  if (!match?.[1]) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return undefined;
  }
  const candidate = findNextDataListing(parsed);
  if (!candidate) return undefined;
  const listing = listingFromNextDataCandidate(candidate, url);
  if (listing.price === undefined || !listing.address.city) return undefined;
  return listing;
}

/** The raw payload Fotocasa `fetch()` hands to `normalize()`. */
export interface FotocasaRaw {
  sourceId: string;
  url: string;
  listing: EsSchemaListing;
}

/** Match Fotocasa detail links (`…/<id>/d`) and capture the numeric id. */
const DETAIL_LINK_RE = /href=["']([^"']*\/(\d{6,})\/d)["']/gi;

/** Extract the stable listing id from a Fotocasa detail URL (`…/<id>/d`). */
export function fotocasaSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/(\d{6,})\/d\b/)?.[1] ?? url.match(/\/(\d{6,})(?:\/|$)/)?.[1];
}

/** Rent vs sale: prefer the JSON-LD offer, fall back to the URL (`/comprar`). */
function resolveOperation(listing: EsSchemaListing, url: string): 'rent' | 'sale' {
  if (listing.operation) return listing.operation;
  return url.includes('/comprar') || url.includes('/venta') ? 'sale' : 'rent';
}

/**
 * Parse a Fotocasa detail-page HTML into a {@link FotocasaRaw}. Throws when the
 * page carries no recognizable real-estate JSON-LD (delisted or a challenge
 * page served instead of content).
 */
export function parseFotocasaDetail(html: string, url: string): FotocasaRaw {
  const listing =
    pickEsListing(extractEsSchemaListings(html)) ?? parseFotocasaNextData(html, url);
  if (!listing) {
    throw new Error(`fotocasa: no real-estate JSON-LD found at ${url}`);
  }
  const canonicalUrl = listing.url ?? url;
  const sourceId = fotocasaSourceIdFromUrl(canonicalUrl) ?? fotocasaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`fotocasa: cannot derive a source id from ${url}`);
  }
  return {
    sourceId,
    url: canonicalUrl,
    listing: { ...listing, operation: resolveOperation(listing, canonicalUrl) },
  };
}

/**
 * Parse a Fotocasa search-results HTML into de-duplicated detail refs. Relative
 * links are resolved against {@link FOTOCASA_BASE_URL}; duplicates collapse by id.
 */
export function parseFotocasaSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const href = match[1];
    const sourceId = match[2];
    if (!href || !sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const url = href.startsWith('http') ? href : `${FOTOCASA_BASE_URL}${href}`;
    refs.push({ sourceId, url });
  }
  return refs;
}
