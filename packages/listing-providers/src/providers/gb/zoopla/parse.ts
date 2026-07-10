/**
 * Zoopla parsers (United Kingdom).
 *
 * Zoopla fronts Cloudflare — cold HTTP usually 403. Prefer a warmed Playwright
 * session, then parse `__NEXT_DATA__` / listing JSON when present, else
 * `/to-rent/details/<id>/` link scrape for discover.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, contactFromUnknown } from '../../../parse/contact';
import { asNumberUs as asNumber, asString, isRecord } from '../../../parse/guards';
import { parseNextData } from '../../../parse/nextData';
import { isGbHousingType } from '../housing';
import { ZOOPLA_BASE_URL } from './fixtures';

const DETAIL_RE = /https?:\/\/www\.zoopla\.co\.uk\/(?:to-rent|for-sale)\/details\/(\d+)\/?/gi;


export interface ZooplaListingJson {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  displayAddress?: string;
  summary?: string;
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  propertyType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  latitude?: number;
  longitude?: number;
  images: string[];
  contact?: NormalizedListingContact;
}

export function zooplaSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/details\/(\d+)/i);
  return match?.[1];
}

export function zooplaDetailUrl(sourceId: string, kind: 'rent' | 'sale' = 'rent'): string {
  const path = kind === 'rent' ? 'to-rent' : 'for-sale';
  return `${ZOOPLA_BASE_URL}/${path}/details/${sourceId}/`;
}

export function zooplaSearchUrl(city: string, page = 1): string {
  const slug = city
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `${ZOOPLA_BASE_URL}/to-rent/property/${slug}/`;
  return page <= 1 ? base : `${base}?pn=${page}`;
}

export function parseZooplaSearch(html: string): { sourceId: string; url: string; kind: 'rent' | 'sale' }[] {
  const byId = new Map<string, { url: string; kind: 'rent' | 'sale' }>();
  for (const match of html.matchAll(DETAIL_RE)) {
    const sourceId = match[1];
    if (!sourceId || byId.has(sourceId)) continue;
    const start = Math.max(0, (match.index ?? 0) - 120);
    const ctx = html.slice(start, (match.index ?? 0) + match[0].length + 40);
    if (!isGbHousingType(ctx) && /garage|parking|storage|land\b/i.test(ctx)) continue;
    const kind: 'rent' | 'sale' = /for-sale/i.test(match[0]) ? 'sale' : 'rent';
    byId.set(sourceId, { url: zooplaDetailUrl(sourceId, kind), kind });
  }
  // Also try __NEXT_DATA__ listing cards when present.
  const parsed = parseNextData(html);
  if (parsed) collectZooplaListingIds(parsed, byId, 0);
  return [...byId.entries()].map(([sourceId, value]) => ({
    sourceId,
    url: value.url,
    kind: value.kind,
  }));
}

function collectZooplaListingIds(
  node: unknown,
  out: Map<string, { url: string; kind: 'rent' | 'sale' }>,
  depth: number,
): void {
  if (depth > 14) return;
  if (Array.isArray(node)) {
    for (const entry of node) collectZooplaListingIds(entry, out, depth + 1);
    return;
  }
  if (!isRecord(node)) return;
  const listingId =
    asString(node.listingId) ??
    asString(node.listing_id) ??
    (asNumber(node.listingId) !== undefined ? String(Math.trunc(asNumber(node.listingId)!)) : undefined);
  if (listingId && /^\d{5,}$/.test(listingId) && !out.has(listingId)) {
    const title = asString(node.title) ?? asString(node.propertyType) ?? asString(node.property_type);
    if (isGbHousingType(title)) {
      const status = asString(node.listingStatus) ?? asString(node.status) ?? 'rent';
      const kind: 'rent' | 'sale' = /sale/i.test(status) ? 'sale' : 'rent';
      out.set(listingId, { url: zooplaDetailUrl(listingId, kind), kind });
    }
  }
  for (const value of Object.values(node)) collectZooplaListingIds(value, out, depth + 1);
}

function findListingNode(node: unknown, depth = 0): Record<string, unknown> | undefined {
  if (depth > 16) return undefined;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findListingNode(entry, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  const hasId = node.listingId !== undefined || node.listing_id !== undefined;
  const hasPrice = node.price !== undefined || node.pricing !== undefined;
  if (hasId && hasPrice) return node;
  for (const value of Object.values(node)) {
    const found = findListingNode(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function imagesFromNode(node: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (entry: unknown): void => {
    if (typeof entry === 'string' && entry.startsWith('http')) {
      out.push(entry);
      return;
    }
    if (isRecord(entry)) {
      const url = asString(entry.url) ?? asString(entry.src) ?? asString(entry.original);
      if (url?.startsWith('http')) out.push(url);
    }
  };
  for (const key of ['image', 'images', 'photos', 'propertyImage', 'gallery']) {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(push);
    else push(value);
  }
  return [...new Set(out)];
}

function priceFromNode(node: Record<string, unknown>): number | undefined {
  if (isRecord(node.pricing)) {
    return (
      asNumber(node.pricing.price) ??
      asNumber(node.pricing.rentPrice) ??
      asNumber(node.pricing.amount)
    );
  }
  if (isRecord(node.price)) {
    return asNumber(node.price.amount) ?? asNumber(node.price.value);
  }
  return asNumber(node.price) ?? asNumber(node.rentalPrice);
}

export function parseZooplaDetail(html: string, url: string, kindHint: 'rent' | 'sale' = 'rent'): ZooplaListingJson {
  const sourceId = zooplaSourceIdFromUrl(url);
  if (!sourceId) throw new Error(`zoopla: cannot parse source id from ${url}`);

  const parsed = parseNextData(html);
  if (parsed) {
    try {
      const node = findListingNode(parsed);
      if (node) {
        const propertyType =
          asString(node.propertyType) ?? asString(node.property_type) ?? asString(node.title);
        if (!isGbHousingType(propertyType)) {
          throw new Error(`zoopla: non-housing listing rejected at ${url}`);
        }
        const status = asString(node.listingStatus) ?? asString(node.status);
        const kind: 'rent' | 'sale' = status && /sale/i.test(status) ? 'sale' : kindHint;
        const address = isRecord(node.address) ? node.address : undefined;
        const location = isRecord(node.location) ? node.location : isRecord(node.coordinates) ? node.coordinates : undefined;
        const agent = node.branch ?? node.agent ?? node.advertiser;
        const contact = isRecord(agent)
          ? buildContact({
              phone: asString(agent.telephone) ?? asString(agent.phone),
              email: asString(agent.email),
              agencyName: asString(agent.name) ?? asString(agent.displayName),
              kind: 'agency',
            })
          : contactFromUnknown(agent) ??
            buildContact({
              phone: asString(node.phone),
              agencyName: asString(node.agentName),
              kind: 'agency',
            });
        return {
          sourceId,
          url: zooplaDetailUrl(sourceId, kind),
          kind,
          displayAddress:
            asString(node.displayAddress) ??
            (address ? asString(address.fullAddress) ?? asString(address.postalAddress) : undefined),
          summary: asString(node.summary) ?? asString(node.title),
          description: asString(node.description),
          bedrooms: asNumber(node.numBedrooms) ?? asNumber(node.bedrooms),
          bathrooms: asNumber(node.numBathrooms) ?? asNumber(node.bathrooms),
          propertyType,
          priceAmount: priceFromNode(node),
          priceCurrency: 'GBP',
          latitude: location ? asNumber(location.latitude) ?? asNumber(location.lat) : undefined,
          longitude: location ? asNumber(location.longitude) ?? asNumber(location.lng) ?? asNumber(location.lon) : undefined,
          images: imagesFromNode(node),
          contact,
        };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('non-housing')) throw error;
    }
  }

  // Minimal HTML fallback from title / og tags when JSON missing.
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim();
  if (title && !isGbHousingType(title)) {
    throw new Error(`zoopla: non-housing listing rejected at ${url}`);
  }
  const priceMatch = title?.match(/£([\d,]+)/);
  const images = [
    ...new Set(
      [...html.matchAll(/https:\/\/lid\.zoocdn\.com\/[^"'>\s]+/gi)].map((m) => m[0]),
    ),
  ];
  return {
    sourceId,
    url: zooplaDetailUrl(sourceId, kindHint),
    kind: kindHint,
    displayAddress: title,
    priceAmount: asNumber(priceMatch?.[1]),
    priceCurrency: 'GBP',
    images,
  };
}
