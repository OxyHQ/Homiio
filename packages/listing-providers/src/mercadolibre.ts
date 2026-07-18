/**
 * Shared MercadoLibre inmuebles parsers (MLA / MEC / …).
 *
 * General classifieds — housing category allowlist + {@link assertHousingListing}.
 * Prefer public item JSON when reachable; else JSON-LD / embedded VIP fields /
 * listing hrefs. Contact via shared {@link ./contact}; JSON-LD via {@link ./jsonLd}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import {
  assertHousingListing,
  isHousingCategory,
  isHousingCategoryUrl,
  NonHousingListingError,
} from './classifieds';
import { buildContact, contactFromUnknown, extractContactFromHtml, mergeContact } from './contact';
import { collectJsonLdNodes, findJsonLdByType } from './jsonLd';
import { parsePreloadedState } from './nextData';
import { citySlug } from './slug';
import { canonicalizeAmenities } from './parse/amenities';
import { stripHtmlToPlainText } from './parse/htmlText';
import { deaccent } from './parse/guards';

export interface MercadolibreSiteConfig {
  /** Provider id for errors (`mercadolibre_ar`). */
  provider: string;
  /** Site id prefix without hyphen (`MLA`, `MEC`). */
  siteId: string;
  /** ISO-2 country. */
  countryCode: string;
  /** Fallback city. */
  defaultCity: string;
  /** Default currency (ARS / USD). */
  defaultCurrency: string;
  /** `https://inmuebles.mercadolibre.com.ar` */
  inmueblesBaseUrl: string;
  /** Path tokens required for housing discover URLs. */
  housingSlugs: ReadonlySet<string>;
  /** Rent URL segment (default `alquiler`; Chile uses `arriendo`). */
  rentSegment?: 'alquiler' | 'arriendo' | 'renta';
  /**
   * Regex (global) for search-card hrefs. Group 1 = full URL.
   * Must match only real-estate host paths when possible.
   */
  hrefRe: RegExp;
}

export interface MercadolibreSearchRef {
  sourceId: string;
  url: string;
}

export interface MercadolibreRawListing {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
  operation: 'rent' | 'sale';
  price: number;
  currency: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  /** Unit floor number (`Número de piso de la unidad` / `Nivel`). */
  floor?: number;
  /** Construction year, derived from `Antigüedad` (age → year, or a bare year). */
  yearBuilt?: number;
  /** Covered parking spaces (`Cocheras` / `Estacionamientos`). */
  parkingSpaces?: number;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  /** Canonical amenity slugs derived from the VIP spec table / item attributes. */
  amenities?: string[];
  /** Whether the listing is furnished (`Amueblado: Sí`) — hoisted to furnishedStatus. */
  furnished?: boolean;
  address: {
    street?: string;
    city: string;
    region?: string;
    neighborhood?: string;
    countryCode: string;
  };
  images: string[];
  contact?: NormalizedListingContact;
  category?: string;
  domainId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
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

export function isMercadolibreChallenge(body: string): boolean {
  if (body.trim().length < 128) return true;
  // Narrow, anti-bot-specific markers only. A bare `captcha` false-positives on
  // every VALID VIP detail page — MercadoLibre embeds an invisible reCAPTCHA v3
  // (`recaptchaSiteKey`, `ui-pdp-recaptcha-v3`) in the contact form — which would
  // make the cold-HTTP ladder treat a perfectly good listing as a challenge.
  // The real walls are DataDome (`datadome` / `captcha-delivery` / `px-captcha`)
  // and MercadoLibre's own `account-verification` / `suspicious-traffic` gate.
  return /suspicious-traffic|account-verification|captcha-delivery|px-captcha|datadome|access denied|just a moment|PA_UNAUTHORIZED/i.test(
    body,
  );
}

export function mercadolibreSourceIdFromUrl(siteId: string, url: string): string | undefined {
  const re = new RegExp(`${siteId}-?(\\d{6,})`, 'i');
  const match = re.exec(url);
  return match?.[1] ? `${siteId}-${match[1]}` : undefined;
}

export function isMercadolibreHousingCategory(
  category: string | undefined,
  domainId: string | undefined,
): boolean {
  if (domainId && /REAL_ESTATE|PROPERTIES|APARTMENTS|HOUSES|LAND|MLA-APARTMENTS|MLA-HOUSES/i.test(domainId)) {
    return true;
  }
  if (domainId && /CARS|ELECTRONICS|FASHION|JOBS|SERVICES|AND_VANS/i.test(domainId)) return false;
  return isHousingCategory(category) || isHousingCategory(domainId);
}

function attributeValue(attrs: unknown, id: string): number | undefined {
  if (!Array.isArray(attrs)) return undefined;
  for (const entry of attrs) {
    if (!isRecord(entry)) continue;
    if (asString(entry.id) === id) return asNumber(entry.value_name) ?? asNumber(entry.value_struct);
  }
  return undefined;
}

function normalizeSourceId(config: MercadolibreSiteConfig, id: string): string {
  const digits = id.replace(/\D/g, '');
  const prefix = config.siteId.toUpperCase();
  if (id.toUpperCase().startsWith(prefix)) {
    return `${prefix}-${digits}`;
  }
  return `${prefix}-${digits}`;
}

function itemToRaw(
  config: MercadolibreSiteConfig,
  item: Record<string, unknown>,
): MercadolibreRawListing | undefined {
  const id =
    asString(item.id) ??
    mercadolibreSourceIdFromUrl(config.siteId, asString(item.permalink) ?? '');
  const url = asString(item.permalink) ?? asString(item.url);
  if (!id || !url) return undefined;
  const sourceId = normalizeSourceId(config, id);
  const price = asNumber(item.price) ?? asNumber(isRecord(item.price) ? item.price.amount : undefined);
  if (price === undefined) return undefined;

  const domainId = asString(item.domain_id) ?? asString(item.domainId);
  const category = asString(item.category_id) ?? asString(item.categoryId) ?? domainId;
  if (!isMercadolibreHousingCategory(category, domainId)) {
    throw new NonHousingListingError(
      config.provider,
      sourceId,
      `domain/category ${domainId ?? category}`,
    );
  }

  const location = isRecord(item.location) ? item.location : undefined;
  const city =
    asString(isRecord(location?.city) ? location.city.name : undefined) ??
    asString(location?.city) ??
    asString(item.city) ??
    config.defaultCity;
  const region =
    asString(isRecord(location?.state) ? location.state.name : undefined) ?? asString(item.state);
  const neighborhood =
    asString(isRecord(location?.neighborhood) ? location.neighborhood.name : undefined) ??
    asString(item.neighborhood);
  const street = asString(location?.address_line) ?? asString(location?.address);
  const title = asString(item.title) ?? asString(item.name);
  const operation: 'rent' | 'sale' = /venta|sale|sell/i.test(title ?? url) ? 'sale' : 'rent';
  const images: string[] = [];
  const thumb = asString(item.thumbnail) ?? asString(item.secure_thumbnail) ?? asString(item.image);
  if (thumb) images.push(thumb);
  if (Array.isArray(item.pictures)) {
    for (const pic of item.pictures) {
      if (isRecord(pic)) {
        const u = asString(pic.url) ?? asString(pic.secure_url);
        if (u) images.push(u);
      } else if (typeof pic === 'string') {
        images.push(pic);
      }
    }
  }

  const seller = item.seller ?? item.seller_info;
  const contact = mergeContact(
    contactFromUnknown(seller),
    buildContact({
      phone: isRecord(seller) && isRecord(seller.phone) ? asString(seller.phone.number) : undefined,
      agencyName: isRecord(seller) ? asString(seller.nickname) ?? asString(seller.name) : undefined,
    }),
  );

  const derived = derivedFromSpecTable(attributesToSpecMap(item.attributes));

  const raw: MercadolibreRawListing = {
    sourceId,
    url,
    title,
    description: asString(item.description) ?? title,
    operation,
    price,
    currency: asString(item.currency_id) ?? asString(item.currency) ?? config.defaultCurrency,
    bedrooms: attributeValue(item.attributes, 'BEDROOMS') ?? derived.bedrooms,
    bathrooms:
      attributeValue(item.attributes, 'FULL_BATHROOMS') ??
      attributeValue(item.attributes, 'BATHROOMS') ??
      derived.bathrooms,
    squareMeters:
      attributeValue(item.attributes, 'COVERED_AREA') ??
      attributeValue(item.attributes, 'TOTAL_AREA') ??
      derived.squareMeters,
    floor: derived.floor,
    yearBuilt: derived.yearBuilt,
    parkingSpaces: derived.parkingSpaces,
    parkingType: derived.parkingType,
    amenities: derived.amenities.length > 0 ? derived.amenities : undefined,
    furnished: derived.furnished,
    address: { street, city, region, neighborhood, countryCode: config.countryCode },
    images,
    contact,
    category,
    domainId,
  };

  assertHousingListing(config.provider, sourceId, {
    category: category ?? domainId,
    typology: domainId,
    squareMeters: raw.squareMeters,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    hasAddressLike: Boolean(city),
    hasPrice: true,
  });

  return raw;
}

function collectResults(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isRecord(entry) && (entry.id || entry.permalink)) out.push(entry);
      else collectResults(entry, out);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.results)) {
    collectResults(value.results, out);
    return;
  }
  for (const child of Object.values(value)) {
    if (out.length > 80) return;
    collectResults(child, out);
  }
}

export function parseMercadolibreSearchJson(
  config: MercadolibreSiteConfig,
  body: string,
): MercadolibreSearchRef[] {
  const trimmed = body.trim();
  if (!trimmed || isMercadolibreChallenge(trimmed)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const items: Record<string, unknown>[] = [];
  collectResults(parsed, items);
  const out: MercadolibreSearchRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    try {
      const raw = itemToRaw(config, item);
      if (!raw || seen.has(raw.sourceId)) continue;
      if (
        !isHousingCategoryUrl(raw.url, config.housingSlugs) &&
        !/inmueble|departamento|casa|alquiler|venta|monoambiente/i.test(raw.url)
      ) {
        continue;
      }
      seen.add(raw.sourceId);
      out.push({ sourceId: raw.sourceId, url: raw.url });
    } catch (error) {
      if (error instanceof NonHousingListingError) continue;
      throw error;
    }
  }
  return out;
}

export function parseMercadolibreSearch(
  config: MercadolibreSiteConfig,
  html: string,
): MercadolibreSearchRef[] {
  const state = parsePreloadedState(html);
  if (state) {
    const fromState = parseMercadolibreSearchJson(config, JSON.stringify(state));
    if (fromState.length > 0) return fromState;
  }
  const out: MercadolibreSearchRef[] = [];
  const seen = new Set<string>();
  const hrefRe = new RegExp(
    config.hrefRe.source,
    config.hrefRe.flags.includes('g') ? config.hrefRe.flags : `${config.hrefRe.flags}g`,
  );
  for (const match of html.matchAll(hrefRe)) {
    const url = (match[1] ?? '').split('#')[0] ?? '';
    const sourceId = mercadolibreSourceIdFromUrl(config.siteId, url);
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, url });
  }
  return out;
}

/** Pull VIP-embedded city/neighborhood/state/domain from detail HTML. */
function extractVipFields(html: string): {
  city?: string;
  neighborhood?: string;
  state?: string;
  domainId?: string;
} {
  // The VIP tracking block renders the location fields adjacently:
  // `"city":"…","neighborhood":"…","state":"…"`. Anchoring `state` to that
  // adjacency avoids the earlier `"state":"VISIBLE"` UI-component flag, which is
  // the FIRST bare `"state"` on the page and previously polluted the region.
  const loc = html.match(
    /"city"\s*:\s*"([^"]+)"\s*,\s*"neighborhood"\s*:\s*"([^"]*)"\s*,\s*"state"\s*:\s*"([^"]+)"/,
  );
  const city = loc?.[1] ?? html.match(/"city"\s*:\s*"([^"]+)"/)?.[1];
  const neighborhood = (loc?.[2]?.trim() || undefined) ?? html.match(/"neighborhood"\s*:\s*"([^"]+)"/)?.[1];
  const state = loc?.[3];
  const domainId = html.match(/"domain_id"\s*:\s*"([^"]+)"/)?.[1];
  return { city, neighborhood, state, domainId };
}

/** First integer in a highlighted-specs label such as "2 dorm." / "1 baño". */
function labelInt(text: string): number | undefined {
  const match = text.match(/(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** First number in an area label such as "138 m² totales" / "30,5 m²". */
function labelArea(text: string): number | undefined {
  const match = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[1].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Bedrooms / bathrooms / covered area from the VIP highlighted-specs block —
 * the only reliable cold-HTTP source now that the public items API is
 * OAuth-gated. It is the first `"attributes":[…]` array carrying a `BATHROOM`
 * or `SCALE_UP` icon; each entry is an `{icon:{id},label:{text}}` pair
 * (`BED → "2 dorm."/"2 rec."`, `BATHROOM → "1 baño"`, `SCALE_UP → "75 m² totales"`).
 */
function extractHighlightedSpecs(html: string): {
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
} {
  const marker = '"attributes":[';
  let from = 0;
  for (;;) {
    const start = html.indexOf(marker, from);
    if (start < 0) break;
    const open = start + marker.length - 1;
    const end = html.indexOf(']', open);
    if (end < 0) break;
    const block = html.slice(open, end + 1);
    from = end + 1;
    if (!/"id":"(?:BATHROOM|SCALE_UP|BED|BEDROOM)"/.test(block)) continue;

    const result: { bedrooms?: number; bathrooms?: number; squareMeters?: number } = {};
    const pairRe = /"id":"([A-Z_]+)"[^}]*\}\s*,\s*"label":\{"text":"([^"]+)"/g;
    for (const match of block.matchAll(pairRe)) {
      const icon = match[1];
      const text = match[2];
      if (/^BED(?:ROOM)?$/.test(icon) && result.bedrooms === undefined) {
        result.bedrooms = labelInt(text);
      } else if (icon === 'BATHROOM' && result.bathrooms === undefined) {
        result.bathrooms = labelInt(text);
      } else if (icon === 'SCALE_UP' && result.squareMeters === undefined) {
        result.squareMeters = labelArea(text);
      }
    }
    return result;
  }
  return {};
}

/** Main-gallery image URLs from the server-rendered `gallery-image__link` anchors. */
function extractGalleryImages(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /class="gallery-image__link"[^>]{0,400}>\s{0,20}<img[^>]{0,400}\bsrc="(https:\/\/[^"]{0,2000})"/g;
  for (const match of html.matchAll(re)) {
    const url = match[1];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * Full VIP description copy from the server-rendered `ui-pdp-description__content`
 * paragraph. This is the only cold-HTTP source: the JSON-LD `Product` omits
 * `description` and the item `/description` API is OAuth-gated.
 */
function extractMercadolibreDescription(html: string): string | undefined {
  const match = html.match(/ui-pdp-description__content"[^>]{0,120}>([\s\S]{0,20000}?)<\/p>/);
  if (!match) return undefined;
  return stripHtmlToPlainText(match[1]);
}

/**
 * Publisher (agency / seller) display name from the `#seller_profile` link
 * MercadoLibre renders as `Publicado por <a href="#seller_profile">NAME</a>`.
 * VIP contact is form-gated (no `tel:`), so this name is the only advertiser
 * signal cold HTTP exposes — captured into {@link NormalizedListingContact.agencyName}.
 */
function extractMercadolibreSeller(html: string): string | undefined {
  const anchor = html.match(/href="#seller_profile"[^>]{0,120}>([^<]{1,80})<\/a>/);
  const name = stripHtmlToPlainText(anchor?.[1] ?? '');
  if (!name || /^(?:ver|más|mas|perfil|mercadol)/i.test(name)) return undefined;
  return name;
}

/**
 * Key → value rows of the VIP "striped specs" table. Each row is
 * `<th …><div class="andes-table__header__container">KEY</div></th>` followed by
 * `<td …><span … class="andes-table__column--value" …>VALUE</span></td>`. Both
 * AR (`Dormitorios`, `Cocheras`, `Antigüedad`) and MX (`Recámaras`,
 * `Estacionamientos`) render the same structure with localized labels.
 */
function parseMercadolibreSpecTable(html: string): Map<string, string> {
  const out = new Map<string, string>();
  const rowRe =
    /andes-table__header__container">([^<]{1,80})<\/div><\/th>[\s\S]{0,400}?andes-table__column--value[^>]{0,140}>([^<]{0,120})<\/span>/g;
  for (const match of html.matchAll(rowRe)) {
    const key = stripHtmlToPlainText(match[1]);
    const value = stripHtmlToPlainText(match[2]);
    if (key && value !== undefined && !out.has(key)) out.set(key, value);
  }
  return out;
}

/** Convert MercadoLibre item-API `attributes[]` into the same key→value spec map. */
function attributesToSpecMap(attrs: unknown): Map<string, string> {
  const out = new Map<string, string>();
  if (!Array.isArray(attrs)) return out;
  for (const entry of attrs) {
    if (!isRecord(entry)) continue;
    const name = asString(entry.name);
    const value = asString(entry.value_name) ?? asString(entry.value_struct);
    if (name && value && !out.has(name)) out.set(name, value);
  }
  return out;
}

function specInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function isAffirmative(value: string): boolean {
  const v = deaccent(value);
  return v === 'si' || v === 'yes' || v === 'true';
}

/**
 * Construction year from an `Antigüedad` value: a bare 4-digit year is used
 * directly; an age in years (`34 años`) or a brand-new marker (`A estrenar`)
 * resolves to `currentYear - age` / `currentYear`.
 */
function yearBuiltFromAntiquity(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const now = new Date().getFullYear();
  const yearMatch = raw.match(/\b(1[89]\d{2}|20\d{2})\b/);
  if (yearMatch) {
    const year = Number.parseInt(yearMatch[1], 10);
    return year >= 1850 && year <= now ? year : undefined;
  }
  if (/estrenar|a estrear|nuevo|construccion/.test(deaccent(raw))) return now;
  const age = specInt(raw);
  if (age !== undefined && age >= 0 && age <= 200) return now - age;
  return undefined;
}

interface MercadolibreSpecDerived {
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  floor?: number;
  yearBuilt?: number;
  parkingSpaces?: number;
  parkingType?: 'none' | 'garage';
  amenities: string[];
  furnished?: boolean;
}

/**
 * Derive structured fields + canonical amenities from the spec table (or item
 * attributes). Every `Sí` boolean row feeds the shared {@link canonicalizeAmenities}
 * (so `Ascensor`/`Aire acondicionado`/`Balcón`/… collapse onto the fixed
 * vocabulary); counts drive parking/storage; numeric rows fill bedrooms /
 * bathrooms / area / floor; `Antigüedad` yields `yearBuilt`.
 */
function derivedFromSpecTable(spec: Map<string, string>): MercadolibreSpecDerived {
  const get = (...keys: readonly string[]): string | undefined => {
    for (const [key, value] of spec) {
      if (keys.includes(deaccent(key))) return value;
    }
    return undefined;
  };

  const affirmativeLabels: string[] = [];
  for (const [key, value] of spec) {
    if (isAffirmative(value)) affirmativeLabels.push(key);
  }
  const { amenities, furnished } = canonicalizeAmenities(affirmativeLabels);

  const parkingSpaces = specInt(
    get('cocheras', 'estacionamientos', 'cochera', 'estacionamiento', 'garages', 'garage'),
  );
  let parkingType: 'none' | 'garage' | undefined;
  if (parkingSpaces !== undefined) {
    parkingType = parkingSpaces > 0 ? 'garage' : 'none';
    if (parkingSpaces > 0 && !amenities.includes('parking')) amenities.push('parking');
  }
  const storageCount = specInt(get('bauleras', 'bodegas', 'baulera', 'bodega'));
  if (storageCount !== undefined && storageCount > 0 && !amenities.includes('storage')) {
    amenities.push('storage');
  }

  const floorRaw = get('numero de piso de la unidad', 'numero de piso', 'nivel', 'piso');
  let floor = specInt(floorRaw);
  if (floor === undefined && floorRaw && /planta baja|ground|^pb$/.test(deaccent(floorRaw))) {
    floor = 0;
  }

  return {
    bedrooms: specInt(get('dormitorios', 'recamaras', 'habitaciones')),
    bathrooms: specInt(get('banos', 'bano')),
    squareMeters: labelArea(
      get('superficie total', 'superficie cubierta', 'superficie construida', 'superficie util') ?? '',
    ),
    floor,
    yearBuilt: yearBuiltFromAntiquity(get('antiguedad')),
    parkingSpaces,
    parkingType,
    amenities,
    furnished: furnished || undefined,
  };
}

export function parseMercadolibreDetail(
  config: MercadolibreSiteConfig,
  html: string,
  url: string,
): MercadolibreRawListing {
  const state = parsePreloadedState(html);
  if (state) {
    const items: Record<string, unknown>[] = [];
    collectResults(state, items);
    const wanted = mercadolibreSourceIdFromUrl(config.siteId, url);
    for (const item of items) {
      try {
        const raw = itemToRaw(config, item);
        if (
          raw &&
          (!wanted ||
            raw.sourceId === wanted ||
            raw.sourceId.replace(/\D/g, '') === wanted.replace(/\D/g, ''))
        ) {
          return raw;
        }
      } catch (error) {
        if (error instanceof NonHousingListingError) throw error;
      }
    }
  }

  const nodes = collectJsonLdNodes(html);
  const product =
    findJsonLdByType(nodes, 'Product') ?? findJsonLdByType(nodes, 'Residence') ?? nodes[0];
  if (!product) throw new Error(`${config.provider}: no detail payload for ${url}`);

  const offer = isRecord(product.offers) ? product.offers : undefined;
  const price = asNumber(offer?.price) ?? asNumber(product.price);
  const vip = extractVipFields(html);
  const address = isRecord(product.address) ? product.address : undefined;
  const city =
    asString(address?.addressLocality) ?? vip.city ?? config.defaultCity;
  if (price === undefined) throw new Error(`${config.provider}: missing price for ${url}`);

  const sourceId =
    mercadolibreSourceIdFromUrl(config.siteId, url) ??
    mercadolibreSourceIdFromUrl(config.siteId, asString(product.url) ?? '') ??
    (asString(product.productID) || asString(product.sku)
      ? normalizeSourceId(config, asString(product.productID) ?? asString(product.sku) ?? '')
      : undefined);
  if (!sourceId) throw new Error(`${config.provider}: missing id for ${url}`);

  const domainId = vip.domainId ?? 'REAL_ESTATE';
  if (!isMercadolibreHousingCategory('inmuebles', domainId)) {
    throw new NonHousingListingError(config.provider, sourceId, `domain ${domainId}`);
  }

  // Prefer the full server-rendered gallery; the JSON-LD `image` is a single URL.
  const images: string[] = extractGalleryImages(html);
  if (images.length === 0) {
    const imageVal = product.image;
    if (typeof imageVal === 'string') images.push(imageVal);
    else if (Array.isArray(imageVal)) {
      for (const entry of imageVal) {
        if (typeof entry === 'string') images.push(entry);
      }
    }
  }

  // Operation from the domain id (`…_FOR_SALE` / `…_FOR_RENT`) when present, since
  // the URL slug is not always decisive; fall back to the URL.
  const operation: 'rent' | 'sale' = /FOR_SALE|_SALE\b|VENTA/i.test(domainId)
    ? 'sale'
    : /FOR_RENT|_RENT\b|ALQUILER|ARRIENDO|RENTA/i.test(domainId)
      ? 'rent'
      : /venta/i.test(url)
        ? 'sale'
        : 'rent';

  const specs = extractHighlightedSpecs(html);
  const derived = derivedFromSpecTable(parseMercadolibreSpecTable(html));
  const agencyName = extractMercadolibreSeller(html);

  const raw: MercadolibreRawListing = {
    sourceId,
    url: asString(product.url) ?? url,
    title: asString(product.name),
    description: extractMercadolibreDescription(html) ?? asString(product.description),
    operation,
    price,
    currency: asString(offer?.priceCurrency) ?? config.defaultCurrency,
    bedrooms: specs.bedrooms ?? derived.bedrooms,
    bathrooms: specs.bathrooms ?? derived.bathrooms,
    squareMeters: specs.squareMeters ?? derived.squareMeters,
    floor: derived.floor,
    yearBuilt: derived.yearBuilt,
    parkingSpaces: derived.parkingSpaces,
    parkingType: derived.parkingType,
    amenities: derived.amenities.length > 0 ? derived.amenities : undefined,
    furnished: derived.furnished,
    address: {
      street: asString(address?.streetAddress),
      city,
      region: asString(address?.addressRegion) ?? vip.state,
      neighborhood: vip.neighborhood,
      countryCode: config.countryCode,
    },
    images,
    contact: mergeContact(
      contactFromUnknown(product.seller),
      extractContactFromHtml(html),
      buildContact({ agencyName }),
    ),
    category: 'inmuebles',
    domainId,
  };

  assertHousingListing(config.provider, sourceId, {
    category: 'inmuebles',
    typology: domainId,
    squareMeters: raw.squareMeters,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    hasAddressLike: true,
    hasPrice: true,
  });

  return raw;
}

export function parseMercadolibreItemJson(
  config: MercadolibreSiteConfig,
  body: string,
  fallbackUrl: string,
): MercadolibreRawListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    throw new Error(`${config.provider}: invalid item JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${config.provider}: item JSON not an object`);
  const raw = itemToRaw(config, parsed);
  if (!raw) throw new Error(`${config.provider}: empty item for ${fallbackUrl}`);
  return raw;
}

/** Housing-only search URL (departamentos alquiler). */
export function mercadolibreHousingSearchUrl(
  config: MercadolibreSiteConfig,
  city: string,
  page = 1,
  kind: 'alquiler' | 'arriendo' | 'renta' | 'venta' = 'alquiler',
): string {
  const slug = citySlug(city);
  const rentSegment = config.rentSegment ?? 'alquiler';
  const segment = kind === 'venta' ? 'venta' : rentSegment;
  const base = `${config.inmueblesBaseUrl}/departamentos/${segment}/${slug}/`;
  return page <= 1 ? base : `${base}_Desde_${(page - 1) * 48 + 1}_NoIndex_True`;
}

/** Public items API URL (often IP-gated; try from warmed session). */
export function mercadolibreItemApiUrl(config: MercadolibreSiteConfig, sourceId: string): string {
  const digits = sourceId.replace(/\D/g, '');
  return `https://api.mercadolibre.com/items/${config.siteId}${digits}`;
}
