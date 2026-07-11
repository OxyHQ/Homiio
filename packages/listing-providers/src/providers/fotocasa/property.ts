/**
 * Fotocasa property JSON API helpers (pure parsing + URL building).
 *
 * Detail listings are available at `web.gw.fotocasa.es/v2/propertysearch/property`
 * once a PerimeterX session is warm. Cold HTTP returns 403/challenge HTML — never
 * parse JSON-LD from those bodies.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { matchEsAmenityKey, type EsSchemaListing } from '../../parse/jsonLd';
import { asCoordinate, asNumberEu, asString, isRecord } from '../../parse/guards';
import { contactFromUnknown, mergeContact } from '../../parse/contact';
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

/** Feature/equipment arrays a Fotocasa property-JSON (`language=es`) record may carry. */
const FOTOCASA_FEATURE_FIELDS = ['features', 'otherFeatures', 'equipment', 'extras'] as const;

/**
 * Extract canonical amenities + the furnished flag from a Fotocasa property-JSON
 * record. Reads localized feature labels (the property API is called with
 * `language=es`) from any of {@link FOTOCASA_FEATURE_FIELDS}, skipping entries the
 * portal marks absent (`value: false`/`0`). Labels are normalized through the
 * shared {@link matchEsAmenityKey} alias table, so unrecognized "características"
 * (condition, orientation, …) are dropped rather than leaked as junk amenities.
 */
function readFotocasaAmenities(record: Record<string, unknown>): {
  amenities: string[];
  furnished?: boolean;
} {
  const amenities: string[] = [];
  const seen = new Set<string>();
  let furnished: boolean | undefined;

  const consider = (label: unknown, present: unknown): void => {
    if (present === false || present === 0) return;
    const text = asString(label);
    if (!text) return;
    const key = matchEsAmenityKey(text);
    if (!key) return;
    if (key === 'furnished') {
      furnished = true;
      return;
    }
    if (!seen.has(key)) {
      seen.add(key);
      amenities.push(key);
    }
  };

  for (const field of FOTOCASA_FEATURE_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string') {
        consider(entry, true);
      } else if (isRecord(entry)) {
        const label =
          asString(entry.name) ?? asString(entry.label) ?? asString(entry.key) ?? asString(entry.type);
        consider(label, 'value' in entry ? entry.value : true);
      }
    }
  }

  return { amenities, furnished };
}

/** Floor number from a Fotocasa property-JSON record, when numerically resolvable. */
function readFotocasaFloor(record: Record<string, unknown>): number | undefined {
  return asNumberEu(record.floor) ?? asNumberEu(record.floorNumber) ?? asNumberEu(record.planta);
}

/**
 * Advertiser contact from a Fotocasa property-JSON record (phone/email/agency).
 * Probes the wrapper nodes Fotocasa uses and delegates parsing to the shared
 * contact chokepoint — never invents a contact when the record omits one.
 */
function readFotocasaContact(record: Record<string, unknown>): NormalizedListingContact | undefined {
  return mergeContact(
    contactFromUnknown(record.contactInfo),
    contactFromUnknown(record.advertiser),
    contactFromUnknown(record.contact),
    contactFromUnknown(record.agency),
    contactFromUnknown(record.client),
  );
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
  const lat = asCoordinate(location?.latitude);
  const lng = asCoordinate(location?.longitude);
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
  const { amenities, furnished } = readFotocasaAmenities(record);

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
    amenities,
    furnished,
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
 * Parse a searchads card record (from `realEstates[]`) into {@link FotocasaRaw}.
 * Used when the property JSON API is PerimeterX-blocked but discover captured
 * enough fields from searchads to publish.
 */
export function parseFotocasaSearchCardRecord(
  record: Record<string, unknown>,
  url: string,
  fallbackCity?: string,
): FotocasaRaw {
  const enriched: Record<string, unknown> = { ...record };
  const addressNode = isRecord(enriched.address) ? { ...enriched.address } : {};
  if (fallbackCity && !readFotocasaCity(enriched) && !readFotocasaCity({ address: addressNode })) {
    addressNode.municipality = fallbackCity;
    enriched.address = addressNode;
  }

  const listing = fotocasaRecordToListing(enriched, url);
  if (!listing || listing.price === undefined) {
    throw new Error(`fotocasa: searchads card has no resolvable price at ${url}`);
  }

  const rawId =
    asString(enriched.propertyId) ?? asString(enriched.id) ?? asString(enriched.realEstateId);
  const sourceId =
    rawId?.replace(/\D/g, '') ??
    fotocasaSourceIdFromUrl(listing.url ?? url) ??
    fotocasaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`fotocasa: cannot derive a source id from searchads card at ${url}`);
  }

  const raw: FotocasaRaw = {
    sourceId,
    url: listing.url ?? url,
    listing,
  };
  const floor = readFotocasaFloor(enriched);
  if (floor !== undefined) raw.floor = floor;
  const contact = readFotocasaContact(enriched);
  if (contact) raw.contact = contact;
  return raw;
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

  const raw: FotocasaRaw = {
    sourceId,
    url: listing.url ?? url,
    listing,
  };
  const floor = readFotocasaFloor(record);
  if (floor !== undefined) raw.floor = floor;
  const contact = readFotocasaContact(record);
  if (contact) raw.contact = contact;
  return raw;
}
