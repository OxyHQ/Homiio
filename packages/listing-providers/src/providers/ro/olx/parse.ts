/**
 * OLX.ro imobiliare parsers — housing category only (general classifieds guard).
 *
 * Discover is restricted to `/imobiliare/…` category URLs. Normalize rejects
 * non-housing via shared {@link isHousingCategory} / category checks.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { isHousingCategory } from '../../../classifieds';
import { buildContact, contactFromAjaxBody, mergeContact } from '../../../contact';
import { OLX_RO_BASE_URL } from './fixtures';

const OFFER_HREF_RE =
  /href="((?:https:\/\/www\.olx\.ro)?\/d\/oferta\/[^"]+-ID[A-Za-z0-9]+\.html)[^"]*"/gi;

/** Slug tokens that indicate a non-housing classified slipped into a housing SERP chrome. */
const NON_HOUSING_SLUG_RE =
  /loc-de-munca|job-|angaj|auto-|masina|telefon|electronice|mobila|servicii/i;

const PRERENDERED_RE = /__PRERENDERED_STATE__\s*=\s*"([\s\S]*?)"\s*;?\s*<\/script>/i;

/** Explicit housing category path prefixes (never site-wide crawl). */
export const OLX_RO_HOUSING_PATHS: readonly string[] = [
  '/imobiliare/apartamente-garsoniere-de-inchiriat/',
  '/imobiliare/apartamente-garsoniere-de-vanzare/',
  '/imobiliare/case-de-vanzare/',
  '/imobiliare/case-de-inchiriat/',
  '/imobiliare/terenuri/',
];

export const OLX_RO_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  'imobiliare',
  'apartamente-garsoniere-de-inchiriat',
  'apartamente-garsoniere-de-vanzare',
  'case-de-vanzare',
  'case-de-inchiriat',
  'terenuri',
]);

export interface OlxRoSearchRef {
  sourceId: string;
  url: string;
}

export interface OlxRoRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  operation: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  squareMeters?: number;
  floor?: number;
  address: {
    street?: string;
    city: string;
    region?: string;
    neighborhood?: string;
    countryCode: string;
  };
  images: string[];
  contact?: NormalizedListingContact;
  categoryType: string;
  numericId?: string;
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

export function olxRoSourceIdFromUrl(url: string): string | undefined {
  const match = /-ID([A-Za-z0-9]+)(?:\.html)?(?:\?|$)/i.exec(url);
  return match?.[1] ? `ID${match[1]}` : undefined;
}

function absoluteOfferUrl(href: string): string {
  const clean = href.split('?')[0] ?? href;
  if (clean.startsWith('http')) return clean;
  return `${OLX_RO_BASE_URL}${clean.startsWith('/') ? clean : `/${clean}`}`;
}

/** Parse housing search HTML for `/d/oferta/…` refs. */
export function parseOlxRoSearch(html: string): OlxRoSearchRef[] {
  const out = new Map<string, string>();
  for (const match of html.matchAll(OFFER_HREF_RE)) {
    const href = match[1];
    if (!href) continue;
    if (NON_HOUSING_SLUG_RE.test(href)) continue;
    const sourceId = olxRoSourceIdFromUrl(href);
    if (!sourceId) continue;
    out.set(sourceId, absoluteOfferUrl(href));
  }
  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}

function decodePrerenderedState(html: string): Record<string, unknown> | undefined {
  const match = PRERENDERED_RE.exec(html);
  const escaped = match?.[1];
  if (!escaped) return undefined;
  try {
    // Portal stores a JSON string literal (escaped quotes).
    const inner = JSON.parse(`"${escaped}"`) as string;
    const parsed: unknown = JSON.parse(inner);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function paramValue(params: unknown, key: string): string | undefined {
  if (!Array.isArray(params)) return undefined;
  for (const entry of params) {
    if (!isRecord(entry)) continue;
    if (asString(entry.key) === key) {
      return asString(entry.normalizedValue) ?? asString(entry.value);
    }
  }
  return undefined;
}

function inferOperation(url: string, title: string): 'rent' | 'sale' {
  const hay = `${url} ${title}`.toLowerCase();
  if (/inchir|rent|chirie/.test(hay)) return 'rent';
  return 'sale';
}

/** True when the ad is housing (`real_estate` / housing category tokens). */
export function isOlxRoHousingCategory(categoryType: string | undefined): boolean {
  if ((categoryType ?? '').toLowerCase() === 'real_estate') return true;
  return isHousingCategory(categoryType);
}

export function parseOlxRoDetail(html: string, url: string): OlxRoRawListing {
  const state = decodePrerenderedState(html);
  if (!state) {
    throw new Error('olx_ro: detail page has no __PRERENDERED_STATE__');
  }
  const adWrap = isRecord(state.ad) ? state.ad : undefined;
  const ad = adWrap && isRecord(adWrap.ad) ? adWrap.ad : adWrap;
  if (!ad) {
    throw new Error('olx_ro: prerendered state missing ad');
  }

  const category = isRecord(ad.category) ? ad.category : undefined;
  const categoryType = asString(category?.type) ?? 'unknown';
  const sourceId =
    olxRoSourceIdFromUrl(url) ??
    olxRoSourceIdFromUrl(asString(ad.url) ?? '') ??
    asString(ad.id);
  if (!sourceId) {
    throw new Error('olx_ro: could not resolve sourceId');
  }

  const priceObj = isRecord(ad.price) ? ad.price : undefined;
  const regular = priceObj && isRecord(priceObj.regularPrice) ? priceObj.regularPrice : undefined;
  const price = asNumber(regular?.value) ?? asNumber(priceObj?.value);
  if (price === undefined) {
    throw new Error(`olx_ro: listing ${sourceId} has no price`);
  }

  const location = isRecord(ad.location) ? ad.location : undefined;
  const title = asString(ad.title) ?? `Listing ${sourceId}`;
  const photos = Array.isArray(ad.photos)
    ? ad.photos
        .map((entry) => {
          if (typeof entry === 'string') return entry;
          if (isRecord(entry)) return asString(entry.link) ?? asString(entry.url);
          return undefined;
        })
        .filter((entry): entry is string => Boolean(entry))
    : [];

  const result: OlxRoRawListing = {
    sourceId,
    url: asString(ad.url) ?? absoluteOfferUrl(url),
    title,
    operation: inferOperation(url, title),
    price,
    currency: asString(regular?.currencyCode) ?? 'EUR',
    address: {
      city: asString(location?.cityName) ?? 'Romania',
      region: asString(location?.regionName),
      neighborhood: asString(location?.districtName),
      countryCode: 'RO',
    },
    images: photos,
    categoryType,
  };

  const description = asString(ad.description);
  if (description) result.description = description;
  const rooms = asNumber(paramValue(ad.params, 'rooms'));
  if (rooms !== undefined) result.bedrooms = rooms;
  const area = asNumber(paramValue(ad.params, 'm'));
  if (area !== undefined) result.squareMeters = area;
  const floorRaw = paramValue(ad.params, 'floor');
  if (floorRaw) {
    const floorMatch = /(?:fl_)?(\d+)/i.exec(floorRaw);
    if (floorMatch?.[1]) result.floor = Number.parseInt(floorMatch[1], 10);
  }
  const numericId = asString(ad.id);
  if (numericId) result.numericId = numericId;

  const contactObj = isRecord(ad.contact) ? ad.contact : undefined;
  const user = isRecord(ad.user) ? ad.user : undefined;
  // `contact.phone: true` means gated — numeric phone via limited-phones AJAX.
  const phone = typeof contactObj?.phone === 'string' ? contactObj.phone : undefined;
  const contact = buildContact({
    name: asString(contactObj?.name) ?? asString(user?.name),
    agencyName: asString(user?.company_name),
    phone,
    whatsapp: phone,
    kind: asString(user?.company_name) ? 'agency' : 'private',
  });
  if (contact) result.contact = contact;

  return result;
}

/** Merge revealed phone JSON from `/api/v1/offers/:id/limited-phones/`. */
export function mergeOlxRoPhone(listing: OlxRoRawListing, body: string): OlxRoRawListing {
  const fromAjax = contactFromAjaxBody(body);
  const contact = mergeContact(listing.contact, fromAjax);
  return contact ? { ...listing, contact } : listing;
}

export function isOlxRoChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /cf-challenge|just a moment|access denied|captcha/i.test(html);
}
