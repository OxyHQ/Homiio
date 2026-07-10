/**
 * pisos.com AJAX / URL helpers (pure).
 *
 * Prefer structured JSON (search JSON-LD, detail `data-var` + tracking blob,
 * contact AJAX) over HTML scraping. Cold HTTP works for search/detail; contact
 * endpoints are best-effort and must not fail ingest on 403/empty.
 */

import { PISOS_BASE_URL } from './fixtures';

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Rental search URL for a city + 1-based page. */
export function pisosSearchUrl(city: string, page = 1): string {
  const base = `${PISOS_BASE_URL}/alquiler/pisos-${citySlug(city)}/`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

/** Sale search URL (secondary discover path). */
export function pisosSaleSearchUrl(city: string, page = 1): string {
  const base = `${PISOS_BASE_URL}/venta/pisos-${citySlug(city)}/`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

/** Contact phone AJAX (best-effort; often returns `{ phone: null }`). */
export function pisosContactPhoneUrl(sourceId: string): string {
  return `${PISOS_BASE_URL}/WebsiteUserInfo/GetNormalizedPhone?id=${encodeURIComponent(sourceId)}`;
}

/** Parse a contact AJAX JSON body into a phone string when present. */
export function parsePisosContactPhone(body: string): string | undefined {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return undefined;
  try {
    const record = JSON.parse(trimmed) as { phone?: unknown; normalizedPhone?: unknown };
    if (typeof record.normalizedPhone === 'string' && record.normalizedPhone.trim()) {
      return record.normalizedPhone.trim();
    }
    if (typeof record.phone === 'string' && record.phone.trim()) {
      return record.phone.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}
