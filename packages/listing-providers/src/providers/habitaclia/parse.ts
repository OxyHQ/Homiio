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
/** List cards expose detail URLs in `data-href` (live search + listainmuebles AJAX). */
const DETAIL_DATA_HREF_RE =
  /data-href=["']([^"']*-i(\d+)\.htm(?:\?[^"']*)?)["']/gi;
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

function htmlFragmentToText(html: string): string {
  let text = '';
  let inTag = false;
  for (let i = 0; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '<') {
      const rest = html.slice(i).toLowerCase();
      if (rest.startsWith('<br') || rest.startsWith('<br/') || rest.startsWith('<br ')) {
        text += '\n';
      }
      inTag = true;
      continue;
    }
    if (ch === '>') {
      inTag = false;
      continue;
    }
    if (!inTag) text += ch;
  }
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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
function resolveOperationFromOffer(offer: Record<string, unknown>, url: string): 'rent' | 'sale' {
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
  if (node) {
    return parseHabitacliaDetailFromJsonLd(node, url);
  }
  return parseHabitacliaDetailHtml(html, url);
}

function parseHabitacliaDetailFromJsonLd(node: Record<string, unknown>, url: string): HabitacliaRawListing {
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
    operation: resolveOperationFromOffer(offer, canonicalUrl),
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
  const normalizedHref = href.replace(/&amp;/g, '&').split('?')[0] ?? href;
  const url = normalizedHref.startsWith('http')
    ? normalizedHref
    : `${HABITACLIA_BASE_URL}${normalizedHref.startsWith('/') ? normalizedHref : `/${normalizedHref}`}`;
  refs.push({ sourceId, url });
}

export function parseHabitacliaSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(DETAIL_DATA_HREF_RE)) {
    pushHabitacliaRef(refs, seen, match[1], match[2]);
  }
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

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x20AC;/gi, '€')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 10)));
}

function parseSpanishPrice(raw: string): number | undefined {
  const decoded = decodeHtmlEntities(raw).trim();
  const digits = decoded.replace(/[^\d.,]/g, '');
  if (!digits) return undefined;
  const normalized =
    digits.includes(',') && digits.lastIndexOf(',') > digits.lastIndexOf('.')
      ? digits.replace(/\./g, '').replace(',', '.')
      : digits.replace(/\./g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function metaContent(html: string, name: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`,
    'i',
  );
  const match = html.match(re);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function firstMatch(html: string, re: RegExp): string | undefined {
  const match = html.match(re);
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : undefined;
}

function collectItempropImages(html: string): HabitacliaRawImage[] {
  const urls: string[] = [];
  for (const match of html.matchAll(/itemprop=["']image["'][^>]*src=["']([^"']+)["']/gi)) {
    const src = match[1];
    if (src) urls.push(src.startsWith('//') ? `https:${src}` : src);
  }
  const unique = [...new Set(urls)];
  return unique.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function resolvePropertyTypeFromUrl(url: string): string {
  const segment = url.match(/\/(?:alquiler|venta|pisos)-([a-z0-9_]+)-/i)?.[1]?.toLowerCase() ?? '';
  if (segment.includes('casa')) return 'house';
  if (segment.includes('studio') || segment.includes('estudio')) return 'studio';
  return 'apartment';
}

function resolveOperationFromUrl(url: string, title: string): 'rent' | 'sale' {
  const lower = `${url} ${title}`.toLowerCase();
  if (lower.includes('/venta') || lower.includes('venta ') || lower.includes('/pisos-')) return 'sale';
  return 'rent';
}

/** Parse live detail HTML (microdata + meta) when JSON-LD is absent. */
export function parseHabitacliaDetailHtml(html: string, url: string): HabitacliaRawListing {
  const canonicalUrl = metaContent(html, 'og:url') ?? url.split('?')[0] ?? url;
  const sourceId = habitacliaSourceIdFromUrl(canonicalUrl) ?? habitacliaSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`habitaclia: cannot derive a source id from ${url}`);
  }

  const priceRaw =
    firstMatch(html, /itemprop=["']price["'][^>]*>([^<]+)/i) ??
    firstMatch(html, /por\s+([\d.]+\s*€)/i) ??
    firstMatch(html, /<title>[^<]*?por\s+([\d.]+\s*€)/i);
  const price = priceRaw ? parseSpanishPrice(priceRaw) : undefined;
  if (price === undefined) {
    throw new Error(`habitaclia: listing at ${url} has no parseable price`);
  }

  const title =
    firstMatch(html, /<h1[^>]*>([^<]+)/i) ?? metaContent(html, 'og:title') ?? metaContent(html, 'title');
  const description =
    (() => {
      const fragment = firstMatch(html, /id=["']js-detail-description["'][^>]*>([\s\S]*?)<\/p>/i);
      return fragment ? htmlFragmentToText(fragment) : undefined;
    })() ?? metaContent(html, 'description');

  const city =
    firstMatch(html, /<h1[^>]*>[^<]*\ben\s+([A-Za-zÀ-ÿ\s.'-]+)\s*<\/h1>/i) ??
    firstMatch(html, /nom_prov['"]\s*,\s*['"]([^'"]+)['"]/i) ??
    firstMatch(html, /Filtros\.Geo\.NomPobBuscador["'][^>]*value=["']([^"']+)/i);
  if (!city) {
    throw new Error(`habitaclia: listing at ${url} has no city`);
  }

  const neighborhood = firstMatch(html, /id=["']js-ver-mapa-zona["'][^>]*title=["']([^"']+)/i);
  const bedrooms = asNumber(firstMatch(html, /<strong>(\d+)<\/strong>\s*hab\.?/i));
  const bathrooms = asNumber(firstMatch(html, /<strong>(\d+)<\/strong>\s*ba/i));
  const squareMeters = asNumber(firstMatch(html, /<strong>(\d+)<\/strong>\s*m(?:<sup>2<\/sup>|²)/i));

  const amenities: string[] = [];
  let furnished: boolean | undefined;
  for (const match of html.matchAll(/<li>([^<]{2,60})<\/li>/gi)) {
    const label = match[1]?.trim();
    if (!label || /habitacion|baño|ba\u00F1o|m2|€\/m/i.test(label)) continue;
    const key = normalizeAmenity(label);
    if (key === 'furnished') {
      furnished = true;
      continue;
    }
    if (key) amenities.push(key);
  }

  const images = collectItempropImages(html);
  const ogImage = metaContent(html, 'og:image');
  if (ogImage) {
    const absolute = ogImage.startsWith('//') ? `https:${ogImage}` : ogImage;
    if (!images.some((image) => image.url === absolute)) {
      images.unshift({ url: absolute, isPrimary: true });
    }
  }

  return {
    id: sourceId,
    url: canonicalUrl,
    propertyType: resolvePropertyTypeFromUrl(canonicalUrl),
    title,
    description,
    price,
    currency: 'EUR',
    operation: resolveOperationFromUrl(canonicalUrl, title ?? ''),
    address: {
      city,
      region: city,
      countryCode: 'ES',
      neighborhood,
    },
    bedrooms,
    bathrooms,
    squareMeters,
    furnished,
    amenities: amenities.length > 0 ? amenities : undefined,
    images,
  };
}
