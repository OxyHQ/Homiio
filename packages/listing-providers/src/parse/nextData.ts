/**
 * Next.js `__NEXT_DATA__` / embedded page-model extraction.
 */

import { asNumberEu, asString, isRecord } from './guards';
import type { EurSchemaListing } from './jsonLd';
import {
  extractNextData,
  findNextDataArray,
  findNextDataRecord,
  nextDataPageProps,
  parseNextData,
  parseNextDataPageProps,
  parsePreloadedState,
} from '../nextData';

export {
  extractNextData,
  findNextDataArray,
  findNextDataRecord,
  nextDataPageProps,
  parseNextData,
  parseNextDataPageProps,
  parsePreloadedState,
};

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

function looksLikeListing(record: Record<string, unknown>): boolean {
  const price = readNestedPrice(record);
  const city = readNestedCity(record);
  return price !== undefined && !!city;
}

export function eurListingFromNextDataCandidate(
  record: Record<string, unknown>,
  options: { url?: string; defaultCountryCode?: string } = {},
): EurSchemaListing | undefined {
  if (!looksLikeListing(record)) return undefined;
  const addressNode = isRecord(record.address) ? record.address : undefined;
  const location = isRecord(record.location) ? record.location : undefined;
  const city = readNestedCity(record);
  if (!city) return undefined;
  const price = readNestedPrice(record);
  const street =
    asString(addressNode?.streetAddress) ??
    asString(addressNode?.street) ??
    asString(record.street);
  const region =
    asString(addressNode?.addressRegion) ??
    asString(addressNode?.region) ??
    asString(location?.region);
  const postalCode =
    asString(addressNode?.postalCode) ?? asString(record.postalCode);
  const neighborhood =
    asString(addressNode?.neighborhood) ??
    asString(location?.neighborhood) ??
    asString(record.neighborhood);
  const geo = isRecord(record.geo)
    ? record.geo
    : isRecord(location?.coordinates)
      ? location.coordinates
      : undefined;
  const lat = asNumberEu(geo?.latitude) ?? asNumberEu(geo?.lat);
  const lng = asNumberEu(geo?.longitude) ?? asNumberEu(geo?.lng) ?? asNumberEu(geo?.lon);
  const business = asString(isRecord(record.offers) ? record.offers.businessFunction : undefined)?.toLowerCase() ?? '';
  const operation: 'rent' | 'sale' | undefined = /sell|sale|buy|venta|comprar/i.test(business)
    ? 'sale'
    : /rent|lease|alquiler/i.test(business)
      ? 'rent'
      : undefined;

  return {
    types: ['Product'],
    name: asString(record.name) ?? asString(record.title),
    description: asString(record.description),
    url: asString(record.url) ?? options.url,
    address: {
      street,
      city,
      region,
      postalCode,
      neighborhood,
      countryCode: options.defaultCountryCode ?? 'ES',
    },
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    images: collectNestedImages(record),
    bedrooms: asNumberEu(record.numberOfRooms) ?? asNumberEu(record.bedrooms) ?? asNumberEu(record.rooms),
    bathrooms: asNumberEu(record.numberOfBathroomsTotal) ?? asNumberEu(record.bathrooms),
    squareMeters: asNumberEu(isRecord(record.floorSize) ? record.floorSize.value : record.floorSize) ?? asNumberEu(record.surface),
    price,
    priceCurrency: asString(isRecord(record.offers) ? record.offers.priceCurrency : undefined) ?? 'EUR',
    operation,
    amenities: [],
  };
}

/** Walk `__NEXT_DATA__` for the first EUR-shaped listing (Fotocasa fallback). */
export function extractEurListingFromNextData(
  html: string,
  options: { url?: string; defaultCountryCode?: string } = {},
): EurSchemaListing | undefined {
  const root = parseNextData(html);
  if (!root) return undefined;
  const pageProps = nextDataPageProps(root) ?? root;
  const candidate = findNextDataRecord(pageProps, (value): value is Record<string, unknown> =>
    looksLikeListing(value),
  );
  if (!candidate) return undefined;
  return eurListingFromNextDataCandidate(candidate, options);
}
