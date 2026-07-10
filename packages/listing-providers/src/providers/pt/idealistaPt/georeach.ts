/**
 * Idealista.pt georeach AJAX discover helpers (pure).
 */

import { IDEALISTA_PT_BASE_URL } from './fixtures';
import { idealistaPtSourceIdFromUrl, parseIdealistaPtSearch } from './parse';

const GEOREACH_SLUGS: Readonly<Record<string, string>> = {
  lisboa: 'lisboa-lisboa',
  porto: 'porto-porto',
  braga: 'braga-braga',
  coimbra: 'coimbra-coimbra',
  faro: 'faro-faro',
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

export function idealistaPtGeoreachSlug(city: string): string {
  const slug = citySlug(city);
  return GEOREACH_SLUGS[slug] ?? `${slug}-${slug}`;
}

export function idealistaPtGeoreachUrl(city: string, page = 1): string {
  const slug = idealistaPtGeoreachSlug(city);
  const base = `${IDEALISTA_PT_BASE_URL}/pt/ajax/listing/georeach/${slug}`;
  if (page <= 1) return base;
  return `${base}?page=${page}`;
}

export function idealistaPtWarmSearchUrl(city: string, page = 1): string {
  const slug = citySlug(city);
  const base = `${IDEALISTA_PT_BASE_URL}/arrendar-casas/${slug}/`;
  return page <= 1 ? base : `${base}pagina-${page}.htm`;
}

export function isIdealistaPtGeoreachChallenge(body: string): boolean {
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
  return { sourceId, url: `${IDEALISTA_PT_BASE_URL}/imovel/${sourceId}/` };
}

function collectIdsFromRecord(record: Record<string, unknown>, out: Map<string, string>): void {
  const candidates = [record.adId, record.adid, record.propertyCode, record.propertyId, record.id];
  for (const candidate of candidates) {
    const ref = refFromId(candidate);
    if (ref) out.set(ref.sourceId, ref.url);
  }
  const nestedUrl = record.url ?? record.detailUrl ?? record.link;
  if (typeof nestedUrl === 'string') {
    const sourceId = idealistaPtSourceIdFromUrl(nestedUrl);
    if (sourceId) out.set(sourceId, `${IDEALISTA_PT_BASE_URL}/imovel/${sourceId}/`);
  }
}

function collectFromUnknown(value: unknown, out: Map<string, string>): void {
  if (typeof value === 'string') {
    if (value.includes('/imovel/')) {
      for (const ref of parseIdealistaPtSearch(value)) {
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

export function parseIdealistaPtGeoreach(body: string): { sourceId: string; url: string }[] {
  const trimmed = body.trim();
  if (trimmed.length === 0 || isIdealistaPtGeoreachChallenge(trimmed)) return [];

  const out = new Map<string, string>();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      collectFromUnknown(JSON.parse(trimmed) as unknown, out);
    } catch {
      // Fall through to HTML parsing.
    }
  }

  if (out.size === 0 && trimmed.includes('/imovel/')) {
    for (const ref of parseIdealistaPtSearch(trimmed)) {
      out.set(ref.sourceId, ref.url);
    }
  }

  return [...out.entries()].map(([sourceId, url]) => ({ sourceId, url }));
}
