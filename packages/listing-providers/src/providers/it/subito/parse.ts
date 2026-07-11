/**
 * Subito.it housing parsing — JSON-first with strict housing-category guards.
 *
 * Subito is a general classifieds portal. Discover URLs and normalize() MUST
 * reject non-housing categories (auto, lavoro, elettronica, …).
 *
 * The search page embeds full ad objects in `__NEXT_DATA__`
 * (`props.pageProps.initialState.items.originalList` / `galleryList`); each ad
 * carries price/size/rooms inside a `features` dict keyed by `/price`, `/size`,
 * `/room`, … The detail page migrated to the Next App Router and no longer
 * exposes a usable JSON payload, so the provider carries the full ad object from
 * discover to fetch via `ExternalListingRef.hints`.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, normalizePhone } from '../../../parse/contact';
import { asNumber as parseNumberFromGuard, asRecord, asString } from '../../../parse/guards';
import { extractItSchemaListings, pickItListing } from '../../../parse/jsonLd';
import { parseNextData } from '../../../parse/nextData';
import { SUBITO_BASE_URL, SUBITO_HOUSING_CATEGORIES } from './fixtures';

export interface SubitoRaw {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
  price?: number;
  currency: string;
  operation: 'rent' | 'sale';
  categoryUri: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  city?: string;
  region?: string;
  images: string[];
  furnished?: boolean;
  contact?: NormalizedListingContact;
}

const HOUSING_DETAIL_RE =
  /href=["']([^"']*\/(?:appartamenti|camere-posti-letto|ville-singole-e-a-schiera|terreni-e-rustici|garage-e-box|uffici-e-locali-commerciali)\/[^"']*-(\d{6,})\.htm)["']/gi;

const HOUSING_SET = new Set<string>(SUBITO_HOUSING_CATEGORIES);

/** Subito image CDN entries are base URLs; a `rule` query is required to render. */
const SUBITO_IMAGE_RULE = 'rule=fullscreen-1x-auto';

/** Coerce portal feature/price blobs that wrap the number in `{ value }`. */
function asNumber(value: unknown): number | undefined {
  return parseNumberFromGuard(value) ?? parseNumberFromGuard(asRecord(value)?.value);
}

export function isSubitoHousingCategory(uriOrPath: string): boolean {
  const lower = uriOrPath.toLowerCase();
  for (const category of HOUSING_SET) {
    if (lower.includes(`/${category}`) || lower.includes(category)) return true;
  }
  return false;
}

export function subitoSourceIdFromUrl(url: string): string | undefined {
  return url.match(/-(\d{6,})\.htm/i)?.[1] ?? url.match(/\/(\d{6,})(?:\.htm)?/i)?.[1];
}

/** City → region slug map for default discover cities. */
const CITY_REGIONS: Readonly<Record<string, string>> = {
  roma: 'lazio',
  milano: 'lombardia',
  napoli: 'campania',
  torino: 'piemonte',
  firenze: 'toscana',
  bologna: 'emilia-romagna',
};

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function subitoWarmSearchUrl(city: string, page = 1): string {
  const slug = citySlug(city);
  const region = CITY_REGIONS[slug] ?? 'lazio';
  // Housing-only: appartamenti in affitto (never site-wide crawl).
  const base = `${SUBITO_BASE_URL}/annunci-${region}/affitto/appartamenti/${slug}/`;
  return page <= 1 ? base : `${base}?o=${page}`;
}

function categoryFromUrl(url: string): string {
  const match = url.match(
    /\/(appartamenti|camere-posti-letto|ville-singole-e-a-schiera|terreni-e-rustici|garage-e-box|uffici-e-locali-commerciali|auto|motori|lavoro)\//i,
  );
  return match?.[1]?.toLowerCase() ?? '';
}

function categoryUriFromAd(record: Record<string, unknown>, url: string): string {
  const category = asRecord(record.category);
  return (
    asString(category?.friendlyName) ??
    asString(category?.uri) ??
    asString(category?.label) ??
    categoryFromUrl(url)
  );
}

function urnSourceId(urn: string | undefined): string | undefined {
  if (!urn) return undefined;
  return urn.match(/:list:(\d{6,})/i)?.[1] ?? urn.match(/:(\d{6,})/)?.[1];
}

function collectHousingRefs(value: unknown, out: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectHousingRefs(entry, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  const urls = asRecord(record.urls);
  const url =
    asString(urls?.default) ?? asString(record.url) ?? asString(record.detailUrl) ?? asString(record.href);
  if (url && isSubitoHousingCategory(categoryUriFromAd(record, url) || url)) {
    const sourceId =
      subitoSourceIdFromUrl(url) ?? urnSourceId(asString(record.urn)) ?? asString(record.id);
    if (sourceId) out.set(sourceId, url.startsWith('http') ? url : `${SUBITO_BASE_URL}${url}`);
  }

  for (const child of Object.values(record)) collectHousingRefs(child, out);
}

export function parseSubitoSearchJson(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  try {
    const out = new Map<string, string>();
    collectHousingRefs(JSON.parse(trimmed) as unknown, out);
    return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
  } catch {
    return [];
  }
}

export function parseSubitoSearch(html: string): { sourceId: string; url: string }[] {
  const listings = parseSubitoSearchListings(html);
  if (listings.length > 0) {
    return listings.map((listing) => ({ sourceId: listing.sourceId, url: listing.url }));
  }
  const next = parseNextData(html);
  if (next) {
    const out = new Map<string, string>();
    collectHousingRefs(next, out);
    if (out.size > 0) {
      return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
    }
  }
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const match of html.matchAll(HOUSING_DETAIL_RE)) {
    const href = match[1];
    const sourceId = match[2];
    if (!href || !sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    const url = href.startsWith('http') ? href : `${SUBITO_BASE_URL}${href}`;
    refs.push({ sourceId, url });
  }
  return refs;
}

/** First `{ key, value }` of a Subito feature (`features['/price'].values[0]`). */
function featureFirstValue(
  features: Record<string, unknown> | undefined,
  uri: string,
): Record<string, unknown> | undefined {
  const feature = asRecord(features?.[uri]);
  const values = feature?.values;
  return Array.isArray(values) ? asRecord(values[0]) : undefined;
}

function featureNumber(features: Record<string, unknown> | undefined, uri: string): number | undefined {
  const first = featureFirstValue(features, uri);
  return parseNumberFromGuard(first?.key) ?? parseNumberFromGuard(first?.value);
}

function featureIsYes(features: Record<string, unknown> | undefined, uri: string): boolean {
  return asString(featureFirstValue(features, uri)?.key) === '1';
}

/** Subito ad `type` encodes the offering: `u` = affitto (rent), `s` = vendita (sale). */
function operationFromAd(ad: Record<string, unknown>, url: string, categoryUri: string): 'rent' | 'sale' {
  const type = asRecord(ad.type);
  const typeKey = asString(type?.key)?.toLowerCase();
  const typeValue = asString(type?.value)?.toLowerCase() ?? '';
  if (typeKey === 's' || /vendita|vendo/.test(typeValue)) return 'sale';
  if (typeKey === 'u' || /affitto/.test(typeValue)) return 'rent';
  if (/vendita/i.test(url) || /vendita/i.test(categoryUri)) return 'sale';
  return 'rent';
}

/** Absolute, render-ready image URL from a Subito CDN entry (base needs a `rule`). */
function subitoImageUrl(raw: string): string | undefined {
  if (!raw.startsWith('http')) return undefined;
  return raw.includes('?') ? raw : `${raw}?${SUBITO_IMAGE_RULE}`;
}

function subitoContact(advertiser: Record<string, unknown> | undefined): NormalizedListingContact | undefined {
  if (!advertiser) return undefined;
  const isCompany = advertiser.company === true;
  const name = asString(advertiser.name);
  return buildContact({
    phone: normalizePhone(asString(advertiser.phone)),
    name: isCompany ? undefined : name,
    agencyName: asString(advertiser.shopName) ?? (isCompany ? name : undefined),
    kind: isCompany ? 'agency' : 'private',
  });
}

function listingFromAd(ad: Record<string, unknown>, fallbackUrl: string): SubitoRaw {
  const urls = asRecord(ad.urls);
  const url = asString(urls?.default) ?? asString(ad.url) ?? fallbackUrl;
  const categoryUri = categoryUriFromAd(ad, url);
  const sourceId =
    subitoSourceIdFromUrl(url) ?? urnSourceId(asString(ad.urn)) ?? asString(ad.id) ?? 'unknown';

  const geo = asRecord(ad.geo) ?? {};
  const features = asRecord(ad.features);

  const images: string[] = [];
  const imageNodes = Array.isArray(ad.images) ? ad.images : [];
  for (const image of imageNodes) {
    const record = asRecord(image);
    const raw = asString(record?.cdnBaseUrl) ?? asString(record?.url) ?? asString(record?.uri);
    const src = raw ? subitoImageUrl(raw) : undefined;
    if (src) images.push(src);
  }

  const raw: SubitoRaw = {
    sourceId,
    url,
    currency: 'EUR',
    operation: operationFromAd(ad, url, categoryUri),
    categoryUri,
    images,
  };
  const title = asString(ad.subject) ?? asString(ad.title);
  if (title) raw.title = title;
  const description = asString(ad.body) ?? asString(ad.description);
  if (description) raw.description = description;
  const price = featureNumber(features, '/price') ?? asNumber(ad.price);
  if (price !== undefined) raw.price = price;
  const bedrooms =
    featureNumber(features, '/room') ?? featureNumber(features, '/rooms') ?? featureNumber(features, '/locali');
  if (bedrooms !== undefined) raw.bedrooms = bedrooms;
  const bathrooms = featureNumber(features, '/bathrooms') ?? featureNumber(features, '/bathroom');
  if (bathrooms !== undefined) raw.bathrooms = bathrooms;
  const squareMeters = featureNumber(features, '/size') ?? featureNumber(features, '/surface');
  if (squareMeters !== undefined) raw.squareMeters = squareMeters;
  const city = asString(asRecord(geo.town)?.value) ?? asString(asRecord(geo.city)?.value);
  if (city) raw.city = city;
  const region = asString(asRecord(geo.region)?.value);
  if (region) raw.region = region;
  if (featureIsYes(features, '/furnished')) raw.furnished = true;
  const contact = subitoContact(asRecord(ad.advertiser));
  if (contact) raw.contact = contact;
  return raw;
}

/** A node is a Subito ad when it carries a detail URL plus ad-shaped fields. */
function findAdNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) findAdNodes(entry, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const hasUrl = record.urls !== undefined || record.url !== undefined;
  const looksLikeAd =
    hasUrl &&
    (record.urn !== undefined || record.category !== undefined) &&
    (record.subject !== undefined || record.features !== undefined || record.title !== undefined);
  if (looksLikeAd) {
    out.push(record);
    return;
  }
  for (const child of Object.values(record)) findAdNodes(child, out);
}

/** Full ad objects from the search page `__NEXT_DATA__` (housing-only, priced). */
export function parseSubitoSearchListings(html: string): SubitoRaw[] {
  const next = parseNextData(html);
  if (!next) return [];
  const ads: Record<string, unknown>[] = [];
  findAdNodes(next, ads);
  const out: SubitoRaw[] = [];
  const seen = new Set<string>();
  for (const ad of ads) {
    const listing = listingFromAd(ad, '');
    if (listing.sourceId === 'unknown' || !listing.url) continue;
    if (!isSubitoHousingCategory(listing.categoryUri || listing.url)) continue;
    if (listing.price === undefined) continue;
    if (seen.has(listing.sourceId)) continue;
    seen.add(listing.sourceId);
    out.push(listing);
  }
  return out;
}

/**
 * Validate a `hints.listing` payload carried from discover (survives BullMQ JSON).
 * Returns a `SubitoRaw` only when it has the minimum shape to normalize.
 */
export function coerceSubitoRaw(value: unknown): SubitoRaw | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  if (
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.categoryUri !== 'string' ||
    typeof record.price !== 'number' ||
    !Array.isArray(record.images)
  ) {
    return undefined;
  }
  return record as unknown as SubitoRaw;
}

export function parseSubitoDetail(html: string, url: string): SubitoRaw {
  const next = parseNextData(html);
  if (next) {
    const ads: Record<string, unknown>[] = [];
    findAdNodes(next, ads);
    const wantId = subitoSourceIdFromUrl(url);
    const parsed = ads.map((ad) => listingFromAd(ad, url)).filter((listing) => listing.price !== undefined);
    const chosen = parsed.find((listing) => listing.sourceId === wantId) ?? parsed[0];
    if (chosen) {
      if (!isSubitoHousingCategory(chosen.categoryUri || chosen.url)) {
        throw new Error(`subito: non-housing category rejected (${chosen.categoryUri || chosen.url})`);
      }
      return chosen;
    }
  }

  // Reject non-housing URLs even when only JSON-LD is present.
  if (!isSubitoHousingCategory(url)) {
    throw new Error(`subito: non-housing URL rejected (${url})`);
  }

  const schema = pickItListing(extractItSchemaListings(html));
  if (!schema || schema.price === undefined) {
    throw new Error(`subito: no housing listing payload at ${url}`);
  }
  const sourceId = subitoSourceIdFromUrl(schema.url ?? url) ?? subitoSourceIdFromUrl(url);
  if (!sourceId) throw new Error(`subito: cannot derive source id from ${url}`);
  const raw: SubitoRaw = {
    sourceId,
    url: schema.url ?? url,
    price: schema.price,
    currency: schema.priceCurrency ?? 'EUR',
    operation: schema.operation ?? 'rent',
    categoryUri: categoryFromUrl(schema.url ?? url),
    images: schema.images,
  };
  if (schema.name) raw.title = schema.name;
  if (schema.description) raw.description = schema.description;
  if (schema.bedrooms !== undefined) raw.bedrooms = schema.bedrooms;
  if (schema.bathrooms !== undefined) raw.bathrooms = schema.bathrooms;
  if (schema.squareMeters !== undefined) raw.squareMeters = schema.squareMeters;
  if (schema.address.city) raw.city = schema.address.city;
  if (schema.address.region) raw.region = schema.address.region;
  if (schema.furnished !== undefined) raw.furnished = schema.furnished;
  return raw;
}
