/**
 * Imobiliare.ro parsers — Inertia `data-page` JSON for search, schema.org
 * `@graph` JSON-LD for detail. Contact via shared {@link buildContact} /
 * {@link contactFromAjaxBody}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, contactFromAjaxBody, mergeContact } from '../../../contact';
import {
  collectJsonLdNodes,
  findJsonLdByType,
  resolveJsonLdRef,
} from '../../../jsonLd';
import { IMOBILIARE_RO_BASE_URL } from './fixtures';
import { asNumber, asString, isRecord } from '../../../parse/guards';

const DATA_PAGE_RE = /data-page="([^"]+)"/i;

export interface ImobiliareRoSearchRef {
  sourceId: string;
  url: string;
  hints?: {
    agencyName?: string;
    offerType?: 'rent' | 'sale';
    phoneApiUrl?: string;
  };
}

export interface ImobiliareRoRawListing {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  operation: 'rent' | 'sale';
  price: number;
  currency: string;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  floor?: number;
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

function decodeDataPage(html: string): Record<string, unknown> | undefined {
  const match = DATA_PAGE_RE.exec(html);
  const raw = match?.[1];
  if (!raw) return undefined;
  try {
    const decoded = raw
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&amp;/g, '&');
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function imobiliareRoSourceIdFromUrl(url: string): string | undefined {
  const match = /(\d{5,})(?:\/)?(?:\?|$)/.exec(url);
  return match?.[1];
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl.split('?')[0] ?? pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${IMOBILIARE_RO_BASE_URL}${path.split('?')[0]}`;
}

function parseOfferType(value: unknown): 'rent' | 'sale' | undefined {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return undefined;
  if (raw.includes('rent') || raw.includes('inchir')) return 'rent';
  if (raw.includes('sell') || raw.includes('sale') || raw.includes('vanz')) return 'sale';
  return undefined;
}

/** Parse Inertia search `data-page` listings into refs (+ agency hints). */
export function parseImobiliareRoSearch(html: string): ImobiliareRoSearchRef[] {
  const page = decodeDataPage(html);
  if (!page) return [];
  const props = isRecord(page.props) ? page.props : undefined;
  const sections = props && Array.isArray(props.sections) ? props.sections : [];
  const out = new Map<string, ImobiliareRoSearchRef>();

  for (const section of sections) {
    if (!isRecord(section) || section.type !== 'results-list') continue;
    const data = isRecord(section.data) ? section.data : undefined;
    const listings = data && Array.isArray(data.listings) ? data.listings : [];
    for (const listing of listings) {
      if (!isRecord(listing)) continue;
      const id = asString(listing.id) ?? (typeof listing.id === 'number' ? String(listing.id) : undefined);
      const path = asString(listing.url);
      if (!id || !path) continue;
      const offerType = parseOfferType(listing.offerType);
      const agencyName = asString(listing.agencyName);
      const phoneApiUrl = asString(listing.phoneApiUrl);
      const ref: ImobiliareRoSearchRef = {
        sourceId: id,
        url: absoluteUrl(path),
      };
      if (agencyName || offerType || phoneApiUrl) {
        ref.hints = {};
        if (agencyName) ref.hints.agencyName = agencyName;
        if (offerType) ref.hints.offerType = offerType;
        if (phoneApiUrl) ref.hints.phoneApiUrl = phoneApiUrl;
      }
      out.set(id, ref);
    }
  }
  return [...out.values()];
}

/** Parse detail JSON-LD `@graph` into a raw listing. */
export function parseImobiliareRoDetail(
  html: string,
  url: string,
  hints?: ImobiliareRoSearchRef['hints'],
): ImobiliareRoRawListing {
  const nodes = collectJsonLdNodes(html);
  if (nodes.length === 0) {
    throw new Error('imobiliare_ro: detail page has no JSON-LD');
  }

  const offer = findJsonLdByType(nodes, 'Offer');
  const accommodation = findJsonLdByType(nodes, 'Accommodation');
  const product = findJsonLdByType(nodes, 'Product');
  const listing = findJsonLdByType(nodes, 'RealEstateListing');

  const addressRef = accommodation?.address ?? listing?.address;
  const addressNode =
    resolveJsonLdRef(nodes, addressRef) ?? findJsonLdByType(nodes, 'PostalAddress');

  const priceSpec = offer && isRecord(offer.priceSpecification) ? offer.priceSpecification : undefined;
  const price = asNumber(priceSpec?.price) ?? asNumber(offer?.price);
  if (price === undefined) {
    throw new Error('imobiliare_ro: detail JSON-LD has no price');
  }

  const business = asString(offer?.businessFunction)?.toLowerCase() ?? '';
  let operation: 'rent' | 'sale' =
    business.includes('lease') || business.includes('rent') ? 'rent' : 'sale';
  if (hints?.offerType) operation = hints.offerType;
  if (/inchir/i.test(url)) operation = 'rent';
  if (/vanzare/i.test(url)) operation = 'sale';

  const sourceId =
    imobiliareRoSourceIdFromUrl(url) ??
    imobiliareRoSourceIdFromUrl(asString(listing?.url) ?? '') ??
    imobiliareRoSourceIdFromUrl(asString(offer?.url) ?? '');
  if (!sourceId) {
    throw new Error('imobiliare_ro: could not resolve sourceId');
  }

  const images: string[] = [];
  const productImages = product?.image;
  if (Array.isArray(productImages)) {
    for (const entry of productImages) {
      if (typeof entry === 'string') images.push(entry);
      else if (isRecord(entry)) {
        const img = asString(entry['@id']) ?? asString(entry.url) ?? asString(entry.contentUrl);
        if (img) images.push(img);
      }
    }
  }

  const city =
    asString(addressNode?.addressLocality) ??
    asString(addressNode?.addressRegion) ??
    'Romania';

  const result: ImobiliareRoRawListing = {
    sourceId,
    url: asString(listing?.url) ?? asString(offer?.url) ?? absoluteUrl(url),
    title: asString(product?.name) ?? asString(listing?.name) ?? `Listing ${sourceId}`,
    operation,
    price,
    currency: asString(priceSpec?.priceCurrency) ?? asString(offer?.priceCurrency) ?? 'EUR',
    address: {
      street: asString(addressNode?.streetAddress),
      city,
      region: asString(addressNode?.addressRegion),
      countryCode: (asString(addressNode?.addressCountry) ?? 'RO').slice(0, 2).toUpperCase(),
    },
    images: [...new Set(images)],
  };

  const description = asString(listing?.description) ?? asString(product?.description);
  if (description) result.description = description;
  const bedrooms = asNumber(accommodation?.numberOfBedrooms) ?? asNumber(accommodation?.numberOfRooms);
  if (bedrooms !== undefined) result.bedrooms = bedrooms;
  const bathrooms = asNumber(accommodation?.numberOfBathroomsTotal);
  if (bathrooms !== undefined) result.bathrooms = bathrooms;
  const squareMeters = asNumber(accommodation?.floorSize);
  if (squareMeters !== undefined) result.squareMeters = squareMeters;
  const floor = asNumber(accommodation?.floorLevel);
  if (floor !== undefined) result.floor = floor;

  const hintContact = hints?.agencyName
    ? buildContact({ agencyName: hints.agencyName, name: hints.agencyName, kind: 'agency' })
    : undefined;
  if (hintContact) result.contact = hintContact;

  return result;
}

/** Merge phone / WhatsApp / email from a portal contact AJAX JSON body. */
export function mergeImobiliareRoContact(
  listing: ImobiliareRoRawListing,
  body: string,
): ImobiliareRoRawListing {
  const fromAjax = contactFromAjaxBody(body);
  const contact = mergeContact(listing.contact, fromAjax);
  return contact ? { ...listing, contact } : listing;
}

export function isImobiliareRoChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /cf-challenge|just a moment|access denied|captcha|datadome/i.test(html);
}
