/**
 * Habitaclia listainmuebles AJAX discover helpers (pure parsing + URL building).
 *
 * Habitaclia's search UI paginates via POST to `/dotnet/listados/listainmuebles`
 * with hidden `Filtros.*` fields from the warmed search page. Cold direct POST
 * without portal cookies often 403s; the warmed Playwright session uses
 * `page.request.post` from a city search page instead. The response is an HTML
 * fragment (not JSON) carrying `data-href` listing anchors.
 */

import { HABITACLIA_BASE_URL } from './fixtures';
import { parseHabitacliaSearch } from './parse';

/** CSS selector indicating real listing cards on search / AJAX fragments. */
export const HABITACLIA_CONTENT_SELECTOR =
  '[data-href*="-i"], .listado, .list-items, .js-list-items, main';

/** Fast path: listing cards expose detail URLs in `data-href`. */
export const HABITACLIA_LISTING_CARD_SELECTOR = '[data-href*="-i"]';

/** POST target for paginated search results (returns HTML fragments). */
export const HABITACLIA_LISTAINMUEBLES_URL = `${HABITACLIA_BASE_URL}/dotnet/listados/listainmuebles`;

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Habitaclia homepage — Imperva clearance before city search POST. */
export function habitacliaWarmHomeUrl(): string {
  return `${HABITACLIA_BASE_URL}/`;
}

/** Build a Habitaclia rental search URL for a city + 1-based page number. */
export function habitacliaWarmSearchUrl(city: string, page: number): string {
  const slug = citySlug(city);
  return page <= 1
    ? `${HABITACLIA_BASE_URL}/alquiler-${slug}.htm`
    : `${HABITACLIA_BASE_URL}/alquiler-${slug}-${page}.htm`;
}

/** Imperva / CloudFront block markers on listainmuebles responses. */
export function isHabitacliaListainmueblesChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length < 512) return true;
  return /403 ERROR|Pardon Our Interruption|hab_library|Request unsuccessful\. Incapsula/i.test(
    trimmed,
  );
}

/** Extract hidden search-form fields from a warmed search page (or page-1 HTML). */
export function extractHabitacliaListadoFormFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of html.matchAll(/<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["']/gi)) {
    const name = match[1];
    const value = match[2] ?? '';
    if (name.startsWith('Filtros.') || name === 'pagina') {
      fields[name] = value;
    }
  }
  return fields;
}

/** Build `application/x-www-form-urlencoded` body for a listainmuebles page. */
export function buildHabitacliaListainmueblesBody(
  formFields: Record<string, string>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(formFields)) {
    if (key !== 'pagina') params.set(key, value);
  }
  params.set('pagina', String(page));
  return params.toString();
}

/** Parse a listainmuebles AJAX HTML fragment into de-duplicated listing refs. */
export function parseHabitacliaListainmuebles(body: string): { sourceId: string; url: string }[] {
  if (isHabitacliaListainmueblesChallenge(body)) return [];
  return parseHabitacliaSearch(body);
}
