/**
 * Shared Next.js `__NEXT_DATA__` / `__PRELOADED_STATE__` extraction.
 *
 * Many portals (Storia, Fotocasa, Zoopla, Subito, Immobiliare.it, …) embed the
 * listing/search payload in a `<script id="__NEXT_DATA__">` JSON blob. Navent
 * portals (Plusvalía, Zonaprop, …) often use `window.__PRELOADED_STATE__`.
 * Parse HERE once — providers must not re-declare the regex.
 */

const NEXT_DATA_RE = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i;
const PRELOADED_STATE_RE =
  /(?:window\.)?__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:<\/script>|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the `__NEXT_DATA__` script body from HTML, or undefined when absent/malformed. */
export function parseNextData(html: string): Record<string, unknown> | undefined {
  const match = NEXT_DATA_RE.exec(html);
  const body = match?.[1]?.trim();
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Alias used by Fotocasa / older call sites. */
export const extractNextData = parseNextData;

/** Parse `window.__PRELOADED_STATE__ = {…}` (Navent / MercadoLibre-style). */
export function parsePreloadedState(html: string): Record<string, unknown> | undefined {
  const match = PRELOADED_STATE_RE.exec(html);
  const body = match?.[1]?.trim();
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** `props.pageProps` from a Next.js data blob, when present. */
export function nextDataPageProps(
  nextData: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!nextData) return undefined;
  const props = nextData.props;
  if (!isRecord(props)) return undefined;
  const page = props.pageProps;
  return isRecord(page) ? page : undefined;
}

/**
 * Parse HTML → pageProps in one step. Prefer this in providers that only need
 * the page payload (Storia detail/search, Fotocasa fallback, …).
 */
export function parseNextDataPageProps(html: string): Record<string, unknown> | undefined {
  return nextDataPageProps(parseNextData(html));
}

/**
 * Depth-first search for the first array whose items match `isItem`
 * (e.g. Leboncoin `ads`, Storia search hits). Caps depth to avoid cycles.
 */
export function findNextDataArray(
  root: unknown,
  isItem: (value: unknown) => boolean,
  maxDepth = 8,
): unknown[] | undefined {
  const walk = (value: unknown, depth: number): unknown[] | undefined => {
    if (depth > maxDepth || value === null || value === undefined) return undefined;
    if (Array.isArray(value)) {
      if (value.length > 0 && isItem(value[0])) return value;
      for (const entry of value) {
        const found = walk(entry, depth + 1);
        if (found) return found;
      }
      return undefined;
    }
    if (typeof value === 'object') {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.ads) && record.ads.length > 0 && isItem(record.ads[0])) {
        return record.ads;
      }
      for (const child of Object.values(record)) {
        const found = walk(child, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(root, 0);
}

/** Depth-first search for the first record matching `isItem`. */
export function findNextDataRecord(
  root: unknown,
  isItem: (value: unknown) => value is Record<string, unknown>,
  maxDepth = 8,
): Record<string, unknown> | undefined {
  const walk = (value: unknown, depth: number): Record<string, unknown> | undefined => {
    if (depth > maxDepth || value === null || value === undefined) return undefined;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (isItem(record)) return record;
      for (const child of Object.values(record)) {
        const found = walk(child, depth + 1);
        if (found) return found;
      }
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = walk(entry, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(root, 0);
}
