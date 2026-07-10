/**
 * Vivanuncios Mexico parsers — housing-only classifieds via shared guards.
 *
 * General classifieds portal: reject non-housing URLs with
 * {@link isHousingCategoryUrl} and enforce {@link assertHousingListing} on
 * detail. JSON-LD is the primary payload; href scrape is a search fallback.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import {
  assertHousingListing,
  isHousingCategoryUrl,
  NonHousingListingError,
} from '../../../classifieds';
import { buildContact, extractContactFromHtml, mergeContact } from '../../../contact';
import { collectJsonLdNodes, jsonLdTypes } from '../../../jsonLd';
import { asNumberEu, asString, isRecord } from '../../../parse/guards';
import { isCloudflareChallenge } from '../../../parse/challenge';
import { VIVANUNCIOS_BASE_URL, VIVANUNCIOS_HOUSING_SLUGS } from './fixtures';

export interface VivanunciosSearchRef {
  sourceId: string;
  url: string;
}

export interface VivanunciosRawListing {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
  category?: string;
  operation: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  address: {
    street?: string;
    city: string;
    region?: string;
    countryCode: string;
  };
  images: string[];
  contact?: NormalizedListingContact;
}

const DETAIL_HREF_RE =
  /href="((?:https:\/\/www\.vivanuncios\.com\.mx)?\/a-(?:renta|venta)-(?:departamento|casa)\/[^"?#]+\/(\d{6,}))"/gi;

export function isVivanunciosChallenge(body: string): boolean {
  return isCloudflareChallenge(body) || /access denied|akamai|bot detection|captcha/i.test(body);
}

export function vivanunciosSourceIdFromUrl(url: string): string | undefined {
  const match = /\/(\d{6,})(?:\/?(?:\?|#|$))/i.exec(url);
  return match?.[1];
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl.split('?')[0] ?? pathOrUrl;
  return `${VIVANUNCIOS_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl.split('?')[0]}`;
}

function collectImages(node: Record<string, unknown>): string[] {
  const images: string[] = [];
  if (typeof node.image === 'string') images.push(node.image);
  else if (Array.isArray(node.image)) {
    for (const entry of node.image) {
      if (typeof entry === 'string') images.push(entry);
    }
  }
  return images;
}

function inferOperation(url: string, title: string | undefined, category: string | undefined): 'rent' | 'sale' {
  const hay = `${url} ${title ?? ''} ${category ?? ''}`;
  if (/venta|sale|buy|a-venta/i.test(hay)) return 'sale';
  return 'rent';
}

function nodeToRaw(node: Record<string, unknown>): VivanunciosRawListing | undefined {
  const types = jsonLdTypes(node);
  if (
    types.length &&
    !types.some((t) => /apartment|house|residence|realestate|product|singlefamily/i.test(t))
  ) {
    return undefined;
  }

  const offer = isRecord(node.offers) ? node.offers : undefined;
  const price = asNumberEu(offer?.price) ?? asNumberEu(node.price);
  const address = isRecord(node.address) ? node.address : undefined;
  const city = asString(address?.addressLocality);
  const urlRaw =
    asString(node.url) ?? (typeof node['@id'] === 'string' ? node['@id'] : undefined);
  if (price === undefined || !city || !urlRaw) return undefined;

  const url = absoluteUrl(urlRaw);
  if (!isHousingCategoryUrl(url, VIVANUNCIOS_HOUSING_SLUGS)) return undefined;

  const sourceId = vivanunciosSourceIdFromUrl(url);
  if (!sourceId) return undefined;

  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  const title = asString(node.name);
  const category = asString(node.category) ?? asString(node.additionalType);

  return {
    sourceId,
    url,
    title,
    description: asString(node.description),
    category,
    operation: inferOperation(url, title, category),
    price,
    currency: asString(offer?.priceCurrency) ?? 'MXN',
    bedrooms: asNumberEu(node.numberOfBedrooms) ?? asNumberEu(node.numberOfRooms),
    bathrooms: asNumberEu(node.numberOfBathroomsTotal),
    squareMeters: asNumberEu(floorSize?.value) ?? asNumberEu(floorSize),
    address: {
      street: asString(address?.streetAddress),
      city,
      region: asString(address?.addressRegion),
      countryCode: 'MX',
    },
    images: collectImages(node),
    contact: buildContact({ phone: asString(node.telephone) }),
  };
}

/** Parse housing search HTML — non-housing category links are skipped. */
export function parseVivanunciosSearch(html: string): VivanunciosSearchRef[] {
  if (isVivanunciosChallenge(html)) return [];
  const out: VivanunciosSearchRef[] = [];
  const seen = new Set<string>();

  for (const node of collectJsonLdNodes(html)) {
    const raw = nodeToRaw(node);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    out.push({ sourceId: raw.sourceId, url: raw.url });
  }

  for (const match of html.matchAll(DETAIL_HREF_RE)) {
    const href = match[1];
    const sourceId = match[2];
    if (!href || !sourceId) continue;
    const url = absoluteUrl(href);
    if (!isHousingCategoryUrl(url, VIVANUNCIOS_HOUSING_SLUGS)) continue;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, url });
  }

  return out;
}

export function parseVivanunciosDetail(html: string, url: string): VivanunciosRawListing {
  if (isVivanunciosChallenge(html)) throw new Error(`vivanuncios: challenge for ${url}`);

  if (!isHousingCategoryUrl(url, VIVANUNCIOS_HOUSING_SLUGS)) {
    throw new NonHousingListingError(
      'vivanuncios',
      vivanunciosSourceIdFromUrl(url) ?? 'unknown',
      `url is not a housing category: ${url}`,
    );
  }

  for (const node of collectJsonLdNodes(html)) {
    const raw = nodeToRaw(node);
    if (!raw) continue;

    assertHousingListing('vivanuncios', raw.sourceId, {
      category: raw.category,
      typology: raw.title,
      squareMeters: raw.squareMeters,
      bedrooms: raw.bedrooms,
      bathrooms: raw.bathrooms,
      hasAddressLike: Boolean(raw.address.city),
      hasPrice: raw.price > 0,
    });

    raw.contact = mergeContact(raw.contact, extractContactFromHtml(html));
    return raw;
  }

  throw new Error(`vivanuncios: no housing listing for ${url}`);
}
