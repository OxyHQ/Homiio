import type { NormalizedListingContact } from '@homiio/shared-types';
import { contactFromUnknown } from '../../../contact';
import { collectJsonLdNodes, findJsonLdByType } from '../../../jsonLd';
import { PROPERATI_EC_BASE_URL } from './fixtures';

export interface ProperatiEcSearchRef { sourceId: string; url: string; }
export interface ProperatiEcRawListing {
  sourceId: string; url: string; title?: string; description?: string;
  operation: 'rent' | 'sale'; price: number; currency: string;
  bedrooms?: number; bathrooms?: number; squareMeters?: number;
  address: { street?: string; city: string; region?: string; countryCode: string };
  images: string[]; contact?: NormalizedListingContact;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}
function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v.replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function isProperatiEcChallenge(body: string): boolean {
  return body.trim().length < 64 || /access denied|just a moment|cloudflare|captcha/i.test(body);
}
export function properatiEcSourceIdFromUrl(url: string): string | undefined {
  const m = /ec-prop-([A-Za-z0-9-]+)/i.exec(url) ?? /\/([a-z0-9-]+)$/i.exec(url);
  return m?.[1] ? (m[0].includes('ec-prop') ? `ec-prop-${m[1]}` : m[1]) : undefined;
}

function itemToRaw(item: Record<string, unknown>): ProperatiEcRawListing | undefined {
  const sourceId = asString(item.id) ?? properatiEcSourceIdFromUrl(asString(item.url) ?? '');
  const url = asString(item.url);
  const price = asNumber(item.price);
  if (!sourceId || !url || price === undefined) return undefined;
  const place = isRecord(item.place) ? item.place : undefined;
  const images = Array.isArray(item.images) ? item.images.filter((e): e is string => typeof e === 'string') : [];
  const op = asString(item.operation)?.toLowerCase();
  return {
    sourceId, url: url.startsWith('http') ? url : `${PROPERATI_EC_BASE_URL}${url}`,
    title: asString(item.title),
    operation: op === 'sale' || op === 'venta' ? 'sale' : 'rent',
    price, currency: asString(item.currency) ?? 'USD',
    bedrooms: asNumber(item.rooms), bathrooms: asNumber(item.bathrooms), squareMeters: asNumber(item.surface),
    address: {
      city: asString(place?.name) ?? 'Quito',
      region: asString(isRecord(place?.parent) ? place.parent.name : undefined),
      countryCode: 'EC',
    },
    images, contact: contactFromUnknown(item.contact),
  };
}

export function parseProperatiEcSearchJson(body: string): ProperatiEcSearchRef[] {
  let parsed: unknown;
  try { parsed = JSON.parse(body.trim()); } catch { return []; }
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
  const node = findJsonLdByType(nodes, 'Apartment') ?? findJsonLdByType(nodes, 'House') ?? findJsonLdByType(nodes, 'Residence') ?? nodes[0];
  if (!node) throw new Error(`properati_ec: no JSON-LD for ${url}`);
  const offer = isRecord(node.offers) ? node.offers : undefined;
  const price = asNumber(offer?.price);
  const address = isRecord(node.address) ? node.address : undefined;
  if (price === undefined) throw new Error(`properati_ec: missing price for ${url}`);
  const floorSize = isRecord(node.floorSize) ? node.floorSize : undefined;
  const images: string[] = [];
  if (typeof node.image === 'string') images.push(node.image);
  else if (Array.isArray(node.image)) for (const e of node.image) if (typeof e === 'string') images.push(e);
  return {
    sourceId: properatiEcSourceIdFromUrl(url) ?? 'unknown',
    url: asString(node.url) ?? url,
    title: asString(node.name),
    operation: 'rent',
    price, currency: asString(offer?.priceCurrency) ?? 'USD',
    bedrooms: asNumber(node.numberOfRooms), bathrooms: asNumber(node.numberOfBathroomsTotal),
    squareMeters: asNumber(floorSize?.value),
    address: { city: asString(address?.addressLocality) ?? 'Quito', region: asString(address?.addressRegion), countryCode: 'EC' },
    images,
  };
}
