/**
 * Shared HTML / JSON-embed extractors for listing providers.
 *
 * ONE chokepoint for `__NEXT_DATA__`, og: meta, JSON.parse blobs, and common
 * coerce helpers. Providers must import from here — never re-copy the regexes.
 */

import { asNumberEu, asString, deaccent, isRecord } from './parse/guards';
import { citySlug } from './slug';

export {
  extractNextData,
  parseNextData,
  parseNextDataPageProps,
  nextDataPageProps,
  parsePreloadedState,
  findNextDataArray,
  findNextDataRecord,
} from './nextData';

export { asString, deaccent };

/** Record guard returning the object or undefined (parser-friendly). */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** EU-aware numeric coerce — alias used by DE/ES/IT parsers. */
export function asNumber(value: unknown): number | undefined {
  return asNumberEu(value);
}

/** German city slug for path segments (`München` → `muenchen`). */
export function citySlugDe(city: string): string {
  return citySlug(city, '-');
}

/** Parse euro-formatted amounts (`1.250 €`, `1.659,50 €`). */
export function parseEuroAmount(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw !== 'string') return undefined;
  return asNumberEu(raw);
}

const META_PROPERTY_RE =
  /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gi;
const META_PROPERTY_RE_ALT =
  /<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']([^"']+)["'][^>]*>/gi;

/** Collect `<meta property|name="…" content="…">` into a map (first wins). */
export function extractMetaProperties(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of html.matchAll(META_PROPERTY_RE)) {
    const key = match[1]?.trim();
    const value = match[2]?.trim();
    if (key && value && !out.has(key)) out.set(key, value);
  }
  for (const match of html.matchAll(META_PROPERTY_RE_ALT)) {
    const value = match[1]?.trim();
    const key = match[2]?.trim();
    if (key && value && !out.has(key)) out.set(key, value);
  }
  return out;
}

/**
 * Extract a `JSON.parse("…")` / `JSON.parse('…')` string argument near a named
 * key (Immowelt `classified-serp-init-data`, similar SERP embeds).
 */
export function extractJsonParseBlob(html: string, key: string): string | undefined {
  const keyIdx = html.indexOf(key);
  if (keyIdx < 0) return undefined;
  const slice = html.slice(Math.max(0, keyIdx - 80), keyIdx + 2_000_000);
  const match =
    /JSON\.parse\(\s*"((?:\\.|[^"\\])*)"\s*\)/.exec(slice) ??
    /JSON\.parse\(\s*'((?:\\.|[^'\\])*)'\s*\)/.exec(slice);
  const raw = match?.[1];
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
}
