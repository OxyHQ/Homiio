/**
 * yaencontre.com JSON parsers (pure).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingContact,
  type ProviderId,
} from '@homiio/shared-types';
import { YAENCONTRE_BASE_URL } from './fixtures';
import { asNumber, asString, isRecord } from '../../parse/guards';

const PROVIDER_ID: ProviderId = 'yaencontre';

export interface YaencontreRaw {
  sourceId: string;
  url: string;
  title: string;
  description?: string;
  price: number;
  currency: string;
  operation: 'rent' | 'sale';
  rooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  street: string;
  city: string;
  province?: string;
  neighborhood?: string;
  images: string[];
  contact?: NormalizedListingContact;
}

export function yaencontreSourceIdFromUrl(url: string): string | undefined {
  return url.match(/\/(\d{5,})\/?$/)?.[1];
}

export function parseYaencontreSearchJson(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  let root: unknown;
  try {
    root = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }
  const items: unknown[] = [];
  if (Array.isArray(root)) items.push(...root);
  else if (isRecord(root)) {
    for (const key of ['results', 'listings', 'items', 'ads', 'data']) {
      if (Array.isArray(root[key])) {
        items.push(...(root[key] as unknown[]));
        break;
      }
    }
  }
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const entry of items) {
    if (!isRecord(entry)) continue;
    const sourceId =
      asString(entry.id) ?? (typeof entry.id === 'number' ? String(entry.id) : undefined);
    const url =
      asString(entry.url) ??
      (sourceId ? `${YAENCONTRE_BASE_URL}/alquiler/piso/${sourceId}` : undefined);
    if (!sourceId || !url || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url });
  }
  return refs;
}

export function parseYaencontreDetailJson(payload: unknown, fallbackUrl?: string): YaencontreRaw {
  if (!isRecord(payload)) throw new Error('yaencontre: detail payload is not an object');
  const sourceId =
    asString(payload.id) ?? (typeof payload.id === 'number' ? String(payload.id) : undefined);
  if (!sourceId) throw new Error('yaencontre: missing id');
  const price = asNumber(payload.price);
  if (price === undefined) throw new Error(`yaencontre: listing ${sourceId} has no price`);
  const address = isRecord(payload.address) ? payload.address : undefined;
  const city = asString(address?.city) ?? asString(payload.city) ?? '';
  if (!city) throw new Error(`yaencontre: listing ${sourceId} has no city`);
  const images: string[] = [];
  if (Array.isArray(payload.images)) {
    for (const img of payload.images) {
      if (typeof img === 'string') images.push(img);
    }
  }
  const contactRaw = isRecord(payload.contact) ? payload.contact : undefined;
  const phone = asString(contactRaw?.phone);
  const contact: NormalizedListingContact | undefined = phone
    ? {
        phone,
        agencyName: asString(contactRaw?.agencyName) ?? asString(contactRaw?.name),
        kind: 'agency',
      }
    : undefined;
  const operationRaw = asString(payload.operation)?.toLowerCase() ?? 'rent';
  return {
    sourceId,
    url: asString(payload.url) ?? fallbackUrl ?? `${YAENCONTRE_BASE_URL}/alquiler/piso/${sourceId}`,
    title: asString(payload.title) ?? `Listing ${sourceId}`,
    description: asString(payload.description),
    price,
    currency: asString(payload.currency) ?? 'EUR',
    operation: operationRaw.includes('sale') || operationRaw.includes('venta') ? 'sale' : 'rent',
    rooms: asNumber(payload.rooms) ?? asNumber(payload.bedrooms),
    bathrooms: asNumber(payload.bathrooms),
    squareMeters: asNumber(payload.size) ?? asNumber(payload.squareMeters),
    street: asString(address?.street) ?? city,
    city,
    province: asString(address?.province),
    neighborhood: asString(address?.neighborhood),
    images,
    contact,
  };
}

export function normalizeYaencontreRaw(raw: YaencontreRaw): NormalizedListing {
  const isSale = raw.operation === 'sale';
  const result: NormalizedListing = {
    source: PROVIDER_ID,
    sourceId: raw.sourceId,
    sourceUrl: raw.url,
    address: {
      street: raw.street,
      city: raw.city,
      state: raw.province,
      neighborhood: raw.neighborhood,
      countryCode: 'ES',
    },
    type: PropertyType.APARTMENT,
    offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
    longTermRent: isSale ? undefined : { monthlyAmount: raw.price, currency: raw.currency },
    sale: isSale ? { price: raw.price, currency: raw.currency } : undefined,
    description: raw.description ?? raw.title,
    bedrooms: raw.rooms,
    bathrooms: raw.bathrooms,
    squareFootage: raw.squareMeters,
    remoteImages: raw.images.map((url, index) => ({ url, isPrimary: index === 0 })),
    status: 'published',
  };
  if (raw.contact) result.contact = raw.contact;
  return result;
}
