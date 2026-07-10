/**
 * pisos.com parsers — JSON-first (JSON-LD search cards + embedded detail JSON).
 *
 * Search: schema.org JSON-LD blocks → refs.
 * Detail: `data-var` JSON + tracking/`precio` JSON + optional contact AJAX.
 * HTML is only used for title/description/image fallbacks when JSON lacks them.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { extractEsSchemaListings, type EsSchemaListing } from '../es/jsonLd';
import { PISOS_BASE_URL } from './fixtures';

/** Raw payload `fetch()` hands to `normalize()`. */
export interface PisosRaw {
  sourceId: string;
  url: string;
  listing: EsSchemaListing;
  contact?: NormalizedListingContact;
}

const DETAIL_PATH_RE = /\/(?:alquilar|comprar)\/[^"'?\s]*?-(\d+[._]\d+|\d+)\/?/i;
const DATA_VAR_RE = /data-var=['"](\{[\s\S]*?\})['"]/i;
const TRACK_RE =
  /\{[^{}]*"tipoContenido"\s*:\s*"detalle"[^{}]*"precio(?:Inmueble)?"\s*:\s*"?\d+"?[^{}]*\}/;
const PRECIO_VAR_RE = /var\s+precio\s*=\s*(\d+)/i;
const H1_RE = /<h1[^>]*>([\s\S]*?)<\/h1>/i;
const IMG_RE = /https:\/\/fotos\.imghs\.net\/[^"'?\s]+\.(?:jpg|jpeg|webp|png)/gi;
const DESC_RE = /<(?:p|div)[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div)>/i;
const HDN_ID_RE = /hdnIdPiso"[^>]*value="([^"]+)"/i;
const LD_JSON_RE =
  /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.,-]/g, '').replace(/\./g, '').replace(',', '.');
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Extract stable id from a pisos detail URL (`…-<id>_<agency>/` or `…-<id>/`). */
export function pisosSourceIdFromUrl(url: string): string | undefined {
  const raw = url.match(DETAIL_PATH_RE)?.[1];
  return raw ? raw.replace('_', '.') : undefined;
}

function absoluteUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http')) return pathOrUrl;
  return `${PISOS_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/**
 * Parse search HTML into de-duplicated detail refs from JSON-LD cards.
 */
export function parsePisosSearch(html: string): { sourceId: string; url: string }[] {
  const seen = new Set<string>();
  const refs: { sourceId: string; url: string }[] = [];

  for (const match of html.matchAll(LD_JSON_RE)) {
    const body = match[1]?.trim();
    if (!body) continue;
    const record = parseJsonObject(body);
    if (!record) continue;
    const path = typeof record.url === 'string' ? record.url : undefined;
    if (!path) continue;
    const url = absoluteUrl(path);
    const fromPath = pisosSourceIdFromUrl(url);
    const fromId =
      typeof record['@id'] === 'string' || typeof record['@id'] === 'number'
        ? String(record['@id'])
        : undefined;
    const sourceId = fromPath ?? fromId;
    if (!sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    refs.push({ sourceId, url });
  }

  return refs;
}

function readDataVar(html: string): Record<string, unknown> | undefined {
  const match = html.match(DATA_VAR_RE);
  if (!match?.[1]) return undefined;
  return parseJsonObject(match[1].replace(/&quot;/g, '"'));
}

function readTrack(html: string): Record<string, unknown> | undefined {
  const match = html.match(TRACK_RE);
  if (!match?.[0]) return undefined;
  return parseJsonObject(match[0]);
}

function amenityList(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return [];
  return raw
    .split(',')
    .map((part) =>
      part
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
    )
    .filter(Boolean);
}

/**
 * Parse a detail page into {@link PisosRaw}. Prefers embedded JSON blobs;
 * falls back to JSON-LD / light HTML for title, images, description.
 */
export function parsePisosDetail(html: string, url: string): PisosRaw {
  const dataVar = readDataVar(html);
  const track = readTrack(html);
  const resolvedId = pisosSourceIdFromUrl(url) ?? html.match(HDN_ID_RE)?.[1];
  if (!resolvedId) {
    throw new Error(`pisos: cannot derive a source id from ${url}`);
  }

  const price =
    asNumber(track?.precioInmueble) ??
    asNumber(track?.precio) ??
    asNumber(html.match(PRECIO_VAR_RE)?.[1]);
  if (price === undefined) {
    throw new Error(`pisos: listing ${resolvedId} has no resolvable price`);
  }

  const operationRaw = typeof track?.tipoOperacion === 'string' ? track.tipoOperacion : '';
  const operation: 'rent' | 'sale' =
    operationRaw.includes('venta') || url.includes('/comprar/') ? 'sale' : 'rent';

  const subtype = typeof track?.subTipoInmueble === 'string' ? track.subTipoInmueble : '';
  const types = ['Residence'];
  if (subtype.includes('piso') || subtype.includes('apartamento')) types.push('Apartment');
  if (subtype.includes('chalet') || subtype.includes('casa')) types.push('House');
  if (subtype.includes('estudio')) types.push('Studio');

  const h1Raw = html.match(H1_RE)?.[1];
  const h1 = h1Raw ? stripTags(h1Raw) : undefined;
  const descMatch = html.match(DESC_RE);
  const description = descMatch ? stripTags(descMatch[1] ?? '') : h1;

  const images = [...new Set(html.match(IMG_RE) ?? [])];
  const ld = extractEsSchemaListings(html)[0];
  const city = ld?.address.city ?? 'Madrid';
  const street = ld?.address.street ?? h1 ?? city;

  const listing: EsSchemaListing = {
    types,
    name: h1 ?? ld?.name,
    description: description || ld?.description,
    url,
    address: {
      street,
      city,
      region: ld?.address.region,
      postalCode: ld?.address.postalCode,
      neighborhood: ld?.address.neighborhood,
      country: ld?.address.country,
      countryCode: ld?.address.countryCode ?? 'ES',
    },
    coordinates: ld?.coordinates,
    images: images.length > 0 ? images : (ld?.images ?? []),
    bedrooms: asNumber(dataVar?.nHabitaciones) ?? ld?.bedrooms,
    bathrooms: asNumber(dataVar?.nBanios) ?? ld?.bathrooms,
    squareMeters: asNumber(dataVar?.superficieInmueble) ?? ld?.squareMeters,
    price,
    priceCurrency: 'EUR',
    operation,
    amenities: amenityList(dataVar?.caracteristicasInmueble),
  };

  const phone =
    typeof dataVar?.telefono === 'string' && dataVar.telefono.trim()
      ? dataVar.telefono.trim()
      : undefined;
  const seller = typeof track?.tipoVendedor === 'string' ? track.tipoVendedor : '';
  const contact: NormalizedListingContact | undefined = phone
    ? {
        phone,
        kind: seller.includes('profesional') ? 'agency' : seller ? 'private' : 'unknown',
      }
    : undefined;

  return { sourceId: resolvedId, url, listing, contact };
}

/** Merge best-effort contact AJAX phone into an existing raw payload. */
export function mergePisosContact(raw: PisosRaw, phone: string | undefined): PisosRaw {
  if (!phone) return raw;
  return {
    ...raw,
    contact: {
      ...raw.contact,
      phone: raw.contact?.phone ?? phone,
      kind: raw.contact?.kind ?? 'unknown',
    },
  };
}
