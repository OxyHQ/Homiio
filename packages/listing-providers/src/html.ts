/**
 * Shared HTML / JSON-embed extractors (meta tags, JSON.parse blobs, city slugs).
 * JSON-LD / Next.js / guards live in `parse/` — import those directly.
 */

import { citySlug } from './slug';

export { citySlug };

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
export { stripHtmlToPlainText } from './parse/htmlText';

/** German city slug alias used by DE portal parsers. */
export function citySlugDe(city: string): string {
  return citySlug(city, '-');
}

/**
 * One `<meta …>` tag at a time, found by literal scan.
 *
 * The two patterns this replaces each carried `[^>]+` TWICE around a required
 * attribute, which lets the engine re-split a long tag at every position — a
 * polynomial ReDoS (CodeQL `js/polynomial-redos`) on markup we fetch from
 * third-party portals. They also needed a mirrored ALT copy because HTML does
 * not fix attribute order, so `content` before `property` was a second regex
 * that could drift from the first.
 *
 * Scanning for the tag and then reading its attributes solves both: the scan is
 * linear, and attribute order stops mattering because attributes are parsed,
 * not positionally matched.
 */
const META_ATTRIBUTE_RE = /([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')/gi;

/** Collect `<meta property|name="…" content="…">` into a map (first wins). */
export function extractMetaProperties(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of metaTags(html)) {
    const attributes = tagAttributes(tag);
    const key = (attributes.get('property') ?? attributes.get('name'))?.trim();
    const value = attributes.get('content')?.trim();
    if (key && value && !out.has(key)) out.set(key, value);
  }
  return out;
}

/** Yield the inner text of each `<meta …>` tag, by literal scan. */
function* metaTags(html: string): Generator<string> {
  const lower = html.toLowerCase();
  let from = 0;
  for (;;) {
    const open = lower.indexOf('<meta', from);
    if (open < 0) return;

    // `<metadata>` is not `<meta>`: the next character must end the name.
    const after = lower[open + 5];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      from = open + 5;
      continue;
    }

    const close = html.indexOf('>', open);
    if (close < 0) return;
    yield html.slice(open + 5, close);
    from = close + 1;
  }
}

/** Parse `key="value"` pairs out of one tag's attribute text, lower-cased keys. */
function tagAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of tag.matchAll(META_ATTRIBUTE_RE)) {
    const key = match[1]?.toLowerCase();
    const value = match[3] ?? match[4];
    if (key && value !== undefined && !attributes.has(key)) attributes.set(key, value);
  }
  return attributes;
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

/**
 * Yield the body of every `<script>` whose `type` attribute contains `type`.
 *
 * **Replaces `/<script[^>]*type=["']…["'][^>]*>([\s\S]*?)<\/script>/gi`**, a
 * shape repeated across at least ten providers and flagged as
 * `js/polynomial-redos` in several: `[^>]*` appears twice around a required
 * attribute, so on a page with many `<script` tags the engine re-splits each
 * opening tag from every position. The input is markup from third-party
 * portals.
 *
 * Scanning is linear and, as a side effect, order-independent — `type` before
 * or after other attributes both work, which the positional pattern only
 * handled by luck.
 *
 * Matching `type` as a SUBSTRING is deliberate and preserves the old
 * behaviour: portals write `application/ld+json`, `application/ld+json;
 * charset=utf-8` and `text/javascript+ld` and all three were matched before.
 */
export function* scriptBlocks(html: string, type: string): Generator<string> {
  const lower = html.toLowerCase();
  const needle = type.toLowerCase();
  let from = 0;

  for (;;) {
    const open = lower.indexOf('<script', from);
    if (open < 0) return;

    // `<scripting>` is not `<script>`.
    const after = lower[open + 7];
    if (after !== undefined && !/[\s/>]/.test(after)) {
      from = open + 7;
      continue;
    }

    const openEnd = html.indexOf('>', open);
    if (openEnd < 0) return;

    const attributes = tagAttributes(html.slice(open + 7, openEnd));
    const close = lower.indexOf('</script', openEnd);
    if (close < 0) return;

    if (attributes.get('type')?.toLowerCase().includes(needle)) {
      yield html.slice(openEnd + 1, close);
    }
    from = close + 8;
  }
}
