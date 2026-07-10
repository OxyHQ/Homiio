/**
 * Shared Navent portal parsers (Zonaprop, Plusvalía, Argenprop, …).
 *
 * Navent sites share `listPostings` / `rplis-api/postings`,
 * `window.__PRELOADED_STATE__`, and schema.org RealEstateListing JSON-LD.
 * Portal modules supply {@link NaventSiteConfig}; they must NOT re-copy this
 * tree-walk. Contact via shared {@link ./contact}; preloaded via {@link ./nextData};
 * JSON-LD via {@link ./jsonLd}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, contactFromUnknown, mergeContact } from './contact';
import { collectJsonLdNodes, findJsonLdByType, jsonLdTypes } from './jsonLd';
import { parsePreloadedState } from './nextData';

export interface NaventSiteConfig {
  /** Provider id used in error messages (e.g. `zonaprop`). */
  provider: string;
  /** Origin without trailing slash (e.g. `https://www.zonaprop.com.ar`). */
  baseUrl: string;
  /** ISO-2 country code stamped on addresses. */
  countryCode: string;
  /** Fallback city when posting omits locality. */
  defaultCity: string;
  /** Default currency when posting omits it (ARS / USD / …). */
  defaultCurrency: string;
  /**
   * Regex (global) capturing listing href + numeric id.
   * Group 1 = path/url, group 2 = sourceId digits.
   */
  hrefRe: RegExp;
}

export interface NaventSearchRef {
  sourceId: string;
  url: string;
}

export interface NaventRawListing {
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
  address: {
    street?: string;
    city: string;
    region?: string;
    countryCode: string;
  };
  coordinates?: { lat: number; lng: number };
  images: string[];
  contact?: NormalizedListingContact;
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

/** Cloudflare / short-body challenge detector shared by Navent brands. */
export function isNaventChallenge(body: string): boolean {
  if (body.trim().length < 128) return true;
  return /just a moment|cloudflare|cf-mitigated|captcha|datadome|access denied/i.test(body);
}

/** Extract numeric posting id from a Navent detail URL (`…-12345678.html`). */
export function naventSourceIdFromUrl(url: string): string | undefined {
  const match = /-(\d{5,})(?:\.html)?(?:\?|#|$)/i.exec(url);
  return match?.[1];
}

function absoluteUrl(config: NaventSiteConfig, pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  return `${config.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function featureValue(features: unknown, key: string): number | undefined {
  if (!isRecord(features)) return undefined;
  const entry = features[key];
  if (isRecord(entry)) return asNumber(entry.value);
  return asNumber(entry);
}

function operationFromName(name: string | undefined): 'rent' | 'sale' {
  const lower = (name ?? '').toLowerCase();
  if (/venta|sale|buy/.test(lower)) return 'sale';
  return 'rent';
}

function collectPostings(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isRecord(entry) && (entry.postingId || entry.url)) out.push(entry);
      else collectPostings(entry, out);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.listPostings)) {
    collectPostings(value.listPostings, out);
    return;
  }
  if (isRecord(value.postingSearch)) {
    collectPostings(value.postingSearch, out);
    return;
  }
  for (const child of Object.values(value)) {
    if (out.length > 50) return;
    collectPostings(child, out);
  }
}

function postingToRaw(
  config: NaventSiteConfig,
  posting: Record<string, unknown>,
): NaventRawListing | undefined {
  const sourceId =
    asString(posting.postingId) ??
    (typeof posting.url === 'string' ? naventSourceIdFromUrl(posting.url) : undefined);
  const path = asString(posting.url);
  if (!sourceId || !path) return undefined;
  const url = absoluteUrl(config, path);
  const priceObj = isRecord(posting.price) ? posting.price : undefined;
  const price = asNumber(priceObj?.amount) ?? asNumber(posting.price);
  if (price === undefined) return undefined;

  const location = isRecord(posting.postingLocation) ? posting.postingLocation : undefined;
  const addressNode = isRecord(location?.address) ? location.address : undefined;
  const city =
    asString(isRecord(addressNode?.city) ? addressNode.city.name : undefined) ??
    asString(addressNode?.city) ??
    config.defaultCity;
  const region = asString(isRecord(addressNode?.state) ? addressNode.state.name : undefined);
  const street = asString(addressNode?.name) ?? asString(addressNode?.streetAddress);
  const opName = asString(isRecord(posting.operationType) ? posting.operationType.name : undefined);
  const propType = asString(isRecord(posting.realEstateType) ? posting.realEstateType.name : undefined);
  const features = posting.mainFeatures;
  const images: string[] = [];
  if (Array.isArray(posting.pictures)) {
    for (const pic of posting.pictures) {
      if (!isRecord(pic)) continue;
      const img =
        asString(pic.urlSoft360Overwrite) ?? asString(pic.url) ?? asString(pic.resizeUrl1200x1200);
      if (img) images.push(img);
    }
  }

  const contact = contactFromUnknown(posting.publisher ?? posting.advertiser);

  return {
    sourceId,
    url,
    title: asString(posting.title),
    description: asString(posting.description) ?? asString(posting.title),
    operation: operationFromName(opName),
    price,
    currency: asString(priceObj?.currency) ?? config.defaultCurrency,
    propertyType: propType,
    bedrooms: featureValue(features, 'CFT100'),
    bathrooms: featureValue(features, 'CFT101'),
    squareMeters: featureValue(features, 'CFT2'),
    address: {
      street,
      city,
      region,
      countryCode: config.countryCode,
    },
    images,
    contact,
  };
}

/** Parse Navent search/detail JSON (`listPostings`) into refs. */
export function parseNaventSearchJson(config: NaventSiteConfig, body: string): NaventSearchRef[] {
  const trimmed = body.trim();
  if (!trimmed || isNaventChallenge(trimmed)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const postings: Record<string, unknown>[] = [];
  collectPostings(parsed, postings);
  const out: NaventSearchRef[] = [];
  const seen = new Set<string>();
  for (const posting of postings) {
    const raw = postingToRaw(config, posting);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    out.push({ sourceId: raw.sourceId, url: raw.url });
  }
  return out;
}

/** Parse search HTML via `__PRELOADED_STATE__` or posting hrefs. */
export function parseNaventSearch(config: NaventSiteConfig, html: string): NaventSearchRef[] {
  const state = parsePreloadedState(html);
  if (state) {
    const fromState = parseNaventSearchJson(config, JSON.stringify(state));
    if (fromState.length > 0) return fromState;
  }
  const out: NaventSearchRef[] = [];
  const seen = new Set<string>();
  const hrefRe = new RegExp(config.hrefRe.source, config.hrefRe.flags.includes('g') ? config.hrefRe.flags : `${config.hrefRe.flags}g`);
  for (const match of html.matchAll(hrefRe)) {
    const pathOrUrl = match[1] ?? '';
    const sourceId = match[2];
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, url: absoluteUrl(config, pathOrUrl) });
  }
  return out;
}

function listingFromJsonLd(
  config: NaventSiteConfig,
  html: string,
  fallbackUrl: string,
): NaventRawListing | undefined {
  const nodes = collectJsonLdNodes(html);
  const node =
    findJsonLdByType(nodes, 'RealEstateListing') ??
    findJsonLdByType(nodes, 'Residence') ??
    findJsonLdByType(nodes, 'Apartment') ??
    findJsonLdByType(nodes, 'House') ??
    nodes.find((n) => {
      const types = jsonLdTypes(n);
      return types.some((t) => /residence|apartment|house|product|offer/i.test(t));
    });
  if (!node) return undefined;

  const subject = isRecord(node.about) ? node.about : isRecord(node.mainEntity) ? node.mainEntity : node;
  const offer = isRecord(node.offers) ? node.offers : isRecord(subject.offers) ? subject.offers : undefined;
  const price = asNumber(offer?.price) ?? asNumber(node.price);
  const address = isRecord(subject.address) ? subject.address : isRecord(node.address) ? node.address : undefined;
  const city = asString(address?.addressLocality) ?? asString(address?.city);
  if (price === undefined || !city) return undefined;

  const url = asString(node.url) ?? asString(subject.url) ?? fallbackUrl;
  const sourceId = naventSourceIdFromUrl(url) ?? naventSourceIdFromUrl(fallbackUrl);
  if (!sourceId) return undefined;

  const geo = isRecord(subject.geo) ? subject.geo : isRecord(node.geo) ? node.geo : undefined;
  const lat = asNumber(geo?.latitude);
  const lng = asNumber(geo?.longitude);
  const business = asString(offer?.businessFunction)?.toLowerCase() ?? '';
  const operation: 'rent' | 'sale' =
    business.includes('sell') || business.includes('sale') ? 'sale' : 'rent';

  const images: string[] = [];
  const imageVal = subject.image ?? node.image;
  if (typeof imageVal === 'string') images.push(imageVal);
  else if (Array.isArray(imageVal)) {
    for (const entry of imageVal) {
      if (typeof entry === 'string') images.push(entry);
      else if (isRecord(entry) && asString(entry.url)) images.push(asString(entry.url)!);
    }
  }

  const phone = asString(node.telephone) ?? asString(subject.telephone);
  const contact = mergeContact(buildContact({ phone }), contactFromUnknown(node.seller ?? node.publisher));

  const floorSize = isRecord(subject.floorSize) ? subject.floorSize : isRecord(node.floorSize) ? node.floorSize : undefined;

  return {
    sourceId,
    url: absoluteUrl(config, url),
    title: asString(node.name) ?? asString(subject.name),
    description: asString(node.description) ?? asString(subject.description),
    operation,
    price,
    currency: asString(offer?.priceCurrency) ?? config.defaultCurrency,
    bedrooms: asNumber(subject.numberOfRooms) ?? asNumber(subject.numberOfBedrooms) ?? asNumber(node.numberOfRooms),
    bathrooms: asNumber(subject.numberOfBathroomsTotal) ?? asNumber(node.numberOfBathroomsTotal),
    squareMeters: asNumber(floorSize?.value) ?? asNumber(floorSize),
    address: {
      street: asString(address?.streetAddress),
      city,
      region: asString(address?.addressRegion),
      countryCode: config.countryCode,
    },
    coordinates: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    images,
    contact,
  };
}

/** Parse detail HTML (JSON-LD preferred, then preloaded posting). */
export function parseNaventDetail(
  config: NaventSiteConfig,
  html: string,
  url: string,
): NaventRawListing {
  const fromLd = listingFromJsonLd(config, html, url);
  if (fromLd) return fromLd;

  const state = parsePreloadedState(html);
  if (state) {
    const postings: Record<string, unknown>[] = [];
    collectPostings(state, postings);
    const wanted = naventSourceIdFromUrl(url);
    const match =
      (wanted ? postings.find((p) => asString(p.postingId) === wanted) : undefined) ?? postings[0];
    if (match) {
      const raw = postingToRaw(config, match);
      if (raw) return raw;
    }
  }

  throw new Error(`${config.provider}: no listing payload for ${url}`);
}

/** Parse a single posting JSON body (rplis-api detail-ish). */
export function parseNaventPostingJson(
  config: NaventSiteConfig,
  body: string,
  fallbackUrl: string,
): NaventRawListing {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    throw new Error(`${config.provider}: invalid posting JSON`);
  }
  const postings: Record<string, unknown>[] = [];
  if (isRecord(parsed) && (parsed.postingId || parsed.url)) postings.push(parsed);
  else collectPostings(parsed, postings);
  const raw = postings[0] ? postingToRaw(config, postings[0]) : undefined;
  if (!raw) throw new Error(`${config.provider}: empty posting for ${fallbackUrl}`);
  return raw;
}

/** Standard Navent postings AJAX endpoint. */
export function naventPostingsApiUrl(config: NaventSiteConfig): string {
  return `${config.baseUrl}/rplis-api/postings`;
}

export function naventPostingDetailApiUrls(config: NaventSiteConfig, sourceId: string): string[] {
  return [
    `${config.baseUrl}/rplis-api/postings/${sourceId}`,
    `${config.baseUrl}/api/postings/${sourceId}`,
  ];
}
