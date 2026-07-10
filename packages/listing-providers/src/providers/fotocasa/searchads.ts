/**
 * Fotocasa searchads AJAX discover helpers (pure parsing + URL building).
 *
 * Fotocasa's search UI loads listings via `web.gw.fotocasa.es/v2/propertysearch/`:
 *   1. `urllocationsegments` — resolve city slug → combinedLocations ids + coordinates
 *   2. `searchads` — paginated `{ realEstates: [...] }` JSON (primary discover path)
 *
 * Cold HTTP/proxy calls return 403 (PerimeterX/DataDome). The warmed Playwright
 * session path uses `session.request.get` from a city search page instead.
 * SSR may also embed `realEstates` in the warmed search HTML — parsed as fallback.
 */

import { FOTOCASA_BASE_URL } from './fixtures';
import { fotocasaSourceIdFromUrl, parseFotocasaSearch } from './parse';
import { asString, isRecord } from '../../parse/guards';

/** Fotocasa property-search gateway (internal JSON API). */
export const FOTOCASA_GW_BASE = 'https://web.gw.fotocasa.es/v2/propertysearch';

/** Known Fotocasa location slugs for default discover cities. */
const CITY_LOCATION_SLUGS: Readonly<Record<string, string>> = {
  madrid: 'madrid-capital',
  barcelona: 'barcelona-capital',
  valencia: 'valencia-capital',
  sevilla: 'sevilla-capital',
  malaga: 'malaga-capital',
};

/** Madrid-capital combinedLocations when urllocationsegments is unavailable. */
export const FOTOCASA_DEFAULT_MADRID_LOCATIONS = '724,14,28,173,0,28079,0,0,0';

export interface FotocasaLocationSegments {
  ids: string;
  latitude: number;
  longitude: number;
}

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolve the Fotocasa location segment slug for a city name. */
export function fotocasaLocationSlug(city: string): string {
  const slug = citySlug(city);
  return CITY_LOCATION_SLUGS[slug] ?? `${slug}-capital`;
}

/**
 * Derive a discover warm city from a Fotocasa detail URL (`…/vivienda/<slug>/…`).
 * Used for fetch: warm the city search page (PerimeterX-friendly) before property JSON.
 */
export function fotocasaCityFromRefUrl(url: string): string {
  const match = url.match(/\/vivienda(?:s)?\/([^/]+)\//i);
  if (!match?.[1]) return 'madrid';
  const location = match[1].toLowerCase();
  if (location.endsWith('-capital')) return location.slice(0, -'-capital'.length);
  for (const [city, slug] of Object.entries(CITY_LOCATION_SLUGS)) {
    if (slug === location) return city;
  }
  return location;
}

/** Fotocasa rental search page used to warm PerimeterX before searchads AJAX. */
export function fotocasaWarmSearchUrl(city: string, page = 1): string {
  const location = fotocasaLocationSlug(city);
  const base = `${FOTOCASA_BASE_URL}/es/alquiler/viviendas/${location}/todas-las-zonas/l`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

/** Build urllocationsegments URL for a city. */
export function fotocasaUrlLocationSegmentsUrl(city: string): string {
  const location = fotocasaLocationSlug(city);
  return `${FOTOCASA_GW_BASE}/urllocationsegments?location=${encodeURIComponent(location)}&zone=todas-las-zonas`;
}

/** Build searchads URL from resolved location segments + 1-based page. */
export function fotocasaSearchadsUrl(segments: FotocasaLocationSegments, page = 1): string {
  const params = new URLSearchParams({
    combinedLocations: segments.ids,
    latitude: String(segments.latitude),
    longitude: String(segments.longitude),
    pageNumber: String(page),
    size: '30',
    transactionType: 'RENT',
    propertyType: 'HOMES',
    sortType: 'publicationDate',
    sortOrderDesc: 'true',
  });
  return `${FOTOCASA_GW_BASE}/searchads?${params.toString()}`;
}

/** Build property detail JSON API URL. */
export function fotocasaPropertyApiUrl(
  propertyId: string,
  transactionType: 'RENT' | 'BUY' = 'RENT',
): string {
  const params = new URLSearchParams({
    propertyId,
    transactionType,
    language: 'es',
  });
  return `${FOTOCASA_GW_BASE}/property?${params.toString()}`;
}

/** PerimeterX / DataDome challenge bodies served instead of searchads JSON. */
export function isFotocasaSearchadsChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (/captcha-delivery\.com|geo\.captcha|datadome|px-captcha/i.test(trimmed)) return true;
  if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return true;
  if (/sentimos la interrupci|pardon our interruption|verifica que eres/i.test(trimmed)) return true;
  return false;
}

function refFromRecord(record: Record<string, unknown>): { sourceId: string; url: string } | undefined {
  const rawId = record.propertyId ?? record.id ?? record.adId;
  const sourceId = asString(rawId)?.replace(/\D/g, '');
  if (!sourceId || !/^\d{5,}$/.test(sourceId)) return undefined;

  const detailUrl =
    asString(record.detailUrl) ??
    asString(record.url) ??
    (Array.isArray(record.uris)
      ? asString((record.uris[0] as Record<string, unknown> | undefined)?.value)
      : undefined);

  if (detailUrl) {
    const url = detailUrl.startsWith('http') ? detailUrl : `${FOTOCASA_BASE_URL}${detailUrl}`;
    return { sourceId, url };
  }

  return {
    sourceId,
    url: `${FOTOCASA_BASE_URL}/es/alquiler/vivienda/x/${sourceId}/d`,
  };
}

function collectRefsFromUnknown(value: unknown, out: Map<string, string>): void {
  if (typeof value === 'string') {
    if (value.includes('/d')) {
      for (const ref of parseFotocasaSearch(value)) {
        out.set(ref.sourceId, ref.url);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectRefsFromUnknown(entry, out);
    return;
  }
  if (!isRecord(value)) return;

  const ref = refFromRecord(value);
  if (ref) out.set(ref.sourceId, ref.url);

  for (const key of ['realEstates', 'ads', 'items', 'results', 'data', 'content', 'html']) {
    if (key in value) collectRefsFromUnknown(value[key], out);
  }
}

/**
 * Parse urllocationsegments JSON into combinedLocations ids + coordinates.
 * Returns undefined when the body is not valid location JSON.
 */
export function parseFotocasaLocationSegments(body: string): FotocasaLocationSegments | undefined {
  if (isFotocasaSearchadsChallenge(body)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const ids = asString(parsed.ids);
  const coords = isRecord(parsed.coordinates) ? parsed.coordinates : undefined;
  const latitude = coords ? Number(coords.latitude) : Number.NaN;
  const longitude = coords ? Number(coords.longitude) : Number.NaN;
  if (!ids || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
  return { ids, latitude, longitude };
}

/**
 * Parse a searchads AJAX body (or SSR-embedded JSON) into de-duplicated listing
 * refs. Accepts `{ realEstates: [...] }` or raw HTML with detail links.
 */
export function parseFotocasaSearchads(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (trimmed.length === 0 || isFotocasaSearchadsChallenge(trimmed)) return [];

  const out = new Map<string, string>();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      collectRefsFromUnknown(JSON.parse(trimmed) as unknown, out);
    } catch {
      // Fall through to HTML parsing.
    }
  }

  if (out.size === 0) {
    const ssrRefs = parseFotocasaSsrSearch(trimmed);
    for (const ref of ssrRefs) out.set(ref.sourceId, ref.url);
  }

  if (out.size === 0 && trimmed.includes('/d')) {
    for (const ref of parseFotocasaSearch(trimmed)) {
      out.set(ref.sourceId, ref.url);
    }
  }

  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}

/**
 * Extract listing refs from SSR search HTML that embeds a `realEstates` JSON array
 * (observed on warmed search pages when searchads XHR is not separately captured).
 */
export function parseFotocasaSsrSearch(html: string): { sourceId: string; url: string }[] {
  const match = html.match(/"realEstates"\s*:\s*(\[[\s\S]{0,200000}?\])\s*,\s*"/);
  if (!match?.[1]) return parseFotocasaSearch(html);
  try {
    return parseFotocasaSearchads(match[1]);
  } catch {
    return parseFotocasaSearch(html);
  }
}

/** Resolve default location segments for a city when urllocationsegments fails. */
export function fotocasaDefaultLocationSegments(city: string): FotocasaLocationSegments {
  const slug = citySlug(city);
  if (slug === 'madrid') {
    return { ids: FOTOCASA_DEFAULT_MADRID_LOCATIONS, latitude: 40.4096, longitude: -3.68624 };
  }
  return {
    ids: FOTOCASA_DEFAULT_MADRID_LOCATIONS,
    latitude: 40.4096,
    longitude: -3.68624,
  };
}

export { fotocasaSourceIdFromUrl };
