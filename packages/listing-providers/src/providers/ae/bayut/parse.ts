/**
 * Bayut (UAE) parsers — `__NEXT_DATA__` via shared nextData helpers.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../contact';
import { parseNextData, nextDataPageProps } from '../../../nextData';
import { asNumber, asString, isRecord } from '../../../parse/guards';
import { isCloudflareChallenge } from '../../../parse/challenge';
import { BAYUT_BASE_URL } from './fixtures';

export interface BayutSearchRef {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
}

export interface BayutRawListing {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
  kind: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  address: {
    street?: string;
    city: string;
    state?: string;
    neighborhood?: string;
    countryCode: string;
    coordinates?: { lat: number; lng: number };
  };
  images: string[];
  contact?: NormalizedListingContact;
}

export function isBayutChallenge(html: string): boolean {
  if (isCloudflareChallenge(html)) return true;
  return /hb-captcha|x-hb-co|access denied|unusual traffic/i.test(html);
}

export function bayutSourceIdFromUrl(url: string): string | undefined {
  const match = /(?:details-|property\/details\/)(\d+)/i.exec(url) ?? /-(\d{5,})(?:\.html)?$/i.exec(url);
  return match?.[1];
}

function absoluteBayutUrl(slug: string, externalId: string): string {
  if (slug.startsWith('http')) return slug.split('?')[0] ?? slug;
  const clean = slug.replace(/\/+$/g, '');
  if (clean.includes('property/details')) return `${BAYUT_BASE_URL}/${clean}`;
  return `${BAYUT_BASE_URL}/property/details-${externalId}.html`;
}

function locationNames(location: unknown): { city: string; neighborhood?: string } {
  if (!Array.isArray(location)) return { city: 'UAE' };
  const names = location
    .map((entry) => (isRecord(entry) ? asString(entry.name) : undefined))
    .filter((name): name is string => Boolean(name));
  const city = names.find((name) => name !== 'UAE') ?? 'UAE';
  const neighborhood = names.length >= 3 ? names[names.length - 1] : undefined;
  return { city, neighborhood };
}

function resolveKind(hit: Record<string, unknown>): 'rent' | 'sale' {
  const purpose = asString(hit.purpose)?.toLowerCase();
  if (purpose === 'for-rent' || purpose === 'rent') return 'rent';
  return 'sale';
}

function resolveMonthlyRent(price: number, hit: Record<string, unknown>): number {
  const frequency = asString(hit.rentFrequency)?.toLowerCase();
  if (frequency === 'monthly') return price;
  if (frequency === 'weekly') return Math.round((price * 52) / 12);
  if (frequency === 'daily') return Math.round(price * 30);
  return Math.round(price / 12);
}

function resolveContact(hit: Record<string, unknown>): NormalizedListingContact | undefined {
  const agency = isRecord(hit.agency) ? hit.agency : undefined;
  const phone = isRecord(hit.phoneNumber) ? hit.phoneNumber : undefined;
  return buildContact({
    phone: asString(phone?.mobile) ?? asString(phone?.phone),
    name: asString(hit.contactName),
    agencyName: asString(agency?.name),
    kind: 'agency',
  });
}

function collectImages(hit: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const cover = isRecord(hit.coverPhoto) ? hit.coverPhoto : undefined;
  const coverUrl = asString(cover?.url);
  if (coverUrl) urls.push(coverUrl);
  const photos = Array.isArray(hit.photos) ? hit.photos : [];
  for (const photo of photos) {
    if (!isRecord(photo)) continue;
    const url = asString(photo.url);
    if (url) urls.push(url);
  }
  return [...new Set(urls)];
}

function hitToRaw(hit: Record<string, unknown>): BayutRawListing | undefined {
  const sourceId = asString(hit.externalID) ?? asString(hit.id);
  const slug = asString(hit.slug);
  if (!sourceId) return undefined;
  const url = slug ? absoluteBayutUrl(slug, sourceId) : `${BAYUT_BASE_URL}/property/details-${sourceId}.html`;

  const kind = resolveKind(hit);
  const price = asNumber(hit.price);
  if (price === undefined || price <= 0) return undefined;
  const normalizedPrice = kind === 'rent' ? resolveMonthlyRent(price, hit) : price;

  const location = locationNames(hit.location);
  const geo = isRecord(hit.geo) ? hit.geo : undefined;
  const lat = asNumber(geo?.lat);
  const lng = asNumber(geo?.lng);
  const area = asNumber(hit.area);

  const raw: BayutRawListing = {
    sourceId,
    url,
    title: asString(hit.title),
    description: asString(hit.description),
    kind,
    price: normalizedPrice,
    currency: 'AED',
    bedrooms: asNumber(hit.rooms),
    bathrooms: asNumber(hit.baths),
    squareMeters: area !== undefined ? Math.round(area * 0.092903) : undefined,
    address: {
      city: location.city,
      neighborhood: location.neighborhood,
      countryCode: 'AE',
      coordinates:
        lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    },
    images: collectImages(hit),
    contact: resolveContact(hit),
  };
  return raw;
}

function hitsFromPageProps(pageProps: Record<string, unknown>): Record<string, unknown>[] {
  const searchResult = isRecord(pageProps.searchResult) ? pageProps.searchResult : undefined;
  const searchHits = Array.isArray(searchResult?.hits) ? searchResult.hits : [];
  if (searchHits.length > 0) {
    return searchHits.filter((entry): entry is Record<string, unknown> => isRecord(entry));
  }
  const property = pageProps.property;
  if (isRecord(property)) return [property];
  return [];
}

/** Parse search/detail `__NEXT_DATA__` into listing refs. */
export function parseBayutSearch(html: string): BayutSearchRef[] {
  const pageProps = nextDataPageProps(parseNextData(html));
  if (!pageProps) return [];
  const refs: BayutSearchRef[] = [];
  const seen = new Set<string>();
  for (const hit of hitsFromPageProps(pageProps)) {
    const raw = hitToRaw(hit);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    refs.push({ sourceId: raw.sourceId, url: raw.url, kind: raw.kind });
  }
  return refs;
}

/** Parse detail `__NEXT_DATA__` into a raw listing. */
export function parseBayutDetail(html: string, url: string): BayutRawListing {
  const pageProps = nextDataPageProps(parseNextData(html));
  if (!pageProps) {
    throw new Error(`bayut: no __NEXT_DATA__ at ${url}`);
  }
  const hits = hitsFromPageProps(pageProps);
  const first = hits[0];
  if (!first) {
    throw new Error(`bayut: __NEXT_DATA__ missing property at ${url}`);
  }
  const raw = hitToRaw(first);
  if (!raw) {
    throw new Error(`bayut: could not normalize property at ${url}`);
  }
  return raw;
}

export function bayutSearchUrl(locationSlug: string, purpose: 'for-rent' | 'for-sale', page = 1): string {
  const pathPurpose = purpose === 'for-rent' ? 'to-rent' : 'for-sale';
  const base = `${BAYUT_BASE_URL}/${pathPurpose}/property/${locationSlug}/`;
  return page <= 1 ? base : `${base}?page=${page}`;
}
