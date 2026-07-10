/**
 * Shared HTML / JSON-embed extractors (meta tags, JSON.parse blobs, city slugs).
 * JSON-LD / Next.js / guards live in `parse/` — import those directly.
 */

import { citySlug } from './slug';

export {
  extractNextData,
  parseNextData,
  parseNextDataPageProps,
  nextDataPageProps,
  parsePreloadedState,
  findNextDataArray,
  findNextDataRecord,
} from './parse/nextData';

export {
  asRecord,
  asString,
  asNumber,
  asNumberEu,
  asNumberUs,
  deaccent,
  isRecord,
  parseEuroAmount,
  firstString,
} from './parse/guards';

export { ldJsonScriptBodies } from './parse/jsonLd';

export { citySlug } from './slug';

/** German city slug alias used by DE portal parsers. */
export function citySlugDe(city: string): string {
  return citySlug(city, '-');
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
 * Extract a `JSON.parse("…")` string argument near a named key
 * (Immowelt `classified-serp-init-data`).
 */
export function extractJsonParseBlob(html: string, key: string): string | undefined {
  const keyIdx = html.indexOf(key);
  if (keyIdx < 0) return undefined;
  const scriptStart = html.lastIndexOf('<script', keyIdx);
  const scriptEnd = html.indexOf('</script>', keyIdx);
  if (scriptStart >= 0 && scriptEnd > scriptStart) {
    const script = html.slice(scriptStart, scriptEnd);
    const start = script.indexOf('JSON.parse("');
    const end = script.lastIndexOf('")');
    if (start >= 0 && end > start) {
      return script.slice(start + 'JSON.parse("'.length, end);
    }
  }
  const slice = html.slice(Math.max(0, keyIdx - 80), keyIdx + 2_000_000);
  const match =
    /JSON\.parse\(\s*"((?:\\.|[^"\\])*)"\s*\)/.exec(slice) ??
    /JSON\.parse\(\s*'((?:\\.|[^'\\])*)'\s*\)/.exec(slice);
  return match?.[1];
}
