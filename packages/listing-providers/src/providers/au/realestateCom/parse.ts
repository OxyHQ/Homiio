/**
 * realestate.com.au parsers — `window.ArgonautExchange` embedded JSON (JSON-first).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { isCloudflareChallenge } from '../../../parse/challenge';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { REALESTATE_COM_AU_BASE_URL } from './fixtures';

export interface RealestateComAuSearchRef {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
}

export interface RealestateComAuRawListing {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: string;
  propertyType?: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  address: {
    street?: string;
    city: string;
    state?: string;
    postalCode?: string;
    countryCode: string;
    coordinates?: { lat: number; lng: number };
  };
  images: string[];
  contact?: NormalizedListingContact;
}

const SEARCH_EXPERIENCE = 'resi-property_search-experience-web';
const DETAIL_EXPERIENCE = 'resi-property_listing-experience-web';

export function isRealestateComAuChallenge(html: string): boolean {
  if (isCloudflareChallenge(html)) return true;
  return /x-kpsdk|kasada|access denied|request has been blocked/i.test(html);
}

/** Extract numeric listing id from canonical property URLs. */
export function realestateComAuSourceIdFromUrl(url: string): string | undefined {
  const match = /-(\d{6,})(?:\/?$|\?)/i.exec(url);
  return match?.[1];
}

function extractArgonautRoot(html: string): Record<string, unknown> | undefined {
  const marker = 'window.ArgonautExchange=';
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  const braceStart = html.indexOf('{', idx + marker.length);
  if (braceStart < 0) return undefined;
  let depth = 0;
  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(html.slice(braceStart, i + 1));
          return isRecord(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function parseUrqlPayload(root: Record<string, unknown>, experienceKey: string): unknown {
  const experience = root[experienceKey];
  if (!isRecord(experience)) return undefined;
  const cacheRaw = experience.urqlClientCache;
  if (typeof cacheRaw !== 'string') return undefined;
  try {
    const cacheParsed: unknown = JSON.parse(cacheRaw);
    if (!isRecord(cacheParsed)) return undefined;
    const first = Object.values(cacheParsed).find((entry) => isRecord(entry));
    if (!isRecord(first) || typeof first.data !== 'string') return undefined;
    return JSON.parse(first.data) as unknown;
  } catch {
    return undefined;
  }
}

function featureValue(node: unknown): number | undefined {
  if (!isRecord(node)) return undefined;
  return asNumber(node.value);
}

function resolveKind(listing: Record<string, unknown>, url: string): 'rent' | 'sale' {
  const channel = asString(listing.channel)?.toLowerCase();
  if (channel === 'rent') return 'rent';
  if (channel === 'buy' || channel === 'sale') return 'sale';
  if (/rent|per-week|pw/i.test(url)) return 'rent';
  return 'sale';
}

function resolvePrice(listing: Record<string, unknown>, kind: 'rent' | 'sale'): number | undefined {
  const direct = asNumber(listing.priceValue);
  if (direct !== undefined && direct > 0) return direct;
  const price = isRecord(listing.price) ? listing.price : undefined;
  const display = asString(price?.display) ?? asString(listing.price);
  if (!display) return undefined;
  const digits = display.replace(/[^0-9.]/g, '');
  const parsed = Number.parseFloat(digits);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  if (kind === 'rent' && /week|pw/i.test(display)) return parsed;
  if (kind === 'rent' && /month|pm/i.test(display)) return parsed;
  return parsed;
}

function resolveImages(listing: Record<string, unknown>): string[] {
  const media = isRecord(listing.media) ? listing.media : undefined;
  const images = media && Array.isArray(media.images) ? media.images : [];
  const urls: string[] = [];
  for (const entry of images) {
    if (!isRecord(entry)) continue;
    const templated = asString(entry.templatedUrl) ?? asString(entry.url);
    if (!templated) continue;
    urls.push(templated.replace('{size}', '800x600'));
  }
  return [...new Set(urls)];
}

function resolveContact(listing: Record<string, unknown>): NormalizedListingContact | undefined {
  const company = isRecord(listing.listingCompany) ? listing.listingCompany : undefined;
  const listers = Array.isArray(listing.listers) ? listing.listers : [];
  const firstLister = listers.find((entry) => isRecord(entry));
  const listerPhone = isRecord(firstLister?.phoneNumber)
    ? asString(firstLister.phoneNumber.display)
    : undefined;
  return buildContact({
    phone: asString(company?.businessPhone) ?? listerPhone,
    name: asString(firstLister?.name),
    agencyName: asString(company?.name),
    kind: 'agency',
  });
}

function listingNodeToRaw(listing: Record<string, unknown>): RealestateComAuRawListing | undefined {
  const links = isRecord(listing._links) ? listing._links : undefined;
  const canonical = isRecord(links?.canonical) ? links.canonical : undefined;
  const url = asString(canonical?.href);
  const sourceId = asString(listing.id) ?? (url ? realestateComAuSourceIdFromUrl(url) : undefined);
  if (!sourceId || !url) return undefined;

  const kind = resolveKind(listing, url);
  const price = resolvePrice(listing, kind);
  if (price === undefined) return undefined;

  const address = isRecord(listing.address) ? listing.address : undefined;
  const display = isRecord(address?.display) ? address.display : undefined;
  const geocode = isRecord(display?.geocode) ? display.geocode : undefined;
  const city = asString(address?.suburb) ?? 'Australia';
  const state = asString(address?.state);
  const postalCode = asString(address?.postcode);
  const street = asString(display?.shortAddress);
  const lat = asNumber(geocode?.latitude);
  const lng = asNumber(geocode?.longitude);

  const propertyType = isRecord(listing.propertyType)
    ? asString(listing.propertyType.display)
    : asString(listing.propertyType);
  const sizes = isRecord(listing.propertySizes) ? listing.propertySizes : undefined;
  const building = isRecord(sizes?.building) ? sizes.building : undefined;
  const sqm = asNumber(building?.displayValue);

  const features = isRecord(listing.generalFeatures) ? listing.generalFeatures : undefined;

  const raw: RealestateComAuRawListing = {
    sourceId,
    url,
    description: asString(listing.description),
    kind,
    price,
    currency: 'AUD',
    propertyType,
    bedrooms: featureValue(features?.bedrooms),
    bathrooms: featureValue(features?.bathrooms),
    squareMeters: sqm,
    address: {
      street,
      city,
      state,
      postalCode,
      countryCode: 'AU',
      coordinates:
        lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    },
    images: resolveImages(listing),
    contact: resolveContact(listing),
  };
  if (propertyType) raw.title = propertyType;
  return raw;
}

/** Parse search-page ArgonautExchange into listing refs. */
export function parseRealestateComAuSearch(html: string): RealestateComAuSearchRef[] {
  const root = extractArgonautRoot(html);
  if (!root) return [];
  const payload = parseUrqlPayload(root, SEARCH_EXPERIENCE);
  if (!isRecord(payload)) return [];
  const results = isRecord(payload.results) ? payload.results : undefined;
  const exact = isRecord(results?.exact) ? results.exact : undefined;
  const items = Array.isArray(exact?.items) ? exact.items : [];
  const refs: RealestateComAuSearchRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) continue;
    const listing = isRecord(item.listing) ? item.listing : item;
    const raw = listingNodeToRaw(listing);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    refs.push({ sourceId: raw.sourceId, url: raw.url, kind: raw.kind });
  }
  return refs;
}

/** Parse detail-page ArgonautExchange into a raw listing. */
export function parseRealestateComAuDetail(html: string, url: string): RealestateComAuRawListing {
  const root = extractArgonautRoot(html);
  if (!root) {
    throw new Error(`realestate_com_au: no ArgonautExchange JSON at ${url}`);
  }
  const payload = parseUrqlPayload(root, DETAIL_EXPERIENCE);
  if (!isRecord(payload)) {
    throw new Error(`realestate_com_au: ArgonautExchange missing detail payload at ${url}`);
  }
  const details = isRecord(payload.details) ? payload.details : undefined;
  const listing = isRecord(details?.listing) ? details.listing : undefined;
  if (!listing) {
    throw new Error(`realestate_com_au: ArgonautExchange missing details.listing at ${url}`);
  }
  const raw = listingNodeToRaw(listing);
  if (!raw) {
    throw new Error(`realestate_com_au: could not normalize listing at ${url}`);
  }
  return raw;
}

export function realestateComAuSearchUrl(citySlug: string, channel: 'rent' | 'buy', page = 1): string {
  const base = `${REALESTATE_COM_AU_BASE_URL}/${channel}/in-${citySlug}`;
  return page <= 1 ? `${base}/list-1` : `${base}/list-${page}`;
}
