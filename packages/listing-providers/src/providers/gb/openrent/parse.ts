/**
 * OpenRent parsers (housing-native private-landlord rentals).
 *
 * Search yields `/property-to-rent/.../<id>` links. Detail pages expose rent in
 * `<title>` and images via og:image; contact is often form-gated (best-effort).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../parse/contact';
import { isGbHousingType } from '../housing';
import { OPENRENT_BASE_URL } from './fixtures';

const DETAIL_PATH_RE =
  /href="(\/property-to-rent\/[^"]+\/(\d+))"/gi;

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface OpenRentListingJson {
  sourceId: string;
  url: string;
  title?: string;
  displayAddress?: string;
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  propertyType?: string;
  priceAmount?: number;
  priceCurrency?: string;
  images: string[];
  contact?: NormalizedListingContact;
}

export function openrentSourceIdFromUrl(url: string): string | undefined {
  const match = url.match(/\/(\d+)\/?$/);
  return match?.[1];
}

export function openrentSearchUrl(city: string, page = 1): string {
  const slug = city
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = `${OPENRENT_BASE_URL}/properties-to-rent/${slug}`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

export function parseOpenRentSearch(html: string): { sourceId: string; url: string }[] {
  const byId = new Map<string, string>();
  for (const match of html.matchAll(DETAIL_PATH_RE)) {
    const path = match[1];
    const sourceId = match[2];
    if (!path || !sourceId || byId.has(sourceId)) continue;
    if (!isGbHousingType(path)) continue;
    byId.set(sourceId, `${OPENRENT_BASE_URL}${path}`);
  }
  return [...byId.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}

export function parseOpenRentDetail(html: string, url: string): OpenRentListingJson {
  const sourceId = openrentSourceIdFromUrl(url);
  if (!sourceId) {
    throw new Error(`openrent: cannot parse source id from ${url}`);
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const title = titleMatch?.[1]
    ?.replace(/&#xA3;/gi, '£')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();

  if (title && !isGbHousingType(title)) {
    throw new Error(`openrent: non-housing listing rejected at ${url}`);
  }

  const rentMatch = title?.match(/£([\d,]+\.?\d*)\s*p\/m/i);
  const priceAmount = asNumber(rentMatch?.[1]);
  const bedsMatch = title?.match(/(\d+)\s*Bed/i);
  const bedrooms = bedsMatch ? Number.parseInt(bedsMatch[1], 10) : undefined;

  // "London - 1 Bed Flat, London, WC2N - To Rent..."
  let displayAddress: string | undefined;
  if (title) {
    const addr = title.match(/^\s*[^-]+-\s*(.+?)\s*-\s*To Rent/i);
    displayAddress = addr?.[1]?.trim();
  }

  const images = [
    ...new Set(
      [...html.matchAll(/https:\/\/imagescdn\.openrent\.co\.uk\/listings\/\d+\/[^"'>\s]+/gi)].map(
        (m) => m[0],
      ),
    ),
  ];

  const telMatch = html.match(/href="tel:([^"]+)"/i);
  const mailMatch = html.match(/href="mailto:([^"]+)"/i);
  const waMatch = html.match(/https:\/\/wa\.me\/(\d+)/i);
  const contact = buildContact({
    phone: telMatch?.[1],
    email: mailMatch?.[1],
    whatsapp: waMatch ? `https://wa.me/${waMatch[1]}` : undefined,
    agencyName: 'OpenRent landlord',
    kind: 'private',
  });

  const propertyType = title?.match(/\d+\s*Bed\s+([^,]+)/i)?.[1] ?? 'Flat';

  return {
    sourceId,
    url: url.startsWith('http') ? url : `${OPENRENT_BASE_URL}${url}`,
    title,
    displayAddress,
    bedrooms: Number.isFinite(bedrooms) ? bedrooms : undefined,
    propertyType,
    priceAmount,
    priceCurrency: 'GBP',
    images,
    contact,
  };
}
