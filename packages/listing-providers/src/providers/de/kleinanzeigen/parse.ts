/**
 * Kleinanzeigen immobilien parsing (pure).
 *
 * General classifieds portal — discover/normalize are HARD-GATED to housing
 * category ids (see {@link KLEINANZEIGEN_HOUSING_CATEGORY_IDS}). Non-housing
 * ads (cars, jobs, …) are rejected. Prefer structured og:/attribute fields;
 * contact is best-effort from tel:/wa.me links when the page exposes them.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import {
  KLEINANZEIGEN_BASE_URL,
  KLEINANZEIGEN_HOUSING_CATEGORY_IDS,
} from './fixtures';

export interface KleinanzeigenSearchRef {
  sourceId: string;
  url: string;
  categoryId: string;
}

export interface KleinanzeigenRawListing {
  sourceId: string;
  url: string;
  categoryId: string;
  title?: string;
  description?: string;
  operation: 'rent' | 'sale';
  price?: number;
  currency: string;
  bedrooms?: number;
  squareMeters?: number;
  floor?: number;
  address: {
    street?: string;
    city?: string;
    neighborhood?: string;
    region?: string;
    lat?: number;
    lng?: number;
  };
  images: string[];
  contact?: NormalizedListingContact;
}

/** Match `/s-anzeige/{slug}/{adId}-{categoryId}-{locationId}`. */
const DETAIL_LINK_RE =
  /href=["']([^"']*\/s-anzeige\/[^"']+\/(\d+)-(\d+)-(\d+)[^"']*)["']/gi;

const META_RE = /<meta[^>]+property=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi;
const META_RE_ALT = /<meta[^>]+content=["']([^"']*)["'][^>]+property=["']([^"']+)["'][^>]*>/gi;

function asNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if (!normalized) return undefined;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEuro(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const match = text.replace(/\u00a0/g, ' ').match(/([\d.]+(?:,\d+)?)\s*€/);
  if (!match?.[1]) return undefined;
  return asNumber(match[1]);
}

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Known city → locationId for housing search URLs. */
const CITY_LOCATION_IDS: Readonly<Record<string, string>> = {
  berlin: '3331',
  hamburg: '9409',
  muenchen: '6411',
  munich: '6411',
  koeln: '2856',
  cologne: '2856',
  frankfurt: '4253',
  stuttgart: '5445',
};

/**
 * Housing-only search URL. Defaults to Wohnung mieten (c203). Never emit a
 * site-wide / non-housing category URL.
 */
export function kleinanzeigenHousingSearchUrl(
  city: string,
  page = 1,
  categoryId: string = '203',
): string {
  if (!KLEINANZEIGEN_HOUSING_CATEGORY_IDS.has(categoryId)) {
    throw new Error(`kleinanzeigen: category ${categoryId} is not a housing category`);
  }
  const slug = citySlug(city);
  const locationId = CITY_LOCATION_IDS[slug] ?? '0';
  const path =
    categoryId === '203'
      ? `/s-wohnung-mieten/${slug}/c203l${locationId}`
      : categoryId === '205'
        ? `/s-haus-mieten/${slug}/c205l${locationId}`
        : categoryId === '208'
          ? `/s-wohnung-kaufen/${slug}/c208l${locationId}`
          : categoryId === '207'
            ? `/s-haus-kaufen/${slug}/c207l${locationId}`
            : `/s-wg-zimmer/${slug}/c199l${locationId}`;
  const base = `${KLEINANZEIGEN_BASE_URL}${path}`;
  return page <= 1 ? base : `${base}/seite:${page}`;
}

export function kleinanzeigenSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/s-anzeige\/[^/]+\/(\d+)-\d+-\d+/)?.[1];
}

export function kleinanzeigenCategoryFromUrl(url: string): string | undefined {
  return url.match(/\/s-anzeige\/[^/]+\/\d+-(\d+)-\d+/)?.[1];
}

export function isKleinanzeigenHousingCategory(categoryId: string | undefined): boolean {
  return !!categoryId && KLEINANZEIGEN_HOUSING_CATEGORY_IDS.has(categoryId);
}

export function isKleinanzeigenChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /captcha|access denied|datadome|cf-browser-verification|unusual traffic/i.test(html);
}

function absoluteUrl(href: string): string {
  if (href.startsWith('http')) return href.split('#')[0] ?? href;
  return `${KLEINANZEIGEN_BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`.split('#')[0] ?? href;
}

/** Parse housing search HTML into de-duplicated refs (non-housing links skipped). */
export function parseKleinanzeigenSearch(html: string): KleinanzeigenSearchRef[] {
  const seen = new Set<string>();
  const refs: KleinanzeigenSearchRef[] = [];
  for (const match of html.matchAll(DETAIL_LINK_RE)) {
    const href = match[1];
    const sourceId = match[2];
    const categoryId = match[3];
    if (!href || !sourceId || !categoryId) continue;
    if (!isKleinanzeigenHousingCategory(categoryId)) continue;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({
      sourceId,
      url: absoluteUrl(href),
      categoryId,
    });
  }
  return refs;
}

function collectMeta(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of html.matchAll(META_RE)) {
    if (match[1] && match[2]) out.set(match[1], match[2]);
  }
  for (const match of html.matchAll(META_RE_ALT)) {
    if (match[2] && match[1]) out.set(match[2], match[1]);
  }
  return out;
}

function detailValue(html: string, label: string): string | undefined {
  const re = new RegExp(
    `addetailslist--detail[^>]*>\\s*${label}\\s*<span[^>]*class=["']addetailslist--detail--value["'][^>]*>\\s*([^<]+)`,
    'i',
  );
  return html.match(re)?.[1]?.trim();
}

function extractContact(html: string): NormalizedListingContact | undefined {
  const out: NormalizedListingContact = {};
  const tel = html.match(/href=["']tel:([^"']+)["']/i)?.[1];
  if (tel) {
    const cleaned = tel.replace(/[^\d+]/g, '');
    if (cleaned.replace(/\D/g, '').length >= 7) out.phone = cleaned;
  }
  const wa = html.match(/wa\.me\/(\d{7,15})/i)?.[1] ?? html.match(/whatsapp\.com\/send\?phone=(\d+)/i)?.[1];
  if (wa) out.whatsapp = wa;
  const email = html.match(/mailto:([^"'?\s]+)/i)?.[1];
  if (email) out.email = email;
  if (/privat/i.test(html)) out.kind = 'private';
  else if (/gewerblich|händler|haendler|firma/i.test(html)) out.kind = 'agency';

  return out.phone || out.email || out.whatsapp || out.agencyName ? out : undefined;
}

function operationFromCategory(categoryId: string): 'rent' | 'sale' {
  return categoryId === '207' || categoryId === '208' ? 'sale' : 'rent';
}

/**
 * Parse a housing detail page. Throws when the category is not housing
 * (classifieds guard) or price/address cannot be resolved.
 */
export function parseKleinanzeigenDetail(html: string, url: string): KleinanzeigenRawListing {
  const categoryId = kleinanzeigenCategoryFromUrl(url);
  if (!categoryId || !isKleinanzeigenHousingCategory(categoryId)) {
    throw new Error(
      `kleinanzeigen: rejecting non-housing category ${categoryId ?? 'unknown'} at ${url}`,
    );
  }
  const sourceId = kleinanzeigenSourceIdFromUrl(url);
  if (!sourceId) throw new Error(`kleinanzeigen: cannot derive source id from ${url}`);

  const meta = collectMeta(html);
  const title = meta.get('og:title');
  const description = meta.get('og:description');
  const image = meta.get('og:image');
  const lat = asNumber(meta.get('og:latitude'));
  const lng = asNumber(meta.get('og:longitude'));
  const neighborhood = meta.get('og:locality');
  const region = meta.get('og:region');

  const priceText =
    html.match(/id=["']viewad-price["'][^>]*>\s*([^<]+)/i)?.[1]?.trim() ??
    html.match(/class=["'][^"']*boxedarticle--price[^"']*["'][^>]*>\s*([^<]+)/i)?.[1]?.trim();
  const price = parseEuro(priceText);

  const area = asNumber(detailValue(html, 'Wohnfläche')?.replace(/\s*m²/i, ''));
  const rooms = asNumber(detailValue(html, 'Zimmer'));
  const floor = asNumber(detailValue(html, 'Etage'));

  const city = region ?? neighborhood ?? '';
  const images = image ? [image] : [];
  // Extra gallery images from img.kleinanzeigen.de
  for (const match of html.matchAll(/src=["'](https:\/\/img\.kleinanzeigen\.de\/[^"']+)["']/gi)) {
    const src = match[1];
    if (src && !images.includes(src)) images.push(src);
  }

  return {
    sourceId,
    url: meta.get('og:url') ?? url,
    categoryId,
    title,
    description,
    operation: operationFromCategory(categoryId),
    price,
    currency: 'EUR',
    bedrooms: rooms,
    squareMeters: area,
    floor,
    address: {
      street: neighborhood ?? city,
      city,
      neighborhood,
      region,
      lat,
      lng,
    },
    images,
    contact: extractContact(html),
  };
}
