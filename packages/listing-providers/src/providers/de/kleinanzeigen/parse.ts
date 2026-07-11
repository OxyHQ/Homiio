/**
 * Kleinanzeigen immobilien parsing — housing-only via shared classifieds + contact/html.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { extractContactFromHtml, mergeListingContact } from '../../../contact';
import {
  asNumber,
  citySlugDe,
  extractMetaProperties,
  parseEuroAmount,
} from '../../../html';
import { NonHousingListingError } from '../../../classifieds';
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

const DETAIL_LINK_RE =
  /href=["']([^"']*\/s-anzeige\/[^"']+\/(\d+)-(\d+)-(\d+)[^"']*)["']/gi;

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

export function isKleinanzeigenHousingCategory(categoryId: string | undefined): boolean {
  return !!categoryId && KLEINANZEIGEN_HOUSING_CATEGORY_IDS.has(categoryId);
}

/** Housing category id → Kleinanzeigen SEO path segment (e.g. `s-wohnung-mieten`). */
const CATEGORY_SEGMENTS: Readonly<Record<string, string>> = {
  '203': 's-wohnung-mieten',
  '205': 's-haus-mieten',
  '208': 's-wohnung-kaufen',
  '207': 's-haus-kaufen',
  '199': 's-wg-zimmer',
};

export function kleinanzeigenHousingSearchUrl(
  city: string,
  page = 1,
  categoryId: string = '203',
): string {
  if (!isKleinanzeigenHousingCategory(categoryId)) {
    throw new Error(`kleinanzeigen: category ${categoryId} is not a housing category`);
  }
  const slug = citySlugDe(city);
  const locationId = CITY_LOCATION_IDS[slug] ?? '0';
  const segment = CATEGORY_SEGMENTS[categoryId] ?? 's-wg-zimmer';
  // Kleinanzeigen paginates with `seite:N` BETWEEN the city slug and the
  // category code — appending it after the code drops the category filter and
  // returns a site-wide (non-housing) page.
  const pageSegment = page > 1 ? `/seite:${page}` : '';
  return `${KLEINANZEIGEN_BASE_URL}/${segment}/${slug}${pageSegment}/c${categoryId}l${locationId}`;
}

export function kleinanzeigenSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/s-anzeige\/[^/]+\/(\d+)-\d+-\d+/)?.[1];
}

export function kleinanzeigenCategoryFromUrl(url: string): string | undefined {
  return url.match(/\/s-anzeige\/[^/]+\/\d+-(\d+)-\d+/)?.[1];
}

export function isKleinanzeigenChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /captcha|access denied|datadome|cf-browser-verification|unusual traffic/i.test(html);
}

function absoluteUrl(href: string): string {
  if (href.startsWith('http')) return href.split('#')[0] ?? href;
  return `${KLEINANZEIGEN_BASE_URL}${href.startsWith('/') ? '' : '/'}${href}`.split('#')[0] ?? href;
}

/** Parse housing search HTML — non-housing category links are skipped. */
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
    refs.push({ sourceId, url: absoluteUrl(href), categoryId });
  }
  return refs;
}

/**
 * Kleinanzeigen serves each ad photo from `img.kleinanzeigen.de` with a `rule`
 * size suffix; the detail gallery lists them via `data-imgsrc`. `$_57.AUTO`
 * is the largest variant (1200x1600), so every URL is normalized to it and
 * deduped by base image id, with the `og:image` kept as the primary.
 */
const GALLERY_IMG_RE = /data-imgsrc=["'](https:\/\/img\.kleinanzeigen\.de\/[^"']+)["']/gi;
const IMAGE_RULE_RE = /\?rule=\$_\d+\.[A-Za-z]+$/i;

function largestImageVariant(url: string): string {
  return url.replace(IMAGE_RULE_RE, '') + '?rule=$_57.AUTO';
}

function extractGalleryImages(html: string, ogImage: string | undefined): string[] {
  const byBase = new Map<string, string>();
  const add = (raw: string): void => {
    const normalized = largestImageVariant(raw);
    const base = normalized.split('?')[0] ?? normalized;
    if (!byBase.has(base)) byBase.set(base, normalized);
  };
  if (ogImage) add(ogImage);
  for (const match of html.matchAll(GALLERY_IMG_RE)) {
    if (match[1]) add(match[1]);
  }
  return [...byBase.values()];
}

function detailValue(html: string, label: string): string | undefined {
  const re = new RegExp(
    `addetailslist--detail[^>]*>\\s*${label}\\s*<span[^>]*class=["']addetailslist--detail--value["'][^>]*>\\s*([^<]+)`,
    'i',
  );
  return html.match(re)?.[1]?.trim();
}

export function parseKleinanzeigenDetail(html: string, url: string): KleinanzeigenRawListing {
  const categoryId = kleinanzeigenCategoryFromUrl(url);
  if (!isKleinanzeigenHousingCategory(categoryId)) {
    throw new NonHousingListingError(
      'kleinanzeigen',
      kleinanzeigenSourceIdFromUrl(url) ?? 'unknown',
      `category ${categoryId ?? 'unknown'} is not housing`,
    );
  }
  const sourceId = kleinanzeigenSourceIdFromUrl(url);
  if (!sourceId) throw new Error(`kleinanzeigen: cannot derive source id from ${url}`);

  const meta = extractMetaProperties(html);
  const priceText =
    html.match(/id=["']viewad-price["'][^>]*>\s*([^<]+)/i)?.[1]?.trim() ??
    html.match(/class=["'][^"']*boxedarticle--price[^"']*["'][^>]*>\s*([^<]+)/i)?.[1]?.trim();

  const neighborhood = meta.get('og:locality');
  const region = meta.get('og:region');
  const city = region ?? neighborhood ?? '';
  const images = extractGalleryImages(html, meta.get('og:image'));

  return {
    sourceId,
    url: meta.get('og:url') ?? url,
    categoryId: categoryId as string,
    title: meta.get('og:title'),
    description: meta.get('og:description'),
    operation: categoryId === '207' || categoryId === '208' ? 'sale' : 'rent',
    price: parseEuroAmount(priceText),
    currency: 'EUR',
    bedrooms: asNumber(detailValue(html, 'Zimmer')),
    squareMeters: asNumber(detailValue(html, 'Wohnfläche')?.replace(/\s*m²/i, '')),
    floor: asNumber(detailValue(html, 'Etage')),
    address: {
      street: neighborhood ?? city,
      city,
      neighborhood,
      region,
      lat: asNumber(meta.get('og:latitude')),
      lng: asNumber(meta.get('og:longitude')),
    },
    images,
    contact: mergeListingContact(extractContactFromHtml(html)),
  };
}
