/**
 * Properati EC parsers — shared JSON-LD + contact. Portal currently ALB-403;
 * provider stays OFF until a live session clears.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromUnknown } from '../../../contact';
import { collectJsonLdNodes, findJsonLdByType } from '../../../jsonLd';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function isProperatiEcChallenge(body: string): boolean {
  if (body.trim().length < 64) return true;
  return /access denied|just a moment|cloudflare|captcha/i.test(body);
}

export function properatiEcSourceIdFromUrl(url: string): string | undefined {
  const match = /(?:ec-prop-|id[=/])([A-Za-z0-9-]+)$/i.exec(url) ?? /\/([a-z0-9-]+)$/i.exec(url);
  return match?.[1];
}

function itemToRaw(item: Record<string, unknown>): ProperatiEcRawListing | undefined {
  const sourceId = asString(item.id) ?? properatiEcSourceIdFromUrl(asString(item.url) ?? '');
  const url = asString(item.url);
  const price = asNumber(item.price);
  if (!sourceId || !url || price === undefined) return undefined;
  const place = isRecord(item.place) ? item.place : undefined;
  const city = asString(place?.name) ?? 'Quito';
  const region = asString(isRecord(place?.parent) ? place.parent.name : undefined);
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
    bedrooms: asNumber(item.rooms),
    bathrooms: asNumber(item.bathrooms),
    squareMeters: asNumber(item.surface),
    address: { city, region, countryCode: 'EC' },
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
  const rows = isRecord(parsed) && Array.isArray(parsed.data) ? parsed.data : Array.isArray(parsed) ? parsed : [];
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
  const price = asNumber(offer?.price);
  const address = isRecord(node.address) ? node.address : undefined;
  const city = asString(address?.addressLocality) ?? 'Quito';
  if (price === undefined) throw new Error(`properati_ec: missing price for ${url}`);
  const sourceId = properatiEcSourceIdFromUrl(url) ?? 'unknown';
  const images: string[] = [];
  if (typeof node.image === 'string') images.push(node.image);
  else if (Array.isArray(node.image)) {
    for (const entry of node.image) if (typeof entry === 'string') images.push(entry);
  }
  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  return {
    sourceId,
    url: asString(node.url) ?? url,
    title: asString(node.name),
    operation: 'rent',
    price,
    currency: asString(offer?.priceCurrency) ?? 'USD',
    bedrooms: asNumber(node.numberOfRooms),
    bathrooms: asNumber(node.numberOfBathroomsTotal),
    squareMeters: asNumber(floorSize?.value),
    address: {
      city,
      region: asString(address?.addressRegion),
      countryCode: 'EC',
    },
    images,
  };
}
