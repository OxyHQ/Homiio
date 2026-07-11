/**
 * schema.org JSON-LD extraction — ONE chokepoint for all markets.
 *
 * EUR markets (ES, IT, …) share {@link EurSchemaListing}; US markets use
 * {@link SchemaOrgListing}. Portal markup changes are fixed here.
 */

import { asCoordinate, asNumberEu, asNumberUs, asString, deaccent, isRecord } from './guards';

const LD_JSON_TYPE = 'application/ld+json';

/**
 * Iterate `<script type="application/ld+json">…</script>` bodies.
 * Index-based scan avoids polynomial-backtracking regex on large HTML.
 */
export function* ldJsonScriptBodies(html: string): Generator<string> {
  let pos = 0;
  while (pos < html.length) {
    const scriptOpen = html.indexOf('<script', pos);
    if (scriptOpen < 0) return;
    const tagClose = html.indexOf('>', scriptOpen);
    if (tagClose < 0) return;
    const openTag = html.slice(scriptOpen, tagClose + 1);
    pos = tagClose + 1;
    if (!openTag.toLowerCase().includes(LD_JSON_TYPE)) continue;
    const close = html.indexOf('</script>', pos);
    if (close < 0) return;
    const body = html.slice(pos, close).trim();
    if (body) yield body;
    pos = close + '</script>'.length;
  }
}

export interface EurSchemaListing {
  types: string[];
  name?: string;
  description?: string;
  url?: string;
  address: {
    street?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    neighborhood?: string;
    country?: string;
    countryCode?: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  price?: number;
  priceCurrency?: string;
  operation?: 'rent' | 'sale';
  amenities: string[];
  furnished?: boolean;
}

export type EsSchemaListing = EurSchemaListing;
export type ItSchemaListing = EurSchemaListing;

const ES_AMENITY_ALIASES: Readonly<Record<string, string>> = {
  ascensor: 'elevator',
  'aire acondicionado': 'air_conditioning',
  climatizacion: 'air_conditioning',
  calefaccion: 'heating',
  terraza: 'terrace',
  balcon: 'balcony',
  parking: 'parking',
  garaje: 'parking',
  piscina: 'pool',
  jardin: 'garden',
  trastero: 'storage',
  amueblado: 'furnished',
};

const IT_AMENITY_ALIASES: Readonly<Record<string, string>> = {
  ascensore: 'elevator',
  'aria condizionata': 'air_conditioning',
  climatizzazione: 'air_conditioning',
  riscaldamento: 'heating',
  terrazzo: 'terrace',
  terrazza: 'terrace',
  balcone: 'balcony',
  posto_auto: 'parking',
  garage: 'parking',
  parcheggio: 'parking',
  piscina: 'pool',
  giardino: 'garden',
  cantina: 'storage',
  arredato: 'furnished',
  arredata: 'furnished',
};

interface EurJsonLdConfig {
  defaultCountryCode: string;
  amenityAliases: Readonly<Record<string, string>>;
}

const ES_JSON_LD_CONFIG: EurJsonLdConfig = { defaultCountryCode: 'ES', amenityAliases: ES_AMENITY_ALIASES };
const IT_JSON_LD_CONFIG: EurJsonLdConfig = { defaultCountryCode: 'IT', amenityAliases: IT_AMENITY_ALIASES };

function normalizeAmenity(name: string, aliases: Readonly<Record<string, string>>): string {
  const key = deaccent(name);
  return aliases[key] ?? key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Canonical ES amenity key for a free-form label (e.g. a portal property-JSON
 * `features`/`extras` entry), or `undefined` when the label is not a recognized
 * amenity. Reuses the shared ES alias table — never duplicate it per portal.
 * `amueblado` resolves to `furnished`; callers hoist that into `furnishedStatus`.
 * Unlike {@link normalizeAmenity} it does NOT fall back to a snake_case slug, so
 * mixed "características" arrays (condition, orientation, …) don't leak as amenities.
 */
export function matchEsAmenityKey(label: string): string | undefined {
  return ES_AMENITY_ALIASES[deaccent(label)];
}

function readTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

function collectImages(value: unknown): string[] {
  const out: string[] = [];
  const push = (entry: unknown): void => {
    const direct = asString(entry);
    if (direct) {
      out.push(direct);
      return;
    }
    if (isRecord(entry)) {
      const url = asString(entry.url) ?? asString(entry.contentUrl);
      if (url) out.push(url);
    }
  };
  if (Array.isArray(value)) value.forEach(push);
  else push(value);
  return [...new Set(out)];
}

function readCountry(value: unknown): string | undefined {
  return asString(value) ?? (isRecord(value) ? asString(value.name) ?? asString(value['@id']) : undefined);
}

function readEurAddress(value: unknown, defaultCountryCode: string): EurSchemaListing['address'] {
  if (!isRecord(value)) return {};
  const country = readCountry(value.addressCountry);
  return {
    street: asString(value.streetAddress),
    city: asString(value.addressLocality),
    region: asString(value.addressRegion),
    postalCode: asString(value.postalCode),
    neighborhood: asString(value.addressSubLocality) ?? asString(value.neighborhood),
    country: country && country.length > 2 ? country : undefined,
    countryCode: country && country.length === 2 ? country.toUpperCase() : defaultCountryCode,
  };
}

function readCoordinates(value: unknown): EurSchemaListing['coordinates'] {
  if (!isRecord(value)) return undefined;
  const lat = asCoordinate(value.latitude);
  const lng = asCoordinate(value.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function readFloorSize(value: unknown): number | undefined {
  if (isRecord(value)) return asNumberEu(value.value);
  return asNumberEu(value);
}

function readEurOffer(value: unknown): { price?: number; currency?: string; operation?: 'rent' | 'sale' } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const businessFunction = asString(offer.businessFunction)?.toLowerCase() ?? '';
    let operation: 'rent' | 'sale' | undefined;
    if (businessFunction.includes('leaseout') || businessFunction.includes('rent') || businessFunction.includes('lease')) {
      operation = 'rent';
    } else if (businessFunction.includes('sell') || businessFunction.includes('sale')) {
      operation = 'sale';
    }
    const price = asNumberEu(offer.price);
    if (price !== undefined) return { price, currency: asString(offer.priceCurrency), operation };
    if (isRecord(offer.priceSpecification)) {
      const specPrice = asNumberEu(offer.priceSpecification.price);
      if (specPrice !== undefined) {
        return { price: specPrice, currency: asString(offer.priceSpecification.priceCurrency), operation };
      }
    }
  }
  return {};
}

function readAmenities(
  value: unknown,
  aliases: Readonly<Record<string, string>>,
): { amenities: string[]; furnished?: boolean } {
  const amenities: string[] = [];
  let furnished: boolean | undefined;
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name);
    if (!name) continue;
    if (entry.value === false) continue;
    const key = normalizeAmenity(name, aliases);
    if (key === 'furnished') {
      furnished = true;
      continue;
    }
    if (key) amenities.push(key);
  }
  return { amenities, furnished };
}

function readSubject(node: Record<string, unknown>): Record<string, unknown> {
  const nested = node.about ?? node.mainEntity;
  return isRecord(nested) ? nested : node;
}

function toEurListing(node: Record<string, unknown>, config: EurJsonLdConfig): EurSchemaListing {
  const subject = readSubject(node);
  const offer = readEurOffer(node.offers ?? subject.offers);
  const topLevelPrice = asNumberEu(node.price);
  const { amenities, furnished } = readAmenities(
    subject.amenityFeature ?? node.amenityFeature,
    config.amenityAliases,
  );
  const types = [...readTypes(node['@type']), ...readTypes(subject['@type'])];
  return {
    types,
    name: asString(node.name) ?? asString(subject.name),
    description: asString(node.description) ?? asString(subject.description),
    url: asString(node.url) ?? asString(subject.url),
    address: readEurAddress(subject.address ?? node.address, config.defaultCountryCode),
    coordinates: readCoordinates(subject.geo ?? node.geo),
    images: collectImages(subject.image ?? subject.photo ?? node.image ?? node.photo),
    bedrooms:
      asNumberEu(subject.numberOfRooms) ??
      asNumberEu(subject.numberOfBedrooms) ??
      asNumberEu(node.numberOfRooms) ??
      asNumberEu(node.numberOfBedrooms),
    bathrooms:
      asNumberEu(subject.numberOfBathroomsTotal) ??
      asNumberEu(subject.numberOfBathrooms) ??
      asNumberEu(node.numberOfBathroomsTotal) ??
      asNumberEu(node.numberOfBathrooms),
    squareMeters: readFloorSize(subject.floorSize ?? node.floorSize),
    price: offer.price ?? topLevelPrice,
    priceCurrency: offer.currency ?? asString(node.priceCurrency),
    operation: offer.operation,
    amenities,
    furnished,
  };
}

function collectNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectNodes(entry, out);
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value['@graph'])) {
    collectNodes(value['@graph'], out);
    return;
  }
  // Unwrap ItemList / SearchResultsPage nesting (Lamudi MX, …).
  if (Array.isArray(value.itemListElement)) {
    for (const entry of value.itemListElement) {
      if (isRecord(entry) && isRecord(entry.item)) collectNodes(entry.item, out);
      else collectNodes(entry, out);
    }
  }
  if (value.mainEntity !== undefined) {
    collectNodes(value.mainEntity, out);
  }
  out.push(value);
}

/** Collect every record node from LD+JSON script blocks. */
export function collectJsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const body of ldJsonScriptBodies(html)) {
    try {
      collectNodes(JSON.parse(body) as unknown, nodes);
    } catch {
      continue;
    }
  }
  return nodes;
}

export function jsonLdTypes(node: Record<string, unknown>): string[] {
  return readTypes(node['@type']);
}

export function resolveJsonLdRef(
  nodes: readonly Record<string, unknown>[],
  ref: unknown,
): Record<string, unknown> | undefined {
  if (isRecord(ref) && !ref['@id'] && Object.keys(ref).length > 1) return ref;
  const id = isRecord(ref)
    ? typeof ref['@id'] === 'string'
      ? ref['@id']
      : undefined
    : typeof ref === 'string'
      ? ref
      : undefined;
  if (!id) return undefined;
  return nodes.find((node) => node['@id'] === id);
}

export function findJsonLdByType(
  nodes: readonly Record<string, unknown>[],
  typeName: string,
): Record<string, unknown> | undefined {
  return nodes.find((node) => jsonLdTypes(node).includes(typeName));
}

function extractEurSchemaListings(html: string, config: EurJsonLdConfig): EurSchemaListing[] {
  const nodes: Record<string, unknown>[] = [];
  for (const body of ldJsonScriptBodies(html)) {
    try {
      collectNodes(JSON.parse(body) as unknown, nodes);
    } catch {
      continue;
    }
  }
  return nodes.map((node) => toEurListing(node, config));
}

function isEurListingLike(listing: EurSchemaListing): boolean {
  return listing.price !== undefined && Boolean(listing.address.city);
}

function pickEurListing(listings: EurSchemaListing[]): EurSchemaListing | undefined {
  return listings.find(isEurListingLike) ?? listings.find((listing) => listing.price !== undefined);
}

export function extractEsSchemaListings(html: string): EurSchemaListing[] {
  return extractEurSchemaListings(html, ES_JSON_LD_CONFIG);
}

export function pickEsListing(listings: EurSchemaListing[]): EurSchemaListing | undefined {
  return pickEurListing(listings);
}

export function extractItSchemaListings(html: string): EurSchemaListing[] {
  return extractEurSchemaListings(html, IT_JSON_LD_CONFIG);
}

export function pickItListing(listings: EurSchemaListing[]): EurSchemaListing | undefined {
  return pickEurListing(listings);
}

export interface SchemaOrgListing {
  types: string[];
  name?: string;
  description?: string;
  url?: string;
  address: {
    street?: string;
    locality?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  price?: number;
  priceCurrency?: string;
  priceRange?: string;
}

function readUsAddress(value: unknown): SchemaOrgListing['address'] {
  if (!isRecord(value)) return {};
  return {
    street: asString(value.streetAddress),
    locality: asString(value.addressLocality),
    region: asString(value.addressRegion),
    postalCode: asString(value.postalCode),
    country: asString(value.addressCountry) ?? (isRecord(value.addressCountry) ? asString(value.addressCountry.name) : undefined),
  };
}

function readUsCoordinates(value: unknown): SchemaOrgListing['coordinates'] {
  if (!isRecord(value)) return undefined;
  const lat = asCoordinate(value.latitude);
  const lng = asCoordinate(value.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function readUsFloorSize(value: unknown): number | undefined {
  if (isRecord(value)) return asNumberUs(value.value);
  return asNumberUs(value);
}

function readUsOffer(value: unknown): { price?: number; priceCurrency?: string } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const price = asNumberUs(offer.price);
    if (price !== undefined) {
      return { price, priceCurrency: asString(offer.priceCurrency) };
    }
    if (isRecord(offer.priceSpecification)) {
      const specPrice = asNumberUs(offer.priceSpecification.price);
      if (specPrice !== undefined) {
        return { price: specPrice, priceCurrency: asString(offer.priceSpecification.priceCurrency) };
      }
    }
  }
  return {};
}

function toUsListing(node: Record<string, unknown>): SchemaOrgListing {
  const offer = readUsOffer(node.offers);
  const bathrooms =
    asNumberUs(node.numberOfBathroomsTotal) ??
    asNumberUs(node.numberOfBathrooms) ??
    asNumberUs(node.numberOfFullBathrooms);
  return {
    types: readTypes(node['@type']),
    name: asString(node.name),
    description: asString(node.description),
    url: asString(node.url),
    address: readUsAddress(node.address),
    coordinates: readUsCoordinates(node.geo),
    images: collectImages(node.image ?? node.photo),
    bedrooms: asNumberUs(node.numberOfBedrooms) ?? asNumberUs(node.numberOfRooms),
    bathrooms,
    squareFootage: readUsFloorSize(node.floorSize),
    price: offer.price,
    priceCurrency: offer.priceCurrency,
    priceRange: asString(node.priceRange),
  };
}

export function extractSchemaOrgListings(html: string): SchemaOrgListing[] {
  const nodes: Record<string, unknown>[] = [];
  for (const body of ldJsonScriptBodies(html)) {
    try {
      collectNodes(JSON.parse(body) as unknown, nodes);
    } catch {
      continue;
    }
  }
  return nodes.map(toUsListing);
}

function hasUsableAddress(listing: SchemaOrgListing): boolean {
  return Boolean(listing.address.locality) && Boolean(listing.address.street ?? listing.address.locality);
}

export function pickPrimaryListing(listings: SchemaOrgListing[]): SchemaOrgListing | undefined {
  const withStreet = listings.find((listing) => listing.address.street && listing.address.locality);
  if (withStreet) return withStreet;
  const withLocality = listings.find(hasUsableAddress);
  if (withLocality) return withLocality;
  return listings[0];
}
