/**
 * Next.js `__NEXT_DATA__` / embedded page-model extraction.
 *
 * Fotocasa and other Next portals sometimes ship listing data only in the
 * hydration payload when JSON-LD is absent.
 */

import { asNumberEu, asString, isRecord } from './guards';
import type { EurSchemaListing } from './jsonLd';

export const NEXT_DATA_RE =
  /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;

export const PAGE_MODEL_RE =
  /<script[^>]*id=["']__PAGE_MODEL__["'][^>]*>([\s\S]*?)<\/script>/i;

export function readNestedPrice(record: Record<string, unknown>): number | undefined {
  const direct =
    asNumberEu(record.price) ??
    asNumberEu(record.rent) ??
    asNumberEu(record.monthlyPrice) ??
    asNumberEu(record.priceRent);
  if (direct !== undefined) return direct;
  if (isRecord(record.price)) {
    return asNumberEu(record.price.amount) ?? asNumberEu(record.price.value);
  }
  if (isRecord(record.offers)) {
    return asNumberEu(record.offers.price) ?? asNumberEu(record.offers.amount);
  }
  if (isRecord(record.pricing)) {
    return asNumberEu(record.pricing.amount) ?? asNumberEu(record.pricing.price);
  }
  return undefined;
}

export function readNestedCity(record: Record<string, unknown>): string | undefined {
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

export function collectNestedImages(record: Record<string, unknown>): string[] {
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

function findNestedListing(node: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 14) return undefined;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findNestedListing(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  const price = readNestedPrice(node);
  const city = readNestedCity(node);
  if (price !== undefined && city) return node;
  for (const value of Object.values(node)) {
    const found = findNestedListing(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

export interface NextDataListingOptions {
  url: string;
  defaultCountryCode?: string;
  defaultCurrency?: string;
}

/** Map a Next.js page-model listing node onto {@link EurSchemaListing}. */
export function eurListingFromNextDataCandidate(
  candidate: Record<string, unknown>,
  options: NextDataListingOptions,
): EurSchemaListing {
  const addressRecord = isRecord(candidate.address) ? candidate.address : {};
  const geo = isRecord(candidate.geo) ? candidate.geo : isRecord(addressRecord.geo) ? addressRecord.geo : undefined;
  const floorSize = isRecord(candidate.floorSize) ? candidate.floorSize : candidate.surface;
  const price = readNestedPrice(candidate);
  const offer = isRecord(candidate.offers) ? candidate.offers : undefined;
  const businessFunction = asString(offer?.businessFunction)?.toLowerCase() ?? '';
  let operation: 'rent' | 'sale' | undefined;
  if (businessFunction.includes('lease') || businessFunction.includes('rent')) operation = 'rent';
  else if (businessFunction.includes('sell') || businessFunction.includes('sale')) operation = 'sale';

  const country = asString(addressRecord.addressCountry);
  const defaultCountry = options.defaultCountryCode ?? 'ES';

  return {
    types: ['Residence'],
    name: asString(candidate.name) ?? asString(candidate.title),
    description: asString(candidate.description),
    url: asString(candidate.url) ?? asString(candidate.detailUrl) ?? options.url,
    address: {
      street: asString(addressRecord.streetAddress) ?? asString(addressRecord.street),
      city: readNestedCity(candidate) ?? '',
      region: asString(addressRecord.addressRegion) ?? asString(addressRecord.region),
      postalCode: asString(addressRecord.postalCode),
      neighborhood: asString(addressRecord.addressSubLocality) ?? asString(addressRecord.neighborhood),
      countryCode: country && country.length === 2 ? country.toUpperCase() : defaultCountry,
    },
    coordinates:
      geo && asNumberEu(geo.latitude) !== undefined && asNumberEu(geo.longitude) !== undefined
        ? { lat: asNumberEu(geo.latitude) as number, lng: asNumberEu(geo.longitude) as number }
        : undefined,
    images: collectNestedImages(candidate),
    bedrooms:
      asNumberEu(candidate.numberOfRooms) ??
      asNumberEu(candidate.bedrooms) ??
      asNumberEu(candidate.rooms),
    bathrooms: asNumberEu(candidate.numberOfBathroomsTotal) ?? asNumberEu(candidate.bathrooms),
    squareMeters: isRecord(floorSize) ? asNumberEu(floorSize.value) : asNumberEu(floorSize),
    price,
    priceCurrency:
      asString(offer?.priceCurrency) ??
      asString(candidate.priceCurrency) ??
      asString(candidate.currency) ??
      options.defaultCurrency ??
      'EUR',
    operation,
    amenities: [],
  };
}

function parseEmbeddedJsonBlock(html: string, pattern: RegExp): unknown | undefined {
  const match = html.match(pattern);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Extract a EUR listing from `__NEXT_DATA__` or `__PAGE_MODEL__` when JSON-LD is absent.
 * Returns undefined when no price+city node is found.
 */
export function extractEurListingFromNextData(
  html: string,
  options: NextDataListingOptions,
): EurSchemaListing | undefined {
  const parsed =
    parseEmbeddedJsonBlock(html, NEXT_DATA_RE) ?? parseEmbeddedJsonBlock(html, PAGE_MODEL_RE);
  if (!parsed) return undefined;
  const candidate = findNestedListing(parsed);
  if (!candidate) return undefined;
  const listing = eurListingFromNextDataCandidate(candidate, options);
  if (listing.price === undefined || !listing.address.city) return undefined;
  return listing;
}
