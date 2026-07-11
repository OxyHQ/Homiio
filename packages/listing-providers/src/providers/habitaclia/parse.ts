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
import { asCoordinate, asNumber, asString } from '../../parse/guards';

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

/**
 * Minimum plausible living area in m². Habitaclia renders a "1 m²" placeholder in
 * the detail feature list (and mirrors it into the JSON-LD `floorSize`) for
 * partner listings — e.g. Spotahome imports — that report no surface; its own
 * datalayer emits `"superficie":"undefined"` for these. A real dwelling is never
 * smaller than this, so any value below the floor is dropped to `undefined`
 * rather than ingested as a bogus 0/1 m² (the source of the "1 m²" listings seen
 * in production).
 */
const MIN_LIVING_AREA_SQM = 8;

/** Reject absurd living-area values (habitaclia's "1 m²" placeholder, stray 0). */
function sanitizeLivingArea(value: number | undefined): number | undefined {
  return value !== undefined && value >= MIN_LIVING_AREA_SQM ? value : undefined;
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
  const raw = node ? parseHabitacliaDetailFromJsonLd(node, url) : parseHabitacliaDetailHtml(html, url);
  const enriched = applyDetailCharacteristics(raw, html);
  return { ...enriched, images: resolveDetailImages(enriched.images, html) };
}

/**
 * Resolve the listing's photo set from the detail page. The full gallery lives in
 * the microdata `<img itemprop="image" src="…habimg.com/imgh/…">` tags (dozens of
 * shots); the JSON-LD `image[]` — when present at all — and the `og:image` meta
 * only carry the hero. Prefer the microdata gallery whenever it is richer than the
 * base parse produced (so BOTH the JSON-LD and microdata paths ingest every
 * photo), keep the base images when the page has no microdata gallery, and fall
 * back to the single `og:image` hero only when neither source provides one.
 */
function resolveDetailImages(baseImages: HabitacliaRawImage[], html: string): HabitacliaRawImage[] {
  const gallery = collectItempropImages(html);
  if (gallery.length > baseImages.length) return gallery;
  if (baseImages.length > 0) return baseImages;
  const ogImage = metaContent(html, 'og:image');
  if (!ogImage) return [];
  const absolute = ogImage.startsWith('//') ? `https:${ogImage}` : ogImage;
  return [{ url: absolute, isPrimary: true }];
}

/**
 * Merge the numeric characteristics Habitaclia prints only in the detail markup
 * — floor level, construction year and the parking-space count — onto the raw
 * listing, regardless of whether the base fields came from JSON-LD or microdata
 * (neither source carries these reliably). A value already set by the base
 * parser always wins; the HTML characteristics only fill the gaps.
 */
function applyDetailCharacteristics(raw: HabitacliaRawListing, html: string): HabitacliaRawListing {
  const floor = raw.floor ?? parseFloorLevel(html);
  const yearBuilt = raw.yearBuilt ?? parseYearBuilt(html);
  const parkingSpaces = raw.parkingSpaces ?? parseParkingSpaces(html);
  if (floor === undefined && yearBuilt === undefined && parkingSpaces === undefined) {
    return raw;
  }
  return {
    ...raw,
    ...(floor !== undefined ? { floor } : {}),
    ...(yearBuilt !== undefined ? { yearBuilt } : {}),
    ...(parkingSpaces !== undefined ? { parkingSpaces } : {}),
  };
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
      lat: geo ? asCoordinate(geo['latitude']) : undefined,
      lng: geo ? asCoordinate(geo['longitude']) : undefined,
    },
    bedrooms: asNumber(node['numberOfRooms']),
    bathrooms: asNumber(node['numberOfBathroomsTotal']),
    squareMeters: sanitizeLivingArea(floorSize ? asNumber(floorSize['value']) : undefined),
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

/**
 * Floor level from a "Planta N" / "Planta Nª" characteristic. Returns `undefined`
 * for the label-only forms Habitaclia also uses ("Planta baja", "Ático"), which
 * carry no reliable number.
 */
function parseFloorLevel(html: string): number | undefined {
  const floor = asNumber(firstMatch(html, /\bPlanta\s+(\d{1,2})\s*(?:[ªº°]|\b)/i));
  return floor !== undefined && floor >= 0 && floor <= 60 ? floor : undefined;
}

/**
 * Construction year from an "Año (de) construcción: YYYY" / "Construido en YYYY"
 * characteristic. Habitaclia often states age as a fuzzy range instead
 * ("Antigüedad: entre 30 y 50 años") — those carry no exact year and are ignored.
 */
function parseYearBuilt(html: string): number | undefined {
  const year = asNumber(
    firstMatch(html, /A[ñn]o\s+(?:de\s+)?construcci[óo]n[\s:]{1,3}(\d{4})/i) ??
      firstMatch(html, /\bconstruid[oa]\s+en\s+(?:el\s+a[ñn]o\s+)?(\d{4})/i),
  );
  const maxYear = new Date().getFullYear() + 2;
  return year !== undefined && year >= 1800 && year <= maxYear ? year : undefined;
}

/**
 * Parking-space count from an "N plazas de parking/garaje/aparcamiento"
 * characteristic. The label-only "Plaza de parking" boolean carries no count and
 * is left to the amenity → parking-type derivation instead.
 */
function parseParkingSpaces(html: string): number | undefined {
  const spaces = asNumber(
    firstMatch(html, /(\d{1,2})\s*plazas?\s+de\s+(?:parking|garaje|aparcamiento)/i),
  );
  return spaces !== undefined && spaces >= 1 && spaces <= 20 ? spaces : undefined;
}

/** Every `<img …>` tag on the page (attributes never carry an unescaped `>`). */
const IMG_TAG_RE = /<img\b[^>]*>/gi;
/** Whether an `<img>` tag is a schema.org gallery photo, in any attribute order. */
const IMG_ITEMPROP_IMAGE_RE = /\bitemprop=["']image["']/i;
/** The `src` of an `<img>` tag, wherever it sits among the attributes. */
const IMG_SRC_RE = /\bsrc=["']([^"']+)["']/i;

/**
 * Collect the detail gallery photos. Habitaclia marks every gallery `<img>` with
 * `itemprop="image"`, but in the real markup `src` PRECEDES `itemprop`
 * (`<img title=… src=… alt=… itemprop="image" />`), so the previous
 * `itemprop…src`-ordered regex matched NONE of them — leaving only the single
 * `og:image` hero, the root cause of every habitaclia listing showing exactly one
 * photo. Match each `<img>` tag carrying `itemprop="image"` in ANY attribute order
 * and read its `src`. Related-listing thumbnails are not marked `itemprop="image"`,
 * so the result stays scoped to the current listing's gallery (order preserved,
 * de-duplicated, first photo primary).
 */
function collectItempropImages(html: string): HabitacliaRawImage[] {
  const urls: string[] = [];
  for (const tag of html.match(IMG_TAG_RE) ?? []) {
    if (!IMG_ITEMPROP_IMAGE_RE.test(tag)) continue;
    const src = tag.match(IMG_SRC_RE)?.[1];
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
  const squareMeters = sanitizeLivingArea(
    asNumber(firstMatch(html, /<strong>(\d+)<\/strong>\s*m(?:<sup>2<\/sup>|²)/i)),
  );

  const amenities: string[] = [];
  let furnished: boolean | undefined;
  for (const match of html.matchAll(/<li>([^<]{2,60})<\/li>/gi)) {
    const label = match[1]?.trim();
    if (
      !label ||
      /habitacion|baño|ba\u00F1o|m2|€\/m|planta\s+\d|construcci|antig[üu]edad|\d{1,3}\s{0,3}plazas?\s+de\s+(?:parking|garaje|aparcamiento)/i.test(
        label,
      )
    )
      continue;
    const key = normalizeAmenity(label);
    if (key === 'furnished') {
      furnished = true;
      continue;
    }
    if (key) amenities.push(key);
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
    // Photos are resolved centrally in `parseHabitacliaDetail` via
    // `resolveDetailImages`, which prefers the full microdata gallery over the
    // single `og:image` hero for both the JSON-LD and microdata paths.
    images: [],
  };
}
