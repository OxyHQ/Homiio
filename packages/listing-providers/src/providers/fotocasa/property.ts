/**
 * Fotocasa property JSON API helpers (pure parsing + URL building).
 *
 * Detail listings are available at `web.gw.fotocasa.es/v2/propertysearch/property`
 * once a PerimeterX session is warm. Cold HTTP returns 403/challenge HTML — never
 * parse JSON-LD from those bodies.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { matchEsAmenityKey, matchFeatureKeyAmenity, type EsSchemaListing } from '../../parse/jsonLd';
import { asCoordinate, asNumberEu, asString, isRecord } from '../../parse/guards';
import { buildContact, contactFromUnknown, mergeContact } from '../../parse/contact';
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
  // Searchads cards carry a clean numeric `rawPrice` (2193) plus a formatted
  // `price` ("2.193 €"); prefer the raw number, then the formatted/nested string.
  return asNumberEu(transaction?.price) ?? asNumberEu(record.rawPrice) ?? readNestedPrice(record);
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
 * Extract canonical amenities + the furnished flag from a Fotocasa record.
 * Handles BOTH real shapes carried by `features[]` (or the other
 * {@link FOTOCASA_FEATURE_FIELDS}):
 *
 *   - searchads cards / gateway JSON — English snake_case keys with an internal
 *     id `value` (`{ key: "air_conditioner", value: 1 }`); presence in the array
 *     means the amenity is present. Resolved via {@link matchFeatureKeyAmenity}.
 *   - property JSON (`language=es`) — localized labels with a boolean/absent
 *     `value` (`{ name: "Ascensor", value: true }`). Resolved via
 *     {@link matchEsAmenityKey}; entries flagged `value: false` are skipped.
 *
 * Both resolve to the SAME canonical slug vocabulary; unrecognized keys
 * (dimensions, `conservationStatus`, `antiquity`, …) are dropped, and
 * `furnished`/`not_furnished` are hoisted into the furnished flag rather than
 * leaked as amenities.
 */
function readFotocasaAmenities(record: Record<string, unknown>): {
  amenities: string[];
  furnished?: boolean;
} {
  const amenities: string[] = [];
  const seen = new Set<string>();
  let furnished: boolean | undefined;

  const add = (key: string): void => {
    if (!seen.has(key)) {
      seen.add(key);
      amenities.push(key);
    }
  };

  const consider = (rawKey: string | undefined, label: string | undefined, present: unknown): void => {
    // Property-JSON marks an absent amenity with `value: false`; searchads cards
    // never do (their `value` is a positive internal id), so this only prunes the
    // localized shape.
    if (present === false) return;

    if (rawKey) {
      const lowered = rawKey.trim().toLowerCase();
      if (lowered === 'furnished') {
        furnished = true;
        return;
      }
      if (lowered === 'not_furnished' || lowered === 'unfurnished') {
        furnished = false;
        return;
      }
      const canonical = matchFeatureKeyAmenity(rawKey);
      if (canonical) {
        if (canonical === 'furnished') furnished = true;
        else add(canonical);
        return;
      }
    }

    const text = label ?? rawKey;
    if (!text) return;
    const key = matchEsAmenityKey(text);
    if (!key) return;
    if (key === 'furnished') furnished = true;
    else add(key);
  };

  for (const field of FOTOCASA_FEATURE_FIELDS) {
    const value = record[field];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string') {
        consider(undefined, entry, true);
      } else if (isRecord(entry)) {
        const label = asString(entry.name) ?? asString(entry.label) ?? asString(entry.type);
        consider(asString(entry.key), label, 'value' in entry ? entry.value : true);
      }
    }
  }

  return { amenities, furnished };
}

/**
 * Read a numeric dimension the searchads card / gateway JSON stores inside
 * `features[]` as `{ key, value }` (e.g. `{ key: "surface", value: 223 }`).
 * Returns the first matching key's numeric value, or `undefined`.
 */
function fotocasaFeatureNumber(record: Record<string, unknown>, ...keys: readonly string[]): number | undefined {
  const features = record.features;
  if (!Array.isArray(features)) return undefined;
  const wanted = new Set(keys);
  for (const entry of features) {
    if (!isRecord(entry)) continue;
    const key = asString(entry.key);
    if (key && wanted.has(key)) {
      const num = asNumberEu(entry.value);
      if (num !== undefined) return num;
    }
  }
  return undefined;
}

/**
 * Floor number from a Fotocasa record. Searchads cards carry it inside
 * `features[]` as `{ key: "floor", value: 10 }`; property JSON may expose a
 * top-level field. `floor: 0` (ground floor / bajo) is a valid value.
 */
function readFotocasaFloor(record: Record<string, unknown>): number | undefined {
  return (
    asNumberEu(record.floor) ??
    asNumberEu(record.floorNumber) ??
    asNumberEu(record.planta) ??
    fotocasaFeatureNumber(record, 'floor')
  );
}

/**
 * Map a Fotocasa `clientType` (`professional` / `private`) to the contact kind.
 */
function fotocasaContactKind(record: Record<string, unknown>): NormalizedListingContact['kind'] | undefined {
  const raw = asString(record.clientType)?.toLowerCase();
  if (!raw) return undefined;
  if (/professional|agency|agencia|inmobiliaria|pro/.test(raw)) return 'agency';
  if (/private|particular|owner|individual/.test(raw)) return 'private';
  return undefined;
}

/**
 * Advertiser contact from a Fotocasa record (phone/email/agency).
 *
 * Searchads cards expose the advertiser as TOP-LEVEL scalars — `phone`,
 * `clientAlias` (agency name), `clientType` — so build a contact from those
 * first, then merge any wrapper nodes the property JSON uses. Delegates to the
 * shared contact chokepoint; never invents a contact when the record omits one.
 */
function readFotocasaContact(record: Record<string, unknown>): NormalizedListingContact | undefined {
  const cardContact = buildContact({
    phone: asString(record.phone),
    agencyName: asString(record.clientAlias),
    kind: fotocasaContactKind(record),
  });
  return mergeContact(
    cardContact,
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
  // Searchads cards nest lat/lng under `coordinates` (their `location` field is a
  // free-text neighborhood string); property JSON uses a `location` object.
  const geoNode = isRecord(record.coordinates)
    ? record.coordinates
    : isRecord(record.location)
      ? record.location
      : undefined;
  const lat = asCoordinate(geoNode?.latitude);
  const lng = asCoordinate(geoNode?.longitude);
  // Searchads cards carry the detail path as a locale map (`detail["es-ES"]`).
  const detailNode = isRecord(record.detail) ? record.detail : undefined;
  const detailUrl =
    asString(record.detailUrl) ??
    asString(record.url) ??
    asString(detailNode?.['es-ES']) ??
    (detailNode ? asString(Object.values(detailNode)[0]) : undefined) ??
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
      postalCode: asString(addressNode?.postalCode) ?? asString(addressNode?.zipCode),
      neighborhood: asString(addressNode?.neighborhood) ?? asString(addressNode?.district),
      country: asString(addressNode?.country),
      countryCode: 'ES',
    },
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    images,
    bedrooms:
      asNumberEu(record.rooms) ??
      asNumberEu(record.numberOfRooms) ??
      fotocasaFeatureNumber(record, 'rooms', 'bedrooms'),
    bathrooms:
      asNumberEu(record.baths) ??
      asNumberEu(record.bathrooms) ??
      fotocasaFeatureNumber(record, 'bathrooms', 'baths'),
    squareMeters: asNumberEu(record.surface) ?? fotocasaFeatureNumber(record, 'surface'),
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
