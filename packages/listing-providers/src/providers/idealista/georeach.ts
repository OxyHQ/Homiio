/**
 * Idealista georeach AJAX discover helpers (pure parsing + URL building).
 *
 * Idealista's search UI loads additional listings via
 * `/es/ajax/listing/georeach/{city}-{province}` once a DataDome session exists.
 * Cold HTTP/proxy calls return 403; the warmed Playwright session path uses
 * `page.request.get` from a city search page instead.
 *
 * Response shape is not publicly documented. The parser accepts:
 *   - JSON arrays/objects carrying `adId` / `propertyCode` / `id`
 *   - JSON wrappers with an `html`/`content`/`items` field
 *   - Raw HTML fragments (reuses {@link parseIdealistaSearch})
 */

import { isDataDomeAjaxChallenge } from '../../parse/challenge';
import { IDEALISTA_BASE_URL } from './fixtures';
import { idealistaSourceIdFromUrl, parseIdealistaSearch } from './parse';

/** Known `{city}-{province}` slugs for default discover cities. */
const GEOREACH_SLUGS: Readonly<Record<string, string>> = {
  madrid: 'madrid-madrid',
  barcelona: 'barcelona-barcelona',
  valencia: 'valencia-valencia',
  sevilla: 'sevilla-sevilla',
  malaga: 'malaga-malaga',
};

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resolve the georeach path segment for a city name. */
export function idealistaGeoreachSlug(city: string): string {
  const slug = citySlug(city);
  return GEOREACH_SLUGS[slug] ?? `${slug}-${slug}`;
}

/** Build the warmed-session discover URL for a city + 1-based page. */
export function idealistaGeoreachUrl(city: string, page = 1): string {
  const slug = idealistaGeoreachSlug(city);
  const base = `${IDEALISTA_BASE_URL}/es/ajax/listing/georeach/${slug}`;
  if (page <= 1) return base;
  return `${base}?page=${page}`;
}

/** Idealista rental search page used to warm DataDome before georeach AJAX. */
export function idealistaWarmSearchUrl(city: string, page = 1): string {
  const slug = citySlug(city);
  const base = `${IDEALISTA_BASE_URL}/alquiler-viviendas/${slug}/`;
  return page <= 1 ? base : `${base}pagina-${page}.htm`;
}

/** DataDome captcha JSON served instead of georeach listings. */
export function isIdealistaGeoreachChallenge(body: string): boolean {
  return isDataDomeAjaxChallenge(body);
}

function refFromId(rawId: unknown): { sourceId: string; url: string } | undefined {
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return undefined;
  const sourceId = String(rawId).replace(/\D/g, '');
  if (!/^\d{5,}$/.test(sourceId)) return undefined;
  return { sourceId, url: `${IDEALISTA_BASE_URL}/inmueble/${sourceId}/` };
}

function collectIdsFromRecord(record: Record<string, unknown>, out: Map<string, string>): void {
  const candidates = [record.adId, record.adid, record.propertyCode, record.propertyId, record.id];
  for (const candidate of candidates) {
    const ref = refFromId(candidate);
    if (ref) out.set(ref.sourceId, ref.url);
  }
  const nestedUrl = record.url ?? record.detailUrl ?? record.link;
  if (typeof nestedUrl === 'string') {
    const sourceId = idealistaSourceIdFromUrl(nestedUrl);
    if (sourceId) out.set(sourceId, `${IDEALISTA_BASE_URL}/inmueble/${sourceId}/`);
  }
}

function collectFromUnknown(value: unknown, out: Map<string, string>): void {
  if (typeof value === 'string') {
    if (value.includes('/inmueble/')) {
      for (const ref of parseIdealistaSearch(value)) {
        out.set(ref.sourceId, ref.url);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectFromUnknown(entry, out);
    return;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    collectIdsFromRecord(record, out);
    for (const key of ['items', 'listings', 'ads', 'elements', 'data', 'result', 'content', 'html', 'body']) {
      if (key in record) collectFromUnknown(record[key], out);
    }
  }
}

/**
 * Parse a georeach AJAX body into de-duplicated listing refs. Accepts JSON or
 * HTML. Returns an empty array when the payload carries no recognizable ids.
 */
export function parseIdealistaGeoreach(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (trimmed.length === 0 || isIdealistaGeoreachChallenge(trimmed)) return [];

  const out = new Map<string, string>();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      collectFromUnknown(JSON.parse(trimmed) as unknown, out);
    } catch {
      // Fall through to HTML parsing.
    }
  }

  if (out.size === 0 && trimmed.includes('/inmueble/')) {
    for (const ref of parseIdealistaSearch(trimmed)) {
      out.set(ref.sourceId, ref.url);
    }
  }

  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
