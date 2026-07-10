/**
 * MercadoLibre EC inmuebles — housing-only. Shared classifieds/contact/jsonLd/nextData.
 */
import type { NormalizedListingContact } from '@homiio/shared-types';
import {
  assertHousingListing,
  isHousingCategory,
  isHousingCategoryUrl,
  NonHousingListingError,
} from '../../../classifieds';
import { buildContact, contactFromUnknown, mergeContact } from '../../../contact';
import { collectJsonLdNodes, findJsonLdByType } from '../../../jsonLd';
import { parsePreloadedState } from '../../../nextData';
import { citySlug } from '../../../slug';
import { MERCADOLIBRE_EC_BASE_URL, MERCADOLIBRE_EC_HOUSING_SLUGS } from './fixtures';

export interface MercadolibreEcSearchRef { sourceId: string; url: string; }

export interface MercadolibreEcRawListing {
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
  category?: string;
  domainId?: string;
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

export function isMercadolibreEcChallenge(body: string): boolean {
  if (body.trim().length < 128) return true;
  return /suspicious-traffic|captcha|datadome|access denied|just a moment/i.test(body);
}

export function mercadolibreEcSourceIdFromUrl(url: string): string | undefined {
  const match = /MEC-?(\d{6,})/i.exec(url);
  return match?.[1] ? `MEC-${match[1]}` : undefined;
}

export function isMercadolibreEcHousingCategory(category?: string, domainId?: string): boolean {
  if (domainId && /REAL_ESTATE|PROPERTIES|APARTMENTS|HOUSES|LAND/i.test(domainId)) return true;
  if (domainId && /CARS|ELECTRONICS|FASHION|JOBS|SERVICES/i.test(domainId)) return false;
  return isHousingCategory(category) || isHousingCategory(domainId);
}

function attributeValue(attrs: unknown, id: string): number | undefined {
  if (!Array.isArray(attrs)) return undefined;
  for (const entry of attrs) {
    if (!isRecord(entry)) continue;
    if (asString(entry.id) === id) return asNumber(entry.value_name) ?? asNumber(entry.value_struct);
  }
  return undefined;
}

function itemToRaw(item: Record<string, unknown>): MercadolibreEcRawListing | undefined {
  const id = asString(item.id) ?? mercadolibreEcSourceIdFromUrl(asString(item.permalink) ?? '');
  const url = asString(item.permalink) ?? asString(item.url);
  if (!id || !url) return undefined;
  const sourceId = id.startsWith('MEC') ? id.replace(/^MEC(?!-)/i, 'MEC-') : `MEC-${id.replace(/\D/g, '')}`;
  const price = asNumber(item.price);
  if (price === undefined) return undefined;
  const domainId = asString(item.domain_id) ?? asString(item.domainId);
  const category = asString(item.category_id) ?? domainId;
  if (!isMercadolibreEcHousingCategory(category, domainId)) {
    throw new NonHousingListingError('mercadolibre_ec', sourceId, `domain/category ${domainId ?? category}`);
  }
  const location = isRecord(item.location) ? item.location : undefined;
  const city =
    asString(isRecord(location?.city) ? location.city.name : undefined) ??
    asString(location?.city) ??
    'Quito';
  const region = asString(isRecord(location?.state) ? location.state.name : undefined);
  const street = asString(location?.address_line);
  const title = asString(item.title);
  const images: string[] = [];
  const thumb = asString(item.thumbnail);
  if (thumb) images.push(thumb);
  const seller = item.seller;
  const contact = mergeContact(
    contactFromUnknown(seller),
    buildContact({
      phone: isRecord(seller) && isRecord(seller.phone) ? asString(seller.phone.number) : undefined,
      agencyName: isRecord(seller) ? asString(seller.nickname) ?? asString(seller.name) : undefined,
    }),
  );
  const raw: MercadolibreEcRawListing = {
    sourceId,
    url,
    title,
    description: asString(item.description) ?? title,
    operation: /venta|sale/i.test(title ?? url) ? 'sale' : 'rent',
    price,
    currency: asString(item.currency_id) ?? 'USD',
    bedrooms: attributeValue(item.attributes, 'BEDROOMS'),
    bathrooms: attributeValue(item.attributes, 'FULL_BATHROOMS'),
    squareMeters: attributeValue(item.attributes, 'COVERED_AREA'),
    address: { street, city, region, countryCode: 'EC' },
    images,
    contact,
    category,
    domainId,
  };
  assertHousingListing('mercadolibre_ec', sourceId, {
    category: category ?? domainId,
    typology: domainId,
    squareMeters: raw.squareMeters,
    bedrooms: raw.bedrooms,
    bathrooms: raw.bathrooms,
    hasAddressLike: Boolean(city),
    hasPrice: true,
  });
  return raw;
}

function collectResults(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isRecord(entry) && (entry.id || entry.permalink)) out.push(entry);
      else collectResults(entry, out);
    }
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.results)) {
    collectResults(value.results, out);
    return;
  }
  for (const child of Object.values(value)) {
    if (out.length > 80) return;
    collectResults(child, out);
  }
}

export function parseMercadolibreEcSearchJson(body: string): MercadolibreEcSearchRef[] {
  if (!body.trim() || isMercadolibreEcChallenge(body)) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(body.trim()); } catch { return []; }
  const items: Record<string, unknown>[] = [];
  collectResults(parsed, items);
  const out: MercadolibreEcSearchRef[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    try {
      const raw = itemToRaw(item);
      if (!raw || seen.has(raw.sourceId)) continue;
      if (!isHousingCategoryUrl(raw.url, MERCADOLIBRE_EC_HOUSING_SLUGS) && !/departamento|casa|alquiler|venta|inmueble/i.test(raw.url)) continue;
      seen.add(raw.sourceId);
      out.push({ sourceId: raw.sourceId, url: raw.url });
    } catch (error) {
      if (error instanceof NonHousingListingError) continue;
      throw error;
    }
  }
  return out;
}

export function parseMercadolibreEcSearch(html: string): MercadolibreEcSearchRef[] {
  const state = parsePreloadedState(html);
  if (state) {
    const fromState = parseMercadolibreEcSearchJson(JSON.stringify(state));
    if (fromState.length > 0) return fromState;
  }
  return [];
}

export function parseMercadolibreEcDetail(html: string, url: string): MercadolibreEcRawListing {
  const nodes = collectJsonLdNodes(html);
  const product = findJsonLdByType(nodes, 'Product') ?? findJsonLdByType(nodes, 'Residence') ?? nodes[0];
  if (!product) throw new Error(`mercadolibre_ec: no detail for ${url}`);
  const offer = isRecord(product.offers) ? product.offers : undefined;
  const price = asNumber(offer?.price) ?? asNumber(product.price);
  const address = isRecord(product.address) ? product.address : undefined;
  const city = asString(address?.addressLocality) ?? 'Quito';
  if (price === undefined) throw new Error(`mercadolibre_ec: missing price for ${url}`);
  const sourceId = mercadolibreEcSourceIdFromUrl(url);
  if (!sourceId) throw new Error(`mercadolibre_ec: missing id for ${url}`);
  const images: string[] = [];
  if (typeof product.image === 'string') images.push(product.image);
  else if (Array.isArray(product.image)) for (const e of product.image) if (typeof e === 'string') images.push(e);
  const raw: MercadolibreEcRawListing = {
    sourceId,
    url: asString(product.url) ?? url,
    title: asString(product.name),
    description: asString(product.description),
    operation: /venta/i.test(url) ? 'sale' : 'rent',
    price,
    currency: asString(offer?.priceCurrency) ?? 'USD',
    address: { street: asString(address?.streetAddress), city, region: asString(address?.addressRegion), countryCode: 'EC' },
    images,
    contact: contactFromUnknown(product.seller),
    category: 'inmuebles',
    domainId: 'REAL_ESTATE',
  };
  assertHousingListing('mercadolibre_ec', sourceId, { category: 'inmuebles', typology: 'departamento', hasAddressLike: true, hasPrice: true });
  return raw;
}

export function parseMercadolibreEcItemJson(body: string, fallbackUrl: string): MercadolibreEcRawListing {
  const parsed: unknown = JSON.parse(body.trim());
  if (!isRecord(parsed)) throw new Error('mercadolibre_ec: item not object');
  const raw = itemToRaw(parsed);
  if (!raw) throw new Error(`mercadolibre_ec: empty item for ${fallbackUrl}`);
  return raw;
}

export function mercadolibreEcHousingSearchUrl(city: string, page = 1): string {
  const base = `${MERCADOLIBRE_EC_BASE_URL}/departamentos/alquiler/${citySlug(city)}/`;
  return page <= 1 ? base : `${base}_Desde_${(page - 1) * 48 + 1}_NoIndex_True`;
}
