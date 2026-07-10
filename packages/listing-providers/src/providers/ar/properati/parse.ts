/**
 * Properati AR parsers — JSON-LD + `__NEXT_DATA__` via shared modules.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, contactFromUnknown, extractContactFromHtml, mergeContact } from '../../../contact';
import { collectJsonLdNodes, findJsonLdByType, jsonLdTypes } from '../../../jsonLd';
import { findNextDataArray, findNextDataRecord, parseNextDataPageProps } from '../../../nextData';
import { PROPERATI_BASE_URL } from './fixtures';
import { asNumber, asString, isRecord } from '../../../parse/guards';

export interface ProperatiSearchRef {
  sourceId: string;
  url: string;
}

export interface ProperatiRawListing {
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
    neighborhood?: string;
    countryCode: string;
  };
  images: string[];
  contact?: NormalizedListingContact;
}


export function isProperatiChallenge(body: string): boolean {
  if (body.trim().length < 128) return true;
  return /just a moment|cloudflare|cf-mitigated|captcha|access denied/i.test(body);
}

export function properatiSourceIdFromUrl(url: string): string | undefined {
  const match =
    /properati-ar-([a-z0-9-]+)/i.exec(url) ??
    /\/detalle\/[^/]*-([a-z0-9-]{4,})(?:\/|$|\?)/i.exec(url) ??
    /-(\d{5,})(?:\.html)?(?:\?|$)/i.exec(url);
  return match?.[1] ? (match[0].includes('properati-ar') ? `properati-ar-${match[1]}` : match[1]) : undefined;
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  return `${PROPERATI_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

function isListingLike(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return Boolean(
    (value.id || value.url) &&
      (value.price !== undefined || value.title || value.city || value.operation),
  );
}

function listingFromRecord(record: Record<string, unknown>): ProperatiRawListing | undefined {
  const path = asString(record.url) ?? asString(record.permalink);
  const id =
    asString(record.id) ??
    (path ? properatiSourceIdFromUrl(path) : undefined) ??
    asString(record.slug);
  if (!id || !path) return undefined;
  const price = asNumber(record.price) ?? asNumber(isRecord(record.price) ? record.price.amount : undefined);
  if (price === undefined) return undefined;
  const city = asString(record.city) ?? asString(isRecord(record.address) ? record.address.city : undefined) ?? 'Capital Federal';
  const operationRaw = asString(record.operation) ?? asString(record.operation_type) ?? path;
  const operation: 'rent' | 'sale' = /venta|sale|sell/i.test(operationRaw) ? 'sale' : 'rent';
  const images: string[] = [];
  if (Array.isArray(record.images)) {
    for (const img of record.images) {
      if (typeof img === 'string') images.push(img);
      else if (isRecord(img) && asString(img.url)) images.push(asString(img.url)!);
    }
  }
  const contact = mergeContact(
    contactFromUnknown(record.publisher ?? record.advertiser ?? record.agency),
    buildContact({
      phone: asString(record.phone) ?? asString(record.telephone),
      agencyName: asString(record.agency_name),
    }),
  );
  return {
    sourceId: id,
    url: absoluteUrl(path),
    title: asString(record.title) ?? asString(record.name),
    description: asString(record.description),
    operation,
    price,
    currency: asString(record.currency) ?? asString(record.currency_id) ?? 'ARS',
    bedrooms: asNumber(record.bedrooms) ?? asNumber(record.rooms),
    bathrooms: asNumber(record.bathrooms),
    squareMeters: asNumber(record.surface) ?? asNumber(record.area) ?? asNumber(record.squareMeters),
    address: {
      street: asString(isRecord(record.address) ? record.address.street : undefined),
      city,
      region: asString(record.state) ?? asString(isRecord(record.address) ? record.address.region : undefined),
      neighborhood:
        asString(record.neighborhood) ??
        asString(isRecord(record.address) ? record.address.neighborhood : undefined),
      countryCode: 'AR',
    },
    images,
    contact,
  };
}

export function parseProperatiSearch(html: string): ProperatiSearchRef[] {
  const pageProps = parseNextDataPageProps(html);
  if (pageProps) {
    const ads = findNextDataArray(pageProps, isListingLike) ?? [];
    const out: ProperatiSearchRef[] = [];
    const seen = new Set<string>();
    for (const entry of ads) {
      if (!isRecord(entry)) continue;
      const raw = listingFromRecord(entry);
      if (!raw || seen.has(raw.sourceId)) continue;
      seen.add(raw.sourceId);
      out.push({ sourceId: raw.sourceId, url: raw.url });
    }
    if (out.length > 0) return out;
  }

  const out: ProperatiSearchRef[] = [];
  const seen = new Set<string>();
  const hrefRe = /href="((?:https:\/\/www\.properati\.com\.ar)?\/detalle\/[^"]+)"/gi;
  for (const match of html.matchAll(hrefRe)) {
    const url = absoluteUrl(match[1] ?? '');
    const sourceId = properatiSourceIdFromUrl(url);
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    out.push({ sourceId, url });
  }
  return out;
}

export function parseProperatiDetail(html: string, url: string): ProperatiRawListing {
  const pageProps = parseNextDataPageProps(html);
  if (pageProps) {
    const listing =
      findNextDataRecord(pageProps, isListingLike) ??
      (isRecord(pageProps.listing) ? pageProps.listing : undefined);
    if (listing) {
      const raw = listingFromRecord(listing);
      if (raw) return raw;
    }
  }

  const nodes = collectJsonLdNodes(html);
  const node =
    findJsonLdByType(nodes, 'Apartment') ??
    findJsonLdByType(nodes, 'House') ??
    findJsonLdByType(nodes, 'Residence') ??
    findJsonLdByType(nodes, 'RealEstateListing') ??
    nodes.find((n) => jsonLdTypes(n).some((t) => /apartment|house|residence|product/i.test(t)));
  if (!node) throw new Error(`properati: no listing payload for ${url}`);

  const offer = isRecord(node.offers) ? node.offers : undefined;
  const price = asNumber(offer?.price) ?? asNumber(node.price);
  const address = isRecord(node.address) ? node.address : undefined;
  const city = asString(address?.addressLocality) ?? 'Capital Federal';
  if (price === undefined) throw new Error(`properati: missing price for ${url}`);
  const sourceId = properatiSourceIdFromUrl(url) ?? properatiSourceIdFromUrl(asString(node.url) ?? '');
  if (!sourceId) throw new Error(`properati: missing id for ${url}`);

  const images: string[] = [];
  const imageVal = node.image;
  if (typeof imageVal === 'string') images.push(imageVal);
  else if (Array.isArray(imageVal)) {
    for (const entry of imageVal) {
      if (typeof entry === 'string') images.push(entry);
    }
  }

  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  const business = asString(offer?.businessFunction)?.toLowerCase() ?? '';

  return {
    sourceId,
    url: asString(node.url) ?? url,
    title: asString(node.name),
    description: asString(node.description),
    operation: business.includes('sell') || /venta/i.test(url) ? 'sale' : 'rent',
    price,
    currency: asString(offer?.priceCurrency) ?? 'ARS',
    bedrooms: asNumber(node.numberOfRooms) ?? asNumber(node.numberOfBedrooms),
    bathrooms: asNumber(node.numberOfBathroomsTotal),
    squareMeters: asNumber(floorSize?.value) ?? asNumber(floorSize),
    address: {
      street: asString(address?.streetAddress),
      city,
      region: asString(address?.addressRegion),
      countryCode: 'AR',
    },
    images,
    contact: mergeContact(
      buildContact({ phone: asString(node.telephone) }),
      contactFromUnknown(node.seller),
      extractContactFromHtml(html),
    ),
  };
}
