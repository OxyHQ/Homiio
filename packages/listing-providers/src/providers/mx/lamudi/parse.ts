/**
 * Lamudi Mexico parsers — schema.org JSON-LD via shared helpers.
 *
 * Search pages nest listings under SearchResultsPage → ItemList → ListItem.item;
 * {@link collectJsonLdNodes} unwraps that graph. Monthly rent is signaled by
 * `priceSpecification.unitText === "MONTH"`.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, extractContactFromHtml, mergeContact } from '../../../contact';
import { collectJsonLdNodes, jsonLdTypes } from '../../../jsonLd';
import { asNumberEu, asString, isRecord } from '../../../parse/guards';
import { isCloudflareChallenge } from '../../../parse/challenge';
import { LAMUDI_BASE_URL } from './fixtures';

export interface LamudiSearchRef {
  sourceId: string;
  url: string;
}

export interface LamudiRawListing {
  sourceId: string;
  url: string;
  title?: string;
  description?: string;
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
    lat?: number;
    lng?: number;
  };
  images: string[];
  contact?: NormalizedListingContact;
}

export function isLamudiChallenge(body: string): boolean {
  return isCloudflareChallenge(body) || /access denied|akamai|bot detection/i.test(body);
}

/** Extract source id from `/detalle/<id>` paths. */
export function lamudiSourceIdFromUrl(url: string): string | undefined {
  const match = /\/detalle\/([^/?#]+)/i.exec(url);
  return match?.[1];
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl.split('?')[0] ?? pathOrUrl;
  return `${LAMUDI_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl.split('?')[0]}`;
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

function resolveOffer(node: Record<string, unknown>): {
  price?: number;
  currency?: string;
  unitText?: string;
} {
  const offer = isRecord(node.offers) ? node.offers : undefined;
  const priceSpec = isRecord(offer?.priceSpecification) ? offer.priceSpecification : undefined;
  return {
    price: asNumberEu(priceSpec?.price) ?? asNumberEu(offer?.price) ?? asNumberEu(node.price),
    currency: asString(priceSpec?.priceCurrency) ?? asString(offer?.priceCurrency),
    unitText: asString(priceSpec?.unitText) ?? asString(offer?.unitText),
  };
}

function inferOperation(
  url: string,
  title: string | undefined,
  unitText: string | undefined,
): 'rent' | 'sale' {
  if (unitText && /month|mes|renta|rent/i.test(unitText)) return 'rent';
  const hay = `${title ?? ''} ${url}`;
  if (/for-sale|venta|sale|buy/i.test(hay)) return 'sale';
  if (/for-rent|renta|rent|alquiler/i.test(hay)) return 'rent';
  return 'rent';
}

function nodeToRaw(node: Record<string, unknown>): LamudiRawListing | undefined {
  const types = jsonLdTypes(node);
  if (
    types.length &&
    !types.some((t) => /apartment|house|residence|realestate|product|singlefamily/i.test(t))
  ) {
    return undefined;
  }

  const offer = resolveOffer(node);
  const address = isRecord(node.address) ? node.address : undefined;
  const city = asString(address?.addressLocality);
  const urlRaw =
    asString(node.url) ?? (typeof node['@id'] === 'string' ? node['@id'] : undefined);
  if (offer.price === undefined || !city || !urlRaw) return undefined;

  const url = absoluteUrl(urlRaw);
  const sourceId = lamudiSourceIdFromUrl(url);
  if (!sourceId) return undefined;

  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  const geo = isRecord(node.geo) ? node.geo : undefined;
  const title = asString(node.name);

  const raw: LamudiRawListing = {
    sourceId,
    url,
    title,
    description: asString(node.description),
    operation: inferOperation(url, title, offer.unitText),
    price: offer.price,
    currency: offer.currency ?? 'MXN',
    bedrooms: asNumberEu(node.numberOfBedrooms) ?? asNumberEu(node.numberOfRooms),
    bathrooms: asNumberEu(node.numberOfBathroomsTotal),
    squareMeters: asNumberEu(floorSize?.value) ?? asNumberEu(floorSize),
    address: {
      street: asString(address?.streetAddress),
      city,
      region: asString(address?.addressRegion),
      countryCode: 'MX',
      lat: asNumberEu(geo?.latitude),
      lng: asNumberEu(geo?.longitude),
    },
    images: collectImages(node),
    contact: buildContact({ phone: asString(node.telephone) }),
  };
  return raw;
}

export function parseLamudiSearch(html: string): LamudiSearchRef[] {
  if (isLamudiChallenge(html)) return [];
  const out: LamudiSearchRef[] = [];
  const seen = new Set<string>();

  for (const node of collectJsonLdNodes(html)) {
    const raw = nodeToRaw(node);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    out.push({ sourceId: raw.sourceId, url: raw.url });
  }

  // Href fallback when JSON-LD is sparse.
  const hrefRe = /href="((?:https:\/\/www\.lamudi\.com\.mx)?\/detalle\/[^"?#]+)"/gi;
  for (const match of html.matchAll(hrefRe)) {
    const href = match[1];
    if (!href) continue;
    const url = absoluteUrl(href);
    const sourceId = lamudiSourceIdFromUrl(url);
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, url });
  }

  return out;
}

export function parseLamudiDetail(html: string, url: string): LamudiRawListing {
  if (isLamudiChallenge(html)) throw new Error(`lamudi: challenge for ${url}`);
  for (const node of collectJsonLdNodes(html)) {
    const raw = nodeToRaw(node);
    if (raw) {
      raw.contact = mergeContact(raw.contact, extractContactFromHtml(html));
      return raw;
    }
  }
  throw new Error(`lamudi: no listing for ${url}`);
}
