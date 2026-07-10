/**
 * pisos.com parsers — JSON-first (JSON-LD search cards + embedded detail JSON).
 *
 * Search: schema.org JSON-LD blocks → refs.
 * Detail: `data-var` JSON + tracking/`precio` JSON + optional contact AJAX.
 * HTML is only used for title/description/image fallbacks when JSON lacks them.
 */

import type { NormalizedListingContact } from '@homiio/shared-types';
import { ldJsonScriptBodies } from '../../html';
import { extractEsSchemaListings, type EsSchemaListing } from '../../parse/jsonLd';
import { PISOS_BASE_URL } from './fixtures';
import { asCoordinate, asNumber } from '../../parse/guards';

/** Raw payload `fetch()` hands to `normalize()`. */
export interface PisosRaw {
  sourceId: string;
  url: string;
  listing: EsSchemaListing;
  contact?: NormalizedListingContact;
}

const DETAIL_PATH_RE = /\/(?:alquilar|comprar)\/[^"'?\s]*?-(\d+[._]\d+|\d+)\/?/i;
const SEARCH_LINK_RE = /href=["'](\/alquilar\/[^"'?\s]+-\d+_\d+\/)["']/gi;
const PRECIO_VAR_RE = /var\s+precio\s*=\s*(\d+)/i;
const PISOS_IMG_HOST = 'https://fotos.imghs.net/';

function stripTags(html: string): string {
  let out = '';
  let inTag = false;
  for (let i = 0; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '<') inTag = true;
    else if (ch === '>') inTag = false;
    else if (!inTag) out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function readBalancedJsonAfter(html: string, marker: string): Record<string, unknown> | undefined {
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  const braceStart = html.indexOf('{', idx + marker.length);
  if (braceStart < 0) return undefined;
  let depth = 0;
  for (let i = braceStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return parseJsonObject(html.slice(braceStart, i + 1));
    }
  }
  return undefined;
}

function readFirstH1Text(html: string): string | undefined {
  const open = html.search(/<h1\b/i);
  if (open < 0) return undefined;
  const contentStart = html.indexOf('>', open);
  if (contentStart < 0) return undefined;
  const close = html.indexOf('</h1>', contentStart + 1);
  if (close < 0) return undefined;
  const raw = html.slice(contentStart + 1, close);
  return raw.length > 0 ? stripTags(raw) : undefined;
}

function readDescriptionText(html: string): string | undefined {
  const marker = 'class="description"';
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  const contentStart = html.indexOf('>', idx + marker.length);
  if (contentStart < 0) return undefined;
  const closeP = html.indexOf('</p>', contentStart + 1);
  const closeDiv = html.indexOf('</div>', contentStart + 1);
  const close =
    closeP >= 0 && closeDiv >= 0 ? Math.min(closeP, closeDiv) : Math.max(closeP, closeDiv);
  if (close < 0) return undefined;
  const raw = html.slice(contentStart + 1, close);
  return raw.length > 0 ? stripTags(raw) : undefined;
}

function readPisosImageUrls(html: string): string[] {
  const urls: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const idx = html.indexOf(PISOS_IMG_HOST, cursor);
    if (idx < 0) break;
    let end = idx + PISOS_IMG_HOST.length;
    while (end < html.length) {
      const ch = html[end];
      if (/[a-zA-Z0-9_./%-]/.test(ch)) {
        end += 1;
        continue;
      }
      break;
    }
    const candidate = html.slice(idx, end);
    if (/\.(?:jpg|jpeg|webp|png)$/i.test(candidate)) urls.push(candidate);
    cursor = end;
  }
  return urls;
}

function readHiddenPisoId(html: string): string | undefined {
  const marker = 'hdnIdPiso';
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  const valueMarker = 'value="';
  const valueStart = html.indexOf(valueMarker, idx);
  if (valueStart < 0) return undefined;
  const start = valueStart + valueMarker.length;
  const end = html.indexOf('"', start);
  if (end < 0) return undefined;
  const value = html.slice(start, end);
  return value.length > 0 ? value : undefined;
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

  for (const body of ldJsonScriptBodies(html)) {
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

  if (refs.length === 0) {
    for (const match of html.matchAll(SEARCH_LINK_RE)) {
      const path = match[1];
      if (!path) continue;
      const url = absoluteUrl(path);
      const sourceId = pisosSourceIdFromUrl(url);
      if (!sourceId || seen.has(sourceId)) continue;
      seen.add(sourceId);
      refs.push({ sourceId, url });
    }
  }

  return refs;
}

function readDataVar(html: string): Record<string, unknown> | undefined {
  const marker = 'data-var=';
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  const quoteStart = idx + marker.length;
  const quote = html[quoteStart];
  if (quote !== '"' && quote !== "'") return undefined;
  const jsonStart = quoteStart + 1;
  if (html[jsonStart] !== '{') return undefined;
  let depth = 0;
  for (let i = jsonStart; i < html.length; i += 1) {
    const ch = html[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (html[i + 1] !== quote) return undefined;
        return parseJsonObject(html.slice(jsonStart, i + 1).replace(/&quot;/g, '"'));
      }
    }
  }
  return undefined;
}

function readTrack(html: string): Record<string, unknown> | undefined {
  return readBalancedJsonAfter(html, '__pisosTrack');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** Detail pages embed map coords in `locationmap` data-params (JSON-LD is search-only). */
export function readPisosLocationMapCoordinates(html: string): { lat: number; lng: number } | undefined {
  const match = html.match(/locationmap[^>]*data-params="([^"]+)"/i);
  if (!match) return undefined;
  const params = decodeHtmlEntities(match[1]);
  const lat = asCoordinate(params.match(/(?:^|[&?])latitude=([^&]+)/)?.[1]);
  const lng = asCoordinate(params.match(/(?:^|[&?])longitude=([^&]+)/)?.[1]);
  if (lat === undefined || lng === undefined) return undefined;
  return { lat, lng };
}

interface PisosAscendingGeo {
  province?: string;
  municipality?: string;
  comarca?: string;
}

/** Breadcrumb geo rows (`ascending-geo__row`) carry province/municipality names. */
export function readPisosAscendingGeo(html: string): PisosAscendingGeo {
  const levels: PisosAscendingGeo = {};
  let pos = 0;
  while (pos < html.length) {
    const rowStart = html.indexOf('ascending-geo__row', pos);
    if (rowStart < 0) break;
    const rowEnd = html.indexOf('</div>', rowStart);
    if (rowEnd < 0) break;
    const row = html.slice(rowStart, rowEnd);
    pos = rowEnd + '</div>'.length;

    const level = row.match(/data-ga-geoLevelName='([^']+)'/)?.[1];
    const name = row.match(/<span property="name">([^<]+)<\/span>/)?.[1]?.trim();
    if (!level || !name) continue;
    if (level === 'provincia') levels.province = name;
    else if (level === 'municipio') levels.municipality = name;
    else if (level === 'comarca') levels.comarca = name;
  }
  return levels;
}

/** Five-digit postal codes are often embedded in the detail URL slug before the listing id. */
export function postalCodeFromPisosUrl(url: string): string | undefined {
  return url.match(/(\d{5})-\d+[._]\d+/)?.[1];
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
  const resolvedId = pisosSourceIdFromUrl(url) ?? readHiddenPisoId(html);
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

  const h1 = readFirstH1Text(html);
  const description = readDescriptionText(html) ?? h1;

  const images = [...new Set(readPisosImageUrls(html))];
  const ld = extractEsSchemaListings(html)[0];
  const geo = readPisosAscendingGeo(html);
  const mapCoords = readPisosLocationMapCoordinates(html);
  const city = geo.municipality ?? ld?.address?.city ?? geo.province ?? '';
  if (!city) {
    throw new Error(`pisos: listing ${resolvedId} has no resolvable city`);
  }
  const street = ld?.address?.street ?? h1 ?? city;
  const postalCode = ld?.address?.postalCode ?? postalCodeFromPisosUrl(url);

  const listing: EsSchemaListing = {
    types,
    name: h1 ?? ld?.name,
    description: description || ld?.description,
    url,
    address: {
      street,
      city,
      region: geo.province ?? ld?.address?.region,
      postalCode,
      neighborhood: ld?.address?.neighborhood,
      country: ld?.address?.country,
      countryCode: ld?.address?.countryCode ?? 'ES',
    },
    coordinates: mapCoords ?? ld?.coordinates,
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
