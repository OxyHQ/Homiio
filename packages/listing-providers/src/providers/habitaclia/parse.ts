/**
 * Habitaclia HTML parsing.
 *
 * Habitaclia is an HTML portal (no public API), so the provider's `fetch()`
 * pulls the detail page's HTML through the shared {@link FetchRuntime} and this
 * module extracts the embedded schema.org JSON-LD into a
 * {@link HabitacliaRawListing}. Keeping the extraction pure and DOM-free (regex
 * over `<script type="application/ld+json">` blocks + typed guards) means the
 * parser runs identically in the worker and in unit tests, with zero extra
 * dependencies. `normalize()` (in `index.ts`) consumes the raw shape this
 * produces, so tests can cover the full HTML → normalized path from a fixture.
 */

import { HABITACLIA_BASE_URL, type HabitacliaRawImage, type HabitacliaRawListing } from './fixtures';

/** Match every `<script type="application/ld+json">…</script>` block. */
const JSON_LD_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** Match a Habitaclia detail-page link and capture its numeric listing id. */
const DETAIL_LINK_RE = /href=["']([^"']*-i(\d+)\.htm)["']/gi;
/** Fallback when anchors omit the `-i` prefix but keep the trailing id segment. */
const DETAIL_LINK_FALLBACK_RE = /href=["']([^"']*\/alquiler-[^"']*-(\d{6,})\.htm)["']/gi;

/** Spanish → canonical amenity keys; unknown names fall back to a slug. */
const AMENITY_ALIASES: Readonly<Record<string, string>> = {
  ascensor: 'elevator',
  'aire acondicionado': 'air_conditioning',
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
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

/** Strip accents and lowercase for alias lookup / slugging. */
function deaccent(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function normalizeAmenity(name: string): string {
  const key = deaccent(name);
  return AMENITY_ALIASES[key] ?? key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/** Parse every JSON-LD block in the page, ignoring malformed ones. */
function extractJsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(JSON_LD_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      continue;
    }
    for (const entry of asArray(parsed)) {
      const record = asRecord(entry);
      if (!record) continue;
      const graph = record['@graph'];
      if (Array.isArray(graph)) {
        for (const graphNode of graph) {
          const graphRecord = asRecord(graphNode);
          if (graphRecord) nodes.push(graphRecord);
        }
      } else {
        nodes.push(record);
      }
    }
  }
  return nodes;
}

/** Whether a JSON-LD node looks like the real-estate listing (has price+address). */
function isListingNode(node: Record<string, unknown>): boolean {
  return Boolean(asRecord(node['offers']) && asRecord(node['address']));
}

function toImages(node: Record<string, unknown>): HabitacliaRawImage[] {
  const images: HabitacliaRawImage[] = [];
  asArray(node['image']).forEach((entry, index) => {
    const url = typeof entry === 'string' ? entry : asString(asRecord(entry)?.['url']);
    if (url) images.push({ url, isPrimary: index === 0 });
  });
  return images;
}

function toAmenities(node: Record<string, unknown>): { amenities: string[]; furnished?: boolean } {
  const amenities: string[] = [];
  let furnished: boolean | undefined;
  for (const entry of asArray(node['amenityFeature'])) {
    const record = asRecord(entry);
    const name = asString(record?.['name']);
    if (!name) continue;
    if (record?.['value'] === false) continue;
    const key = normalizeAmenity(name);
    if (key === 'furnished') {
      furnished = true;
      continue;
    }
    if (key) amenities.push(key);
  }
  return { amenities, furnished };
}

/** Extract a stable listing id from a Habitaclia URL (`…-i<digits>.htm`). */
export function habitacliaSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/-i(\d+)\.htm/);
  return match?.[1];
}

/** Infer rent vs sale from a JSON-LD offer's business function or the URL. */
function resolveOperation(offer: Record<string, unknown>, url: string): 'rent' | 'sale' {
  const businessFunction = asString(offer['businessFunction'])?.toLowerCase() ?? '';
  if (businessFunction.includes('leaseout') || businessFunction.includes('rent')) return 'rent';
  if (businessFunction.includes('sell') || businessFunction.includes('sale')) return 'sale';
  return url.includes('/venta') ? 'sale' : 'rent';
}

/** Map a JSON-LD `@type` list onto Habitaclia's raw property category. */
function resolvePropertyType(node: Record<string, unknown>): string {
  const types = asArray(node['@type']).map((entry) => asString(entry)?.toLowerCase() ?? '');
  if (types.some((type) => type.includes('house') || type.includes('singlefamily'))) return 'house';
  if (types.some((type) => type.includes('studio'))) return 'studio';
  return 'apartment';
}

/**
 * Parse a Habitaclia detail-page HTML into a {@link HabitacliaRawListing}.
 * Throws when the page carries no recognizable real-estate JSON-LD (e.g. the
 * listing was delisted or the portal served a challenge page).
 */
export function parseHabitacliaDetail(html: string, url: string): HabitacliaRawListing {
  const node = extractJsonLdNodes(html).find(isListingNode);
  if (!node) {
    throw new Error(`habitaclia: no real-estate JSON-LD found at ${url}`);
  }

  const offer = asRecord(node['offers']) ?? {};
  const address = asRecord(node['address']) ?? {};
  const geo = asRecord(node['geo']);
  const floorSize = asRecord(node['floorSize']);
  const price = asNumber(offer['price']);
  if (price === undefined) {
    throw new Error(`habitaclia: listing at ${url} has no parseable price`);
  }

  const canonicalUrl = asString(node['url']) ?? url;
  const sourceId = habitacliaSourceIdFromUrl(canonicalUrl) ?? habitacliaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`habitaclia: cannot derive a source id from ${url}`);
  }

  const city = asString(address['addressLocality']);
  if (!city) {
    throw new Error(`habitaclia: listing at ${url} has no city`);
  }

  const { amenities, furnished } = toAmenities(node);
  const countryValue =
    asString(address['addressCountry']) ??
    asString(asRecord(address['addressCountry'])?.['name']);

  return {
    id: sourceId,
    url: canonicalUrl,
    propertyType: resolvePropertyType(node),
    title: asString(node['name']),
    description: asString(node['description']),
    price,
    currency: asString(offer['priceCurrency']) ?? 'EUR',
    operation: resolveOperation(offer, canonicalUrl),
    address: {
      street: asString(address['streetAddress']),
      city,
      region: asString(address['addressRegion']),
      postalCode: asString(address['postalCode']),
      country: countryValue && countryValue.length > 2 ? countryValue : undefined,
      countryCode: countryValue && countryValue.length === 2 ? countryValue.toUpperCase() : 'ES',
      lat: geo ? asNumber(geo['latitude']) : undefined,
      lng: geo ? asNumber(geo['longitude']) : undefined,
    },
    bedrooms: asNumber(node['numberOfRooms']),
    bathrooms: asNumber(node['numberOfBathroomsTotal']),
    squareMeters: floorSize ? asNumber(floorSize['value']) : undefined,
    furnished,
    amenities: amenities.length > 0 ? amenities : undefined,
    images: toImages(node),
  };
}

/**
 * Parse a Habitaclia search-results HTML into de-duplicated detail refs
 * (`{ sourceId, url }`). Non-listing links are ignored; relative links are
 * resolved against {@link HABITACLIA_BASE_URL}.
 */
function pushHabitacliaRef(
  refs: { sourceId: string; url: string }[],
  seen: Set<string>,
  href: string | undefined,
  sourceId: string | undefined,
): void {
  if (!href || !sourceId || seen.has(sourceId)) return;
  seen.add(sourceId);
  const url = href.startsWith('http') ? href : `${HABITACLIA_BASE_URL}${href}`;
  refs.push({ sourceId, url });
}

export function parseHabitacliaSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    pushHabitacliaRef(refs, seen, match[1], match[2]);
  }
  if (refs.length === 0) {
    for (const match of html.matchAll(DETAIL_LINK_FALLBACK_RE)) {
      pushHabitacliaRef(refs, seen, match[1], match[2]);
    }
  }
  return refs;
}
