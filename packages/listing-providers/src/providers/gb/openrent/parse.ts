/**
 * OpenRent parsers (housing-native private-landlord rentals).
 *
 * Search yields `/property-to-rent/.../<id>` links. Detail pages expose rent in
 * `<title>` and images via og:image; contact is often form-gated (best-effort).
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact } from '../../../parse/contact';
import { stripHtmlToPlainText } from '../../../parse/htmlText';
import { isGbHousingType, rejectGbNonHousing } from '../housing';
import { OPENRENT_BASE_URL } from './fixtures';

/** Square feet → square metres (the app stores `squareFootage` in m²). */
const SQFT_TO_SQM = 0.092903;

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
  /** Floor area in square metres (converted from sq ft when the copy uses it). */
  squareMeters?: number;
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

/**
 * Full property gallery. OpenRent renders each photo in a `lightbox_item`
 * anchor as a PROTOCOL-RELATIVE `<img src="//imagescdn.openrent.co.uk/listings/
 * <photosetId>/o_….JPG">` — the `https:`-only regex used before matched just the
 * cover (og:image). Images group by photoset id; the FIRST set is the property's
 * own gallery, a later set belongs to the "similar properties" carousel, so only
 * the first set is kept. Map (`staticMapPhotoForProperty`) and avatar
 * (`userPhotos`) images live under other paths and are excluded.
 */
function extractOpenRentImages(html: string): string[] {
  const bySet = new Map<string, string[]>();
  const re =
    /<img[^>]{0,200}\bsrc="(?:https?:)?(\/\/imagescdn\.openrent\.co\.uk\/listings\/(\d+)\/[^"]+\.(?:jpe?g|png|webp))"/gi;
  for (const match of html.matchAll(re)) {
    const setId = match[2];
    const url = `https:${match[1]}`;
    const list = bySet.get(setId) ?? [];
    if (!list.includes(url)) list.push(url);
    bySet.set(setId, list);
  }
  for (const list of bySet.values()) {
    if (list.length > 0) return list;
  }
  // Fallback: any absolute listing image (e.g. og:image cover).
  return [
    ...new Set(
      [...html.matchAll(/https:\/\/imagescdn\.openrent\.co\.uk\/listings\/\d+\/[^"'>\s]+/gi)].map(
        (m) => m[0],
      ),
    ),
  ];
}

/**
 * Count from the property summary strip, e.g.
 * `<span class="text-secondary-emphasis">2 <span …>bathrooms</span></span>`.
 * More reliable than title parsing for bathrooms (absent from the title).
 */
function summaryStat(html: string, unit: string): number | undefined {
  const re = new RegExp(
    `text-secondary-emphasis"[^>]{0,40}>\\s*(\\d+)\\s*(?:<[^>]{0,80}>\\s*)?${unit}`,
    'i',
  );
  const match = html.match(re);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** The `#descriptionText` block copy (used for floor-area extraction). */
function descriptionRegion(html: string): string | undefined {
  const idx = html.indexOf('id="descriptionText"');
  if (idx < 0) return undefined;
  const open = html.indexOf('>', idx);
  if (open < 0) return undefined;
  return stripHtmlToPlainText(html.slice(open + 1, open + 1 + 8000));
}

/**
 * Floor area in m² from listing copy — OpenRent only exposes it as free text
 * (`721sq ft`, `approximately 160 sqm`), never a structured field. Square feet
 * are converted to m²; the result is sanity-bounded (5–2000 m²).
 */
function floorAreaSqm(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.match(
    /(\d[\d,]*(?:\.\d+)?)\s*(sq\s?\.?\s?ft|sqft|square\s?f(?:ee|oo)t|m²|sqm|sq\s?m|square\s?met)/i,
  );
  if (!match) return undefined;
  const value = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const isImperial = /ft|feet|foot/i.test(match[2]);
  const sqm = isImperial ? value * SQFT_TO_SQM : value;
  if (sqm < 5 || sqm > 2000) return undefined;
  return Math.round(sqm);
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
    rejectGbNonHousing('openrent', sourceId, `title "${title}"`);
  }

  const rentMatch = title?.match(/£([\d,]+\.?\d*)\s*p\/m/i);
  const priceAmount = asNumber(rentMatch?.[1]);
  const bedsMatch = title?.match(/(\d+)\s*Bed/i);
  const bedrooms = bedsMatch ? Number.parseInt(bedsMatch[1], 10) : summaryStat(html, 'bedrooms?');
  const bathrooms = summaryStat(html, 'bathrooms?');
  const squareMeters = floorAreaSqm(descriptionRegion(html));

  // "London - 1 Bed Flat, London, WC2N - To Rent..."
  let displayAddress: string | undefined;
  if (title) {
    const addr = title.match(/^\s*[^-]+-\s*(.+?)\s*-\s*To Rent/i);
    displayAddress = addr?.[1]?.trim();
  }

  const images = extractOpenRentImages(html);

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
    bedrooms: bedrooms !== undefined && Number.isFinite(bedrooms) ? bedrooms : undefined,
    bathrooms,
    squareMeters,
    propertyType,
    priceAmount,
    priceCurrency: 'GBP',
    images,
    contact,
  };
}
