/**
 * schema.org JSON-LD extraction for Italian portals (Idealista.it, Casa.it, …).
 *
 * Mirrors {@link ../es/jsonLd} with IT amenity aliases and countryCode default `IT`.
 */

export interface ItSchemaListing {
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

const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

const AMENITY_ALIASES: Readonly<Record<string, string>> = {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
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

function readCountry(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return asString(value.name) ?? asString(value['@id']);
  return undefined;
}

function readAddress(value: unknown): ItSchemaListing['address'] {
  if (!isRecord(value)) return {};
  const country = readCountry(value.addressCountry);
  return {
    street: asString(value.streetAddress),
    city: asString(value.addressLocality),
    region: asString(value.addressRegion),
    postalCode: asString(value.postalCode),
    neighborhood: asString(value.addressSubLocality) ?? asString(value.neighborhood),
    country: country && country.length > 2 ? country : undefined,
    countryCode: country && country.length === 2 ? country.toUpperCase() : 'IT',
  };
}

function readCoordinates(value: unknown): ItSchemaListing['coordinates'] {
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

function collectImages(value: unknown): string[] {
  const out: string[] = [];
  const entries = Array.isArray(value) ? value : value === undefined ? [] : [value];
  for (const entry of entries) {
    if (typeof entry === 'string' && entry.startsWith('http')) out.push(entry);
    else if (isRecord(entry)) {
      const url = asString(entry.url) ?? asString(entry.contentUrl);
      if (url?.startsWith('http')) out.push(url);
    }
  }
  return [...new Set(out)];
}

function readOffer(value: unknown): { price?: number; currency?: string; operation?: 'rent' | 'sale' } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const businessFunction = asString(offer.businessFunction)?.toLowerCase() ?? '';
    let operation: 'rent' | 'sale' | undefined;
    if (
      businessFunction.includes('leaseout') ||
      businessFunction.includes('rent') ||
      businessFunction.includes('affitto')
    ) {
      operation = 'rent';
    } else if (
      businessFunction.includes('sell') ||
      businessFunction.includes('sale') ||
      businessFunction.includes('vendita')
    ) {
      operation = 'sale';
    }
    const price = asNumber(offer.price);
    if (price !== undefined) return { price, currency: asString(offer.priceCurrency), operation };
    if (isRecord(offer.priceSpecification)) {
      const specPrice = asNumber(offer.priceSpecification.price);
      if (specPrice !== undefined) {
        return {
          price: specPrice,
          currency: asString(offer.priceSpecification.priceCurrency),
          operation,
        };
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

function readSubject(node: Record<string, unknown>): Record<string, unknown> {
  const nested = node.about ?? node.mainEntity;
  return isRecord(nested) ? nested : node;
}

function toListing(node: Record<string, unknown>): ItSchemaListing {
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

export function extractItSchemaListings(html: string): ItSchemaListing[] {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_JSON_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      collectNodes(JSON.parse(body), nodes);
    } catch {
      continue;
    }
  }
  return nodes.map(toListing);
}

function isListingLike(listing: ItSchemaListing): boolean {
  return listing.price !== undefined && Boolean(listing.address.city);
}

export function pickItListing(listings: ItSchemaListing[]): ItSchemaListing | undefined {
  return listings.find(isListingLike) ?? listings.find((listing) => listing.price !== undefined);
}
