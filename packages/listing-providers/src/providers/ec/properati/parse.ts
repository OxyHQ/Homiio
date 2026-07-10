/**
 * Properati Ecuador parsers — JSON-LD via shared {@link ../../../jsonLd} + contact.
 * Keep OFF (ALB 403). No duplicated type guards — use {@link ../../../parse/guards}.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromUnknown } from '../../../contact';
import { collectJsonLdNodes, findJsonLdByType } from '../../../jsonLd';
import { asNumberUs, asString, isRecord } from '../../../parse/guards';
import { PROPERATI_EC_BASE_URL } from './fixtures';

export interface ProperatiEcSearchRef {
  sourceId: string;
  url: string;
}

export interface ProperatiEcRawListing {
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
  address: { street?: string; city: string; region?: string; countryCode: string };
  images: string[];
  contact?: NormalizedListingContact;
}

export function isProperatiEcChallenge(body: string): boolean {
  return body.trim().length < 64 || /access denied|just a moment|cloudflare|captcha/i.test(body);
}

export function properatiEcSourceIdFromUrl(url: string): string | undefined {
  const match = /ec-prop-([A-Za-z0-9-]+)/i.exec(url) ?? /\/([a-z0-9-]+)$/i.exec(url);
  return match?.[1] ? (match[0].includes('ec-prop') ? `ec-prop-${match[1]}` : match[1]) : undefined;
}

function itemToRaw(item: Record<string, unknown>): ProperatiEcRawListing | undefined {
  const sourceId = asString(item.id) ?? properatiEcSourceIdFromUrl(asString(item.url) ?? '');
  const url = asString(item.url);
  const price = asNumberUs(item.price);
  if (!sourceId || !url || price === undefined) return undefined;
  const place = isRecord(item.place) ? item.place : undefined;
  const images = Array.isArray(item.images)
    ? item.images.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const op = asString(item.operation)?.toLowerCase();
  return {
    sourceId,
    url: url.startsWith('http') ? url : `${PROPERATI_EC_BASE_URL}${url}`,
    title: asString(item.title),
    operation: op === 'sale' || op === 'venta' ? 'sale' : 'rent',
    price,
    currency: asString(item.currency) ?? 'USD',
    bedrooms: asNumberUs(item.rooms),
    bathrooms: asNumberUs(item.bathrooms),
    squareMeters: asNumberUs(item.surface),
    address: {
      city: asString(place?.name) ?? 'Quito',
      region: asString(isRecord(place?.parent) ? place.parent.name : undefined),
      countryCode: 'EC',
    },
    images,
    contact: contactFromUnknown(item.contact),
  };
}

export function parseProperatiEcSearchJson(body: string): ProperatiEcSearchRef[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return [];
  }
  const rows =
    isRecord(parsed) && Array.isArray(parsed.data)
      ? parsed.data
      : Array.isArray(parsed)
        ? parsed
        : [];
  const out: ProperatiEcSearchRef[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const raw = itemToRaw(row);
    if (raw) out.push({ sourceId: raw.sourceId, url: raw.url });
  }
  return out;
}

export function parseProperatiEcDetail(html: string, url: string): ProperatiEcRawListing {
  const nodes = collectJsonLdNodes(html);
  const node =
    findJsonLdByType(nodes, 'Apartment') ??
    findJsonLdByType(nodes, 'House') ??
    findJsonLdByType(nodes, 'Residence') ??
    nodes[0];
  if (!node) throw new Error(`properati_ec: no JSON-LD for ${url}`);
  const offer = isRecord(node.offers) ? node.offers : undefined;
  const price = asNumberUs(offer?.price);
  const address = isRecord(node.address) ? node.address : undefined;
  if (price === undefined) throw new Error(`properati_ec: missing price for ${url}`);
  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  const images: string[] = [];
  if (typeof node.image === 'string') images.push(node.image);
  else if (Array.isArray(node.image)) {
    for (const entry of node.image) {
      if (typeof entry === 'string') images.push(entry);
    }
  }
  return {
    sourceId: properatiEcSourceIdFromUrl(url) ?? 'unknown',
    url: asString(node.url) ?? url,
    title: asString(node.name),
    operation: 'rent',
    price,
    currency: asString(offer?.priceCurrency) ?? 'USD',
    bedrooms: asNumberUs(node.numberOfRooms),
    bathrooms: asNumberUs(node.numberOfBathroomsTotal),
    squareMeters: asNumberUs(floorSize?.value),
    address: {
      city: asString(address?.addressLocality) ?? 'Quito',
      region: asString(address?.addressRegion),
      countryCode: 'EC',
    },
    images,
  };
}
