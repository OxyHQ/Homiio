/**
 * Fotocasa property JSON API helpers (pure parsing + URL building).
 *
 * Detail listings are available at `web.gw.fotocasa.es/v2/propertysearch/property`
 * once a PerimeterX session is warm. Cold HTTP returns 403/challenge HTML — never
 * parse JSON-LD from those bodies.
 */

import type { EsSchemaListing } from '../../parse/jsonLd';
import { asNumberEu, asString, isRecord } from '../../parse/guards';
import {
  collectNestedImages,
  eurListingFromNextDataCandidate,
  findNextDataRecord,
  readNestedCity,
  readNestedPrice,
} from '../../parse/nextData';
import { FOTOCASA_BASE_URL } from './fixtures';
import { fotocasaSourceIdFromUrl, type FotocasaRaw } from './parse';
import { isFotocasaSearchadsChallenge } from './searchads';

export { fotocasaPropertyApiUrl } from './searchads';

/** PerimeterX / DataDome challenge bodies served instead of property JSON. */
export function isFotocasaPropertyChallenge(body: string): boolean {
  return isFotocasaSearchadsChallenge(body);
}

function readFotocasaPrice(record: Record<string, unknown>): number | undefined {
  const transaction = isRecord(record.transaction) ? record.transaction : undefined;
  return asNumberEu(transaction?.price) ?? readNestedPrice(record);
}

function readFotocasaCity(record: Record<string, unknown>): string | undefined {
  const addressNode = isRecord(record.address) ? record.address : undefined;
  if (addressNode) {
    return (
      asString(addressNode.municipality) ??
      asString(addressNode.addressLocality) ??
      asString(addressNode.city) ??
      asString(addressNode.locality)
    );
  }
  return readNestedCity(record);
}

function resolveOperation(record: Record<string, unknown>, url: string): 'rent' | 'sale' {
  const transaction = isRecord(record.transaction) ? record.transaction : undefined;
  const txType = asString(transaction?.type)?.toUpperCase();
  if (txType === 'BUY' || txType === 'SALE') return 'sale';
  if (txType === 'RENT') return 'rent';
  const operation = asString(record.operation)?.toLowerCase();
  if (operation === 'sale' || operation === 'buy') return 'sale';
  if (operation === 'rent') return 'rent';
  return url.includes('/comprar') || url.includes('/venta') ? 'sale' : 'rent';
}

function fotocasaRecordToListing(
  record: Record<string, unknown>,
  url: string,
): EsSchemaListing | undefined {
  const price = readFotocasaPrice(record);
  const city = readFotocasaCity(record);
  if (price === undefined || !city) {
    const fromNext = eurListingFromNextDataCandidate(record, { url, defaultCountryCode: 'ES' });
    if (!fromNext) return undefined;
    return { ...fromNext, operation: resolveOperation(record, url) };
  }

  const operation = resolveOperation(record, url);
  const addressNode = isRecord(record.address) ? record.address : undefined;
  const location = isRecord(record.location) ? record.location : undefined;
  const lat = asNumberEu(location?.latitude);
  const lng = asNumberEu(location?.longitude);
  const detailUrl =
    asString(record.detailUrl) ??
    asString(record.url) ??
    (Array.isArray(record.uris)
      ? asString((record.uris[0] as Record<string, unknown> | undefined)?.value)
      : undefined);
  const canonicalUrl = detailUrl
    ? detailUrl.startsWith('http')
      ? detailUrl
      : `${FOTOCASA_BASE_URL}${detailUrl}`
    : url;
  const streetParts = [asString(record.street), asString(record.number)].filter(Boolean).join(' ').trim();
  const images = collectNestedImages(record);

  return {
    types: [asString(record.buildingType) ?? 'Apartment'],
    name: asString(record.title) ?? asString(record.name),
    description: asString(record.description),
    url: canonicalUrl,
    address: {
      street: streetParts.length > 0 ? streetParts : undefined,
      city,
      region: asString(addressNode?.province) ?? asString(addressNode?.region),
      neighborhood: asString(addressNode?.district) ?? asString(addressNode?.neighborhood),
      country: asString(addressNode?.country),
      countryCode: 'ES',
    },
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    images,
    bedrooms: asNumberEu(record.rooms) ?? asNumberEu(record.numberOfRooms),
    bathrooms: asNumberEu(record.baths) ?? asNumberEu(record.bathrooms),
    squareMeters: asNumberEu(record.surface),
    price,
    priceCurrency: 'EUR',
    operation,
    amenities: [],
  };
}

function findPropertyRecord(parsed: unknown): Record<string, unknown> | undefined {
  if (!isRecord(parsed)) return undefined;
  if (
    readFotocasaPrice(parsed) !== undefined ||
    asString(parsed.propertyId) ||
    asString(parsed.id)
  ) {
    return parsed;
  }
  return findNextDataRecord(parsed, (value) => {
    return (
      readFotocasaPrice(value) !== undefined ||
      !!asString(value.propertyId) ||
      !!asString(value.realEstateId)
    );
  });
}

/**
 * Parse a Fotocasa `/property` JSON body into {@link FotocasaRaw}. Throws when
 * the body is a challenge page or carries no recognizable listing fields.
 */
export function parseFotocasaPropertyJson(body: string, url: string): FotocasaRaw {
  const trimmed = body.trim();
  if (trimmed.length === 0 || isFotocasaPropertyChallenge(trimmed)) {
    throw new Error(`fotocasa: property API challenge at ${url}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`fotocasa: property API returned non-JSON at ${url}`);
  }

  const record = findPropertyRecord(parsed);
  if (!record) {
    throw new Error(`fotocasa: property API payload has no listing at ${url}`);
  }

  const listing = fotocasaRecordToListing(record, url);
  if (!listing || listing.price === undefined) {
    throw new Error(`fotocasa: property API listing has no resolvable price at ${url}`);
  }

  const rawId = asString(record.propertyId) ?? asString(record.id) ?? asString(record.realEstateId);
  const sourceId =
    rawId?.replace(/\D/g, '') ??
    fotocasaSourceIdFromUrl(listing.url ?? url) ??
    fotocasaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`fotocasa: cannot derive a source id from property API at ${url}`);
  }

  return {
    sourceId,
    url: listing.url ?? url,
    listing,
  };
}
