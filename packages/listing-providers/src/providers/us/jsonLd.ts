/**
 * schema.org JSON-LD extraction for the US portals.
 *
 * apartments.com and Zillow both embed one or more
 * `<script type="application/ld+json">` blocks describing the listing as
 * schema.org real-estate types (`Residence`, `Apartment`, `House`,
 * `SingleFamilyResidence`, `Product`, …). This module pulls those blocks out of
 * raw HTML and flattens them into a provider-agnostic {@link SchemaOrgListing}
 * — the ONE parsing chokepoint the US providers share, so a portal markup
 * change is fixed in a single place.
 *
 * It is intentionally defensive: JSON is parsed into `unknown` and every field
 * is narrowed through a guard, so malformed/partial payloads degrade to missing
 * fields rather than throwing.
 */

/** A single listing flattened from one or more schema.org JSON-LD nodes. */
export interface SchemaOrgListing {
  /** Every `@type` seen for this node (a node may declare an array of types). */
  types: string[];
  name?: string;
  description?: string;
  url?: string;
  address: {
    street?: string;
    locality?: string;
    /** US state code / region (e.g. "CA"). */
    region?: string;
    postalCode?: string;
    country?: string;
  };
  coordinates?: { lat: number; lng: number };
  /** Absolute source image URLs (never hotlinked — re-hosted at ingest). */
  images: string[];
  bedrooms?: number;
  bathrooms?: number;
  /** Living area in square feet (US portals report `floorSize` in sqft). */
  squareFootage?: number;
  /** A concrete price when the node carries a single `offers.price`. */
  price?: number;
  priceCurrency?: string;
  /** A range string (e.g. "$1,650 - $3,200") when the node is a complex. */
  priceRange?: string;
}

const LD_JSON_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** Coerce a schema.org numeric-ish value (number or "1,234 sqft") to a number. */
function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.]/g, '');
    if (cleaned.length === 0) return undefined;
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** Normalize a node's `@type` (string or string[]) into a string[]. */
function readTypes(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/** Collect image URLs from the many shapes `image`/`photo` can take. */
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

function readAddress(value: unknown): SchemaOrgListing['address'] {
  if (!isRecord(value)) return {};
  return {
    street: asString(value.streetAddress),
    locality: asString(value.addressLocality),
    region: asString(value.addressRegion),
    postalCode: asString(value.postalCode),
    country: asString(value.addressCountry) ?? readCountryName(value.addressCountry),
  };
}

/** `addressCountry` may itself be a `{ name }` Country node. */
function readCountryName(value: unknown): string | undefined {
  if (isRecord(value)) return asString(value.name);
  return undefined;
}

function readCoordinates(value: unknown): SchemaOrgListing['coordinates'] {
  if (!isRecord(value)) return undefined;
  const lat = asNumber(value.latitude);
  const lng = asNumber(value.longitude);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

/** Read `floorSize` (a QuantitativeValue `{ value, unitCode }`) as a number. */
function readFloorSize(value: unknown): number | undefined {
  if (isRecord(value)) return asNumber(value.value);
  return asNumber(value);
}

/** Read the first concrete `offers.price` / `priceCurrency` from an Offer(s). */
function readOffer(value: unknown): { price?: number; priceCurrency?: string } {
  const offers = Array.isArray(value) ? value : [value];
  for (const offer of offers) {
    if (!isRecord(offer)) continue;
    const price = asNumber(offer.price);
    if (price !== undefined) {
      return { price, priceCurrency: asString(offer.priceCurrency) };
    }
    // A nested priceSpecification also carries price/currency.
    if (isRecord(offer.priceSpecification)) {
      const specPrice = asNumber(offer.priceSpecification.price);
      if (specPrice !== undefined) {
        return { price: specPrice, priceCurrency: asString(offer.priceSpecification.priceCurrency) };
      }
    }
  }
  return {};
}

/** Map one flattened JSON-LD record into a {@link SchemaOrgListing}. */
function toListing(node: Record<string, unknown>): SchemaOrgListing {
  const offer = readOffer(node.offers);
  const bathrooms =
    asNumber(node.numberOfBathroomsTotal) ??
    asNumber(node.numberOfBathrooms) ??
    asNumber(node.numberOfFullBathrooms);
  return {
    types: readTypes(node['@type']),
    name: asString(node.name),
    description: asString(node.description),
    url: asString(node.url),
    address: readAddress(node.address),
    coordinates: readCoordinates(node.geo),
    images: collectImages(node.image ?? node.photo),
    bedrooms: asNumber(node.numberOfBedrooms) ?? asNumber(node.numberOfRooms),
    bathrooms,
    squareFootage: readFloorSize(node.floorSize),
    price: offer.price,
    priceCurrency: offer.priceCurrency,
    priceRange: asString(node.priceRange),
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
 * Parse every `application/ld+json` block in the HTML into flattened
 * {@link SchemaOrgListing}s. Blocks that are not objects (or fail to parse) are
 * skipped rather than throwing.
 */
export function extractSchemaOrgListings(html: string): SchemaOrgListing[] {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(LD_JSON_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    try {
      const parsed: unknown = JSON.parse(body);
      collectNodes(parsed, nodes);
    } catch {
      // A single malformed JSON-LD block must not abort extraction of the rest.
      continue;
    }
  }
  return nodes.map(toListing);
}

/** True when a listing carries enough address to resolve a canonical Address. */
function hasUsableAddress(listing: SchemaOrgListing): boolean {
  return Boolean(listing.address.locality) && Boolean(listing.address.street ?? listing.address.locality);
}

/**
 * Pick the listing node most likely to describe the property itself: prefer a
 * node with a street + locality, then one with any locality, else the first.
 */
export function pickPrimaryListing(listings: SchemaOrgListing[]): SchemaOrgListing | undefined {
  const withStreet = listings.find((listing) => listing.address.street && listing.address.locality);
  if (withStreet) return withStreet;
  const withLocality = listings.find(hasUsableAddress);
  if (withLocality) return withLocality;
  return listings[0];
}
