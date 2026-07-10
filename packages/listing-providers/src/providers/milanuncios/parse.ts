/**
 * milanuncios JSON parsers + housing guards.
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingContact,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import { assertHousingListing, isHousingCategory } from '../es/housing';
import {
  MILANUNCIOS_BASE_URL,
  MILANUNCIOS_HOUSING_CATEGORY_IDS,
  MILANUNCIOS_HOUSING_CATEGORY_SLUGS,
} from './fixtures';

const PROVIDER_ID: ProviderId = 'milanuncios';

export interface MilanunciosRaw {
  sourceId: string;
  url: string;
  categorySlug: string;
  categoryId?: string;
  title: string;
  description?: string;
  price: number;
  currency: string;
  operation: 'rent' | 'sale';
  typology?: string;
  rooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  city: string;
  neighborhood?: string;
  province?: string;
  images: string[];
  contact?: NormalizedListingContact;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function milanunciosSourceIdFromUrl(url: string): string | undefined {
  return url.match(/(\d{6,})\.htm/i)?.[1] ?? url.match(/\/(\d{6,})\/?$/)?.[1];
}

function categoryFromRecord(record: Record<string, unknown>): { slug: string; id?: string } {
  const nested = isRecord(record.category) ? record.category : undefined;
  const slug =
    asString(nested?.slug) ??
    asString(record.categorySlug) ??
    asString(record.category_name) ??
    asString(record.category) ??
    '';
  const id = asString(nested?.id) ?? asString(record.categoryId);
  return { slug, id };
}

function isAllowedCategory(slug: string, id: string | undefined): boolean {
  const deaccent = slug
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (MILANUNCIOS_HOUSING_CATEGORY_SLUGS.has(deaccent)) return true;
  if (id && MILANUNCIOS_HOUSING_CATEGORY_IDS.has(id)) return true;
  return isHousingCategory(slug);
}

/**
 * Parse a list/search AJAX JSON body into detail refs. Only housing-category
 * adverts are yielded.
 */
export function parseMilanunciosSearchJson(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  let root: unknown;
  try {
    root = JSON.parse(trimmed) as unknown;
  } catch {
    return [];
  }

  const adverts: unknown[] = [];
  if (Array.isArray(root)) {
    adverts.push(...root);
  } else if (isRecord(root)) {
    for (const key of ['adverts', 'ads', 'items', 'results', 'data', 'list']) {
      const value = root[key];
      if (Array.isArray(value)) {
        adverts.push(...value);
        break;
      }
      if (isRecord(value) && Array.isArray(value.adverts)) {
        adverts.push(...value.adverts);
        break;
      }
    }
  }

  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];
  for (const entry of adverts) {
    if (!isRecord(entry)) continue;
    const { slug, id } = categoryFromRecord(entry);
    if (slug && !isAllowedCategory(slug, id)) continue;
    const sourceId =
      asString(entry.id) ??
      asString(entry.advertId) ??
      (typeof entry.id === 'number' ? String(entry.id) : undefined);
    const url =
      asString(entry.url) ??
      asString(entry.detailUrl) ??
      (sourceId ? `${MILANUNCIOS_BASE_URL}/alquiler-de-pisos/${sourceId}.htm` : undefined);
    if (!sourceId || !url || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url });
  }
  return refs;
}

/** Parse a single advert JSON object into {@link MilanunciosRaw}. */
export function parseMilanunciosAdvert(payload: unknown, fallbackUrl?: string): MilanunciosRaw {
  if (!isRecord(payload)) {
    throw new Error('milanuncios: advert payload is not an object');
  }
  const sourceId =
    asString(payload.id) ??
    asString(payload.advertId) ??
    (typeof payload.id === 'number' ? String(payload.id) : undefined);
  if (!sourceId) throw new Error('milanuncios: advert missing id');

  const { slug, id } = categoryFromRecord(payload);
  const url =
    asString(payload.url) ??
    asString(payload.detailUrl) ??
    fallbackUrl ??
    `${MILANUNCIOS_BASE_URL}/anuncio/${sourceId}.htm`;

  const location = isRecord(payload.location) ? payload.location : undefined;
  const city = asString(location?.city) ?? asString(payload.city) ?? '';
  const price = asNumber(payload.price);
  if (price === undefined) throw new Error(`milanuncios: listing ${sourceId} has no price`);

  const operationRaw = asString(payload.operation)?.toLowerCase() ?? '';
  const operation: 'rent' | 'sale' =
    operationRaw.includes('sale') || operationRaw.includes('venta') || url.includes('venta-')
      ? 'sale'
      : 'rent';

  const imagesRaw = payload.images ?? payload.photos;
  const images: string[] = [];
  if (Array.isArray(imagesRaw)) {
    for (const img of imagesRaw) {
      if (typeof img === 'string') images.push(img);
      else if (isRecord(img)) {
        const u = asString(img.url) ?? asString(img.src);
        if (u) images.push(u);
      }
    }
  }

  const contactRaw = isRecord(payload.contact) ? payload.contact : undefined;
  const phone = asString(contactRaw?.phone) ?? asString(payload.phone);
  const contact: NormalizedListingContact | undefined = phone
    ? {
        phone,
        agencyName: asString(contactRaw?.name) ?? asString(payload.agencyName),
        email: asString(contactRaw?.email),
        kind: 'unknown',
      }
    : undefined;

  return {
    sourceId,
    url,
    categorySlug: slug,
    categoryId: id,
    title: asString(payload.title) ?? asString(payload.subject) ?? `Listing ${sourceId}`,
    description: asString(payload.description),
    price,
    currency: asString(payload.currency) ?? 'EUR',
    operation,
    typology: asString(payload.typology) ?? asString(payload.propertyType) ?? slug,
    rooms: asNumber(payload.rooms) ?? asNumber(payload.bedrooms),
    bathrooms: asNumber(payload.bathrooms),
    squareMeters: asNumber(payload.size) ?? asNumber(payload.squareMeters) ?? asNumber(payload.m2),
    city,
    neighborhood: asString(location?.neighborhood) ?? asString(payload.neighborhood),
    province: asString(location?.province) ?? asString(payload.province),
    images,
    contact,
  };
}

function resolvePropertyType(typology: string | undefined): PropertyType {
  const t = (typology ?? '').toLowerCase();
  if (t.includes('casa') || t.includes('chalet') || t.includes('house')) return PropertyType.HOUSE;
  if (t.includes('estudio') || t.includes('studio')) return PropertyType.STUDIO;
  if (t.includes('habitacion') || t.includes('room')) return PropertyType.ROOM;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

/**
 * Map a raw advert onto {@link NormalizedListing}, hard-rejecting non-housing.
 */
export function normalizeMilanunciosRaw(raw: MilanunciosRaw): NormalizedListing {
  assertHousingListing(PROVIDER_ID, raw.sourceId, {
    category: raw.categorySlug,
    typology: raw.typology,
    squareMeters: raw.squareMeters,
    bedrooms: raw.rooms,
    bathrooms: raw.bathrooms,
    hasAddressLike: Boolean(raw.city || raw.neighborhood || raw.province),
    hasPrice: Number.isFinite(raw.price),
  });

  if (raw.categoryId && !MILANUNCIOS_HOUSING_CATEGORY_IDS.has(raw.categoryId) && raw.categorySlug) {
    // id alone is not enough to reject when slug is housing; already checked above.
  }

  const isSale = raw.operation === 'sale';
  const result: NormalizedListing = {
    source: PROVIDER_ID,
    sourceId: raw.sourceId,
    sourceUrl: raw.url,
    address: {
      street: raw.neighborhood ?? raw.city,
      city: raw.city || raw.province || '',
      state: raw.province,
      neighborhood: raw.neighborhood,
      countryCode: 'ES',
    },
    type: resolvePropertyType(raw.typology),
    offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
    longTermRent: isSale ? undefined : { monthlyAmount: raw.price, currency: raw.currency },
    sale: isSale ? { price: raw.price, currency: raw.currency } : undefined,
    description: raw.description ?? raw.title,
    bedrooms: raw.rooms,
    bathrooms: raw.bathrooms,
    squareFootage: raw.squareMeters,
    remoteImages: toRemoteImages(raw.images),
    status: 'published',
  };
  if (raw.contact) result.contact = raw.contact;
  return result;
}
