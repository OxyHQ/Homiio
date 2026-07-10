/**
 * Subito.it housing parsing — JSON-first with strict housing-category guards.
 *
 * Subito is a general classifieds portal. Discover URLs and normalize() MUST
 * reject non-housing categories (auto, lavoro, elettronica, …).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromAdvertiser, normalizePhone } from '../../../parse/contact';
import { extractItSchemaListings, pickItListing } from '../../../parse/jsonLd';
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

const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const HOUSING_DETAIL_RE =
  /href=["']([^"']*\/(?:appartamenti|camere-posti-letto|ville-singole-e-a-schiera|terreni-e-rustici|garage-e-box|uffici-e-locali-commerciali)\/[^"']*-(\d{6,})\.htm)["']/gi;

const HOUSING_SET = new Set<string>(SUBITO_HOUSING_CATEGORIES);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (asRecord(value)) return asNumber(asRecord(value)?.value);
  return undefined;
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

export function subitoWarmSearchUrl(city: string, page = 1): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const region = CITY_REGIONS[slug] ?? 'lazio';
  // Housing-only: appartamenti in affitto (never site-wide crawl).
  const base = `${SUBITO_BASE_URL}/annunci-${region}/affitto/appartamenti/${slug}/`;
  return page <= 1 ? base : `${base}?o=${page}`;
}

export function subitoSearchApiUrl(city: string, page = 1): string {
  const slug = city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const region = CITY_REGIONS[slug] ?? 'lazio';
  return `${SUBITO_BASE_URL}/api/v1.0/search/items?t=2&q=&c=appartamenti&r=${encodeURIComponent(region)}&ci=${encodeURIComponent(slug)}&o=${page}`;
}

function categoryFromUrl(url: string): string {
  const match = url.match(
    /\/(appartamenti|camere-posti-letto|ville-singole-e-a-schiera|terreni-e-rustici|garage-e-box|uffici-e-locali-commerciali|auto|motori|lavoro)\//i,
  );
  return match?.[1]?.toLowerCase() ?? '';
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
  const category =
    asString(asRecord(record.category)?.uri) ??
    asString(asRecord(record.category)?.label) ??
    (url ? categoryFromUrl(url) : '');

  if (url && isSubitoHousingCategory(category || url)) {
    const sourceId =
      subitoSourceIdFromUrl(url) ??
      asString(record.urn)?.match(/:(\d{6,}):/)?.[1] ??
      asString(record.id);
    if (sourceId) out.set(sourceId, url.startsWith('http') ? url : `${SUBITO_BASE_URL}${url}`);
  }

  for (const key of ['ads', 'items', 'results', 'list', 'data', 'pageProps', 'props', 'adList']) {
    if (key in record) collectHousingRefs(record[key], out);
  }
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
  const next = html.match(NEXT_DATA_RE)?.[1];
  if (next) {
    const fromJson = parseSubitoSearchJson(next);
    if (fromJson.length > 0) return fromJson;
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

function featureValue(features: Record<string, unknown> | undefined, key: string): number | undefined {
  if (!features) return undefined;
  return asNumber(features[key]);
}

function listingFromAd(ad: Record<string, unknown>, fallbackUrl: string): SubitoRaw {
  const urls = asRecord(ad.urls);
  const url = asString(urls?.default) ?? asString(ad.url) ?? fallbackUrl;
  const categoryUri =
    asString(asRecord(ad.category)?.uri) ??
    asString(asRecord(ad.category)?.label) ??
    categoryFromUrl(url);
  const sourceId =
    subitoSourceIdFromUrl(url) ??
    asString(ad.urn)?.match(/:(\d{6,}):/)?.[1] ??
    asString(ad.id) ??
    'unknown';

  const geo = asRecord(ad.geo) ?? {};
  const features = asRecord(ad.features) ?? {};
  const price = asNumber(ad.price) ?? asNumber(asRecord(ad.price)?.value);
  const images: string[] = [];
  const imageNodes = Array.isArray(ad.images) ? ad.images : [];
  for (const image of imageNodes) {
    const record = asRecord(image);
    const src = asString(record?.cdnBaseUrl) ?? asString(record?.url);
    if (src?.startsWith('http')) images.push(src);
  }

  const advertiser = asRecord(ad.advertiser);
  let contact = contactFromAdvertiser(advertiser);
  if (advertiser) {
    const phones = Array.isArray(advertiser.phones) ? advertiser.phones : [];
    const phone = normalizePhone(asString(asRecord(phones[0])?.value) ?? asString(phones[0]));
    if (phone || asString(advertiser.name)) {
      contact = {
        ...(contact ?? {}),
        ...(phone ? { phone: contact?.phone ?? phone } : {}),
        ...(asString(advertiser.name) && !contact?.agencyName
          ? { agencyName: asString(advertiser.name) }
          : {}),
        kind: contact?.kind ?? 'agency',
      };
    }
  }

  const operation: 'rent' | 'sale' =
    /vendita|sale/i.test(url) || /vendita/i.test(categoryUri) ? 'sale' : 'rent';

  const raw: SubitoRaw = {
    sourceId,
    url,
    currency: 'EUR',
    operation,
    categoryUri,
    images,
  };
  const title = asString(ad.subject) ?? asString(ad.title);
  if (title) raw.title = title;
  const description = asString(ad.body) ?? asString(ad.description);
  if (description) raw.description = description;
  if (price !== undefined) raw.price = price;
  const bedrooms = featureValue(features, 'rooms') ?? featureValue(features, 'locali');
  if (bedrooms !== undefined) raw.bedrooms = bedrooms;
  const bathrooms = featureValue(features, 'bathroom') ?? featureValue(features, 'bathrooms');
  if (bathrooms !== undefined) raw.bathrooms = bathrooms;
  const squareMeters = featureValue(features, 'size') ?? featureValue(features, 'surface');
  if (squareMeters !== undefined) raw.squareMeters = squareMeters;
  const city = asString(asRecord(geo.city)?.value) ?? asString(asRecord(geo.town)?.value);
  if (city) raw.city = city;
  const region = asString(asRecord(geo.region)?.value);
  if (region) raw.region = region;
  if (asNumber(features.furnished) === 1 || asString(asRecord(features.furnished)?.value) === '1') {
    raw.furnished = true;
  }
  if (contact) raw.contact = contact;
  return raw;
}

function findAdNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) findAdNodes(entry, out);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  if (record.urn || record.subject || (record.category && record.urls)) {
    out.push(record);
  }
  for (const key of ['ad', 'item', 'pageProps', 'props', 'data']) {
    if (key in record) findAdNodes(record[key], out);
  }
}

export function parseSubitoDetail(html: string, url: string): SubitoRaw {
  const next = html.match(NEXT_DATA_RE)?.[1];
  if (next) {
    try {
      const ads: Record<string, unknown>[] = [];
      findAdNodes(JSON.parse(next) as unknown, ads);
      for (const ad of ads) {
        const listing = listingFromAd(ad, url);
        if (!isSubitoHousingCategory(listing.categoryUri || listing.url)) {
          throw new Error(
            `subito: non-housing category rejected (${listing.categoryUri || listing.url})`,
          );
        }
        return listing;
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('subito: non-housing')) throw error;
      // Fall through to JSON-LD.
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
  return {
    sourceId,
    url: schema.url ?? url,
    title: schema.name,
    description: schema.description,
    price: schema.price,
    currency: schema.priceCurrency ?? 'EUR',
    operation: schema.operation ?? 'rent',
    categoryUri: categoryFromUrl(schema.url ?? url),
    bedrooms: schema.bedrooms,
    bathrooms: schema.bathrooms,
    squareMeters: schema.squareMeters,
    city: schema.address.city,
    region: schema.address.region,
    images: schema.images,
    furnished: schema.furnished,
  };
}
