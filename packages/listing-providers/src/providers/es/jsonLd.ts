/**
 * schema.org JSON-LD extraction for the Spanish portals (Idealista, Fotocasa).
 *
 * Both portals ship SEO `<script type="application/ld+json">` blocks describing
 * the listing as schema.org real-estate types (`Residence`, `Apartment`,
 * `House`, `Product`, `Offer`, …). This module is the ONE parsing chokepoint the
 * ES providers share: it pulls those blocks out of raw HTML and flattens them
 * into a provider-agnostic {@link EsSchemaListing} with EUR pricing, Spanish
 * amenity normalization and region/neighborhood fields — so a portal markup
 * change is fixed in a single place.
 *
 * It is deliberately defensive and DOM-free (regex over the LD+JSON blocks +
 * typed guards): every field is narrowed through a guard, so malformed/partial
 * payloads degrade to missing fields rather than throwing. This mirrors the US
 * `../us/jsonLd` helper, kept separate because ES needs EUR + region +
 * amenities where US needs sqft + state.
 */

/** A listing flattened from one or more schema.org JSON-LD nodes. */
export interface EsSchemaListing {
  /** Every `@type` seen for this node. */
  types: string[];
  name?: string;
  description?: string;
  url?: string;
  address: {
    street?: string;
    city?: string;
    /** Province / autonomous community. */
    region?: string;
    postalCode?: string;
    neighborhood?: string;
    country?: string;
    /** ISO-2 code when derivable (defaults to ES for these portals). */
    countryCode?: string;
  };
  coordinates?: { lat: number; lng: number };
  /** Absolute source image URLs (never hotlinked — re-hosted at ingest). */
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  /** Living area in square metres (ES portals report `floorSize` in m²). */
  squareMeters?: number;
  price?: number;
  priceCurrency?: string;
  /** Rent vs sale, inferred from the offer's businessFunction when present. */
  operation?: 'rent' | 'sale';
  amenities: string[];
  furnished?: boolean;
}

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Spanish → canonical amenity keys; unknown names fall back to a slug. */
const AMENITY_ALIASES: Readonly<Record<string, string>> = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Coerce a schema.org numeric-ish value (number or "1.234,50 €") to a number. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    // ES formatting: strip thousands separators, treat a decimal comma as a dot.
    const cleaned = value.replace(/[^0-9.,-]/g, '');
    const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeAmenity(name: string): string {
  const key = deaccent(name);
  return AMENITY_ALIASES[key] ?? key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
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

/** `addressCountry` may be a string or a `{ name }` Country node. */
function readCountry(value: unknown): string | undefined {
  return asString(value) ?? (isRecord(value) ? asString(value.name) : undefined);
}

function readAddress(value: unknown): EsSchemaListing['address'] {
  if (!isRecord(value)) return {};
  const country = readCountry(value.addressCountry);
  return {
    street: asString(value.streetAddress),
    city: asString(value.addressLocality),
    region: asString(value.addressRegion),
    postalCode: asString(value.postalCode),
    neighborhood: asString(value.addressSubLocality) ?? asString(value.neighborhood),
    country: country && country.length > 2 ? country : undefined,
    countryCode: country && country.length === 2 ? country.toUpperCase() : 'ES',
  };
}

function readCoordinates(value: unknown): EsSchemaListing['coordinates'] {
  if (!isRecord(value)) return undefined;
  const lat = asNumber(value.latitude);
  const lng = asNumber(value.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

function readFloorSize(value: unknown): number | undefined {
  if (isRecord(value)) return asNumber(value.value);
  return asNumber(value);
}

function readOffer(value: unknown): { price?: number; currency?: string; operation?: 'rent' | 'sale' } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const businessFunction = asString(offer.businessFunction)?.toLowerCase() ?? '';
    let operation: 'rent' | 'sale' | undefined;
    if (businessFunction.includes('leaseout') || businessFunction.includes('rent')) operation = 'rent';
    else if (businessFunction.includes('sell') || businessFunction.includes('sale')) operation = 'sale';

    const price = asNumber(offer.price);
    if (price !== undefined) return { price, currency: asString(offer.priceCurrency), operation };
    if (isRecord(offer.priceSpecification)) {
      const specPrice = asNumber(offer.priceSpecification.price);
      if (specPrice !== undefined) {
        return { price: specPrice, currency: asString(offer.priceSpecification.priceCurrency), operation };
      }
    }
  }
  return {};
}

function readAmenities(value: unknown): { amenities: string[]; furnished?: boolean } {
  const amenities: string[] = [];
  let furnished: boolean | undefined;
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name);
    if (!name) continue;
    if (entry.value === false) continue;
    const key = normalizeAmenity(name);
    if (key === 'furnished') {
      furnished = true;
      continue;
    }
    if (key) amenities.push(key);
  }
  return { amenities, furnished };
}

/** RealEstateListing nodes nest the residence under `about` or `mainEntity`. */
function readSubject(node: Record<string, unknown>): Record<string, unknown> {
  const nested = node.about ?? node.mainEntity;
  return isRecord(nested) ? nested : node;
}

function toListing(node: Record<string, unknown>): EsSchemaListing {
  const subject = readSubject(node);
  const offer = readOffer(node.offers ?? subject.offers);
  const topLevelPrice = asNumber(node.price);
  const { amenities, furnished } = readAmenities(subject.amenityFeature ?? node.amenityFeature);
  const types = [...readTypes(node['@type']), ...readTypes(subject['@type'])];
  return {
    types,
    name: asString(node.name) ?? asString(subject.name),
    description: asString(node.description) ?? asString(subject.description),
    url: asString(node.url) ?? asString(subject.url),
    address: readAddress(subject.address ?? node.address),
    coordinates: readCoordinates(subject.geo ?? node.geo),
    images: collectImages(subject.image ?? subject.photo ?? node.image ?? node.photo),
    bedrooms:
      asNumber(subject.numberOfRooms) ??
      asNumber(subject.numberOfBedrooms) ??
      asNumber(node.numberOfRooms) ??
      asNumber(node.numberOfBedrooms),
    bathrooms:
      asNumber(subject.numberOfBathroomsTotal) ??
      asNumber(subject.numberOfBathrooms) ??
      asNumber(node.numberOfBathroomsTotal) ??
      asNumber(node.numberOfBathrooms),
    squareMeters: readFloorSize(subject.floorSize ?? node.floorSize),
    price: offer.price ?? topLevelPrice,
    priceCurrency: offer.currency ?? asString(node.priceCurrency),
    operation: offer.operation,
    amenities,
    furnished,
  };
}

/** Recursively collect record nodes, unwrapping arrays and `@graph` wrappers. */
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
  out.push(value);
}

/**
 * Parse every `application/ld+json` block into flattened {@link EsSchemaListing}s.
 * Blocks that are not objects (or fail to parse) are skipped, not thrown.
 */
export function extractEsSchemaListings(html: string): EsSchemaListing[] {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_JSON_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      collectNodes(JSON.parse(body), nodes);
    } catch {
      // A single malformed JSON-LD block must not abort extraction of the rest.
      continue;
    }
  }
  return nodes.map(toListing);
}

/** True when a listing carries a price + a city (enough to ingest). */
function isListingLike(listing: EsSchemaListing): boolean {
  return listing.price !== undefined && Boolean(listing.address.city);
}

/**
 * Pick the JSON-LD node most likely to be the property itself: the first node
 * that carries both a price and a city, else the first with any price.
 */
export function pickEsListing(listings: EsSchemaListing[]): EsSchemaListing | undefined {
  return listings.find(isListingLike) ?? listings.find((listing) => listing.price !== undefined);
}
