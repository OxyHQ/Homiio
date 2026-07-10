/**
 * Propiedades.com parsers — schema.org JSON-LD via shared helpers.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { buildContact, extractContactFromHtml, mergeContact } from '../../../contact';
import { collectJsonLdNodes, jsonLdTypes } from '../../../jsonLd';
import { asNumberEu, asString, isRecord } from '../../../parse/guards';
import { isCloudflareChallenge } from '../../../parse/challenge';
import { PROPIEDADES_BASE_URL } from './fixtures';

export interface PropiedadesSearchRef {
  sourceId: string;
  url: string;
}

export interface PropiedadesRawListing {
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
  };
  images: string[];
  contact?: NormalizedListingContact;
}

export function isPropiedadesChallenge(body: string): boolean {
  return isCloudflareChallenge(body) || /access denied|akamai|bot detection/i.test(body);
}

export function propiedadesSourceIdFromUrl(url: string): string | undefined {
  const match = /\/inmueble\/(\d+)/i.exec(url) ?? /-(\d{6,})(?:\/|$|\?)/.exec(url);
  return match?.[1];
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl.split('?')[0] ?? pathOrUrl;
  return `${PROPIEDADES_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl.split('?')[0]}`;
}

function nodeToRaw(node: Record<string, unknown>): PropiedadesRawListing | undefined {
  const types = jsonLdTypes(node);
  if (types.length && !types.some((t) => /apartment|house|residence|realestate|product/i.test(t))) {
    return undefined;
  }
  const offer = isRecord(node.offers) ? node.offers : undefined;
  const price = asNumberEu(offer?.price) ?? asNumberEu(node.price);
  const address = isRecord(node.address) ? node.address : undefined;
  const city = asString(address?.addressLocality);
  const urlRaw = asString(node.url) ?? (typeof node['@id'] === 'string' ? node['@id'] : undefined);
  if (price === undefined || !city || !urlRaw) return undefined;
  const url = absoluteUrl(urlRaw);
  const sourceId = propiedadesSourceIdFromUrl(url);
  if (!sourceId) return undefined;
  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  const images: string[] = [];
  if (typeof node.image === 'string') images.push(node.image);
  else if (Array.isArray(node.image)) {
    for (const e of node.image) {
      if (typeof e === 'string') images.push(e);
    }
  }
  const opHint = `${asString(node.name) ?? ''} ${url}`;
  return {
    sourceId,
    url,
    title: asString(node.name),
    description: asString(node.description),
    operation: /venta|sale|buy/i.test(opHint) ? 'sale' : 'rent',
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
    images,
    contact: buildContact({ phone: asString(node.telephone) }),
  };
}

export function parsePropiedadesSearch(html: string): PropiedadesSearchRef[] {
  if (isPropiedadesChallenge(html)) return [];
  const out: PropiedadesSearchRef[] = [];
  const seen = new Set<string>();
  for (const node of collectJsonLdNodes(html)) {
    const raw = nodeToRaw(node);
    if (!raw || seen.has(raw.sourceId)) continue;
    seen.add(raw.sourceId);
    out.push({ sourceId: raw.sourceId, url: raw.url });
  }
  return out;
}

export function parsePropiedadesDetail(html: string, url: string): PropiedadesRawListing {
  if (isPropiedadesChallenge(html)) throw new Error(`propiedades: challenge for ${url}`);
  for (const node of collectJsonLdNodes(html)) {
    const raw = nodeToRaw(node);
    if (raw) {
      raw.contact = mergeContact(raw.contact, extractContactFromHtml(html));
      return raw;
    }
  }
  throw new Error(`propiedades: no listing for ${url}`);
}
