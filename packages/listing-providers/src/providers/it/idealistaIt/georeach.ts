/**
 * Idealista.it georeach AJAX discover helpers (pure).
 *
 * IT host mirrors ES layout with Italian path segments:
 *   warm: `/affitto-case/{city}/`
 *   detail: `/immobile/{id}/`
 *   georeach: `/it/ajax/listing/georeach/{city}-{province}`
 */

import { IDEALISTA_IT_BASE_URL } from './fixtures';
import { idealistaItSourceIdFromUrl, parseIdealistaItSearch } from './parse';

const GEOREACH_SLUGS: Readonly<Record<string, string>> = {
  roma: 'roma-roma',
  milano: 'milano-milano',
  napoli: 'napoli-napoli',
  torino: 'torino-torino',
  firenze: 'firenze-firenze',
  bologna: 'bologna-bologna',
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

export function idealistaItGeoreachSlug(city: string): string {
  const slug = citySlug(city);
  return GEOREACH_SLUGS[slug] ?? `${slug}-${slug}`;
}

export function idealistaItGeoreachUrl(city: string, page = 1): string {
  const slug = idealistaItGeoreachSlug(city);
  const base = `${IDEALISTA_IT_BASE_URL}/it/ajax/listing/georeach/${slug}`;
  if (page <= 1) return base;
  return `${base}?page=${page}`;
}

export function idealistaItWarmSearchUrl(city: string, page = 1): string {
  const slug = citySlug(city);
  const base = `${IDEALISTA_IT_BASE_URL}/affitto-case/${slug}/`;
  return page <= 1 ? base : `${base}pagina-${page}.htm`;
}

export function isIdealistaItGeoreachChallenge(body: string): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return true;
  if (/captcha-delivery\.com|geo\.captcha|datadome/i.test(trimmed)) return true;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return /"url"\s*:\s*"https?:\/\/geo\.captcha/i.test(trimmed);
  }
  return false;
}

function refFromId(rawId: unknown): { sourceId: string; url: string } | undefined {
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return undefined;
  const sourceId = String(rawId).replace(/\D/g, '');
  if (!/^\d{5,}$/.test(sourceId)) return undefined;
  return { sourceId, url: `${IDEALISTA_IT_BASE_URL}/immobile/${sourceId}/` };
}

function collectIdsFromRecord(record: Record<string, unknown>, out: Map<string, string>): void {
  const candidates = [record.adId, record.adid, record.propertyCode, record.propertyId, record.id];
  for (const candidate of candidates) {
    const ref = refFromId(candidate);
    if (ref) out.set(ref.sourceId, ref.url);
  }
  const nestedUrl = record.url ?? record.detailUrl ?? record.link;
  if (typeof nestedUrl === 'string') {
    const sourceId = idealistaItSourceIdFromUrl(nestedUrl);
    if (sourceId) out.set(sourceId, `${IDEALISTA_IT_BASE_URL}/immobile/${sourceId}/`);
  }
}

function collectFromUnknown(value: unknown, out: Map<string, string>): void {
  if (typeof value === 'string') {
    if (value.includes('/immobile/')) {
      for (const ref of parseIdealistaItSearch(value)) {
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

export function parseIdealistaItGeoreach(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (trimmed.length === 0 || isIdealistaItGeoreachChallenge(trimmed)) return [];

  const out = new Map<string, string>();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      collectFromUnknown(JSON.parse(trimmed) as unknown, out);
    } catch {
      // Fall through to HTML parsing.
    }
  }

  if (out.size === 0 && trimmed.includes('/immobile/')) {
    for (const ref of parseIdealistaItSearch(trimmed)) {
      out.set(ref.sourceId, ref.url);
    }
  }

  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
