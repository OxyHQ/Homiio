/**
 * The gateway's server-side cache.
 *
 * Server-side ONLY, deliberately (ADR 0002 §15): a per-device cache cannot be
 * invalidated, cannot be rate-limited, and multiplies the calls the OSM policy
 * counts against Homiio.
 *
 * Two rules here are load-bearing rather than tuning.
 *
 * **A key carries every dimension that changes the answer.** Language, country
 * restriction, requested types, limit and bias area are all in it, because a
 * key that omits one serves a Spanish caller a German label, or a caller who
 * asked for cities a list of street addresses. That is not a stale read — it is
 * a wrong one, and it is invisible because a plausible list comes back.
 *
 * **A transient failure is never cached.** A bounded negative cache holds
 * "the provider answered, and the answer was nothing" for a short while, which
 * is a genuine fact about the world. A timeout or a 429 is a fact about the
 * network, and caching it converts a blip into an outage that outlives it.
 */

/** Autocomplete moves with the index and with what people type; keep it short. */
const AUTOCOMPLETE_TTL_MS = 5 * 60 * 1000;

/**
 * A resolved candidate and a reverse lookup are stable facts about a
 * coordinate or an id. 24 h is the existing, ADR-sanctioned value.
 */
const RESOLVED_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * "No such place" for a query somebody typed. One minute: long enough to
 * absorb a user hammering the same misspelling, short enough that a provider
 * finishing an import is visible almost immediately.
 */
const NEGATIVE_TTL_MS = 60 * 1000;

const MAX_ENTRIES = 2000;

export const GEO_CACHE_TTL_MS = {
  autocomplete: AUTOCOMPLETE_TTL_MS,
  resolved: RESOLVED_TTL_MS,
  negative: NEGATIVE_TTL_MS,
} as const;

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();

/** Instrumentation for the privacy-safe metrics; carries no query text. */
let hits = 0;
let misses = 0;

export function geoCacheStats(): { hits: number; misses: number; size: number } {
  return { hits, misses, size: store.size };
}

export function resetGeoCache(): void {
  store.clear();
  hits = 0;
  misses = 0;
}

export function readGeoCache<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) {
    misses += 1;
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    misses += 1;
    return undefined;
  }
  // Refresh insertion order so the eviction below is least-recently-USED
  // rather than least-recently-written; a hot key must not be evicted by a
  // burst of one-off misspellings.
  store.delete(key);
  store.set(key, entry);
  hits += 1;
  return entry.value as T;
}

export function writeGeoCache<T>(key: string, value: T, ttlMs: number): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Fold a bias point onto a coarse grid before it reaches a key.
 *
 * 1 decimal place is ~11 km, which is the resolution at which a bias actually
 * changes the ranking. Two consequences, both wanted: a user's position is
 * blunted before it becomes any kind of stored string, and two people in the
 * same city share a cache entry instead of each minting their own.
 */
const BIAS_GRID_DECIMALS = 1;

/**
 * Normalise a typed query for keying: trim, collapse internal whitespace, and
 * case-fold.
 *
 * `toLocaleLowerCase()` without a locale argument would apply the SERVER's
 * locale, which is how a Turkish deployment turns "Istanbul" into a different
 * key than "ISTANBUL" folds to. `toLowerCase()` is locale-independent and is
 * what makes this key stable across deployments. Normalising to NFC first
 * means "Gràcia" typed with a combining accent and with a precomposed one are
 * one entry rather than two.
 */
export function normalizeQueryForKey(query: string): string {
  return query.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export interface AutocompleteKeyParts {
  readonly query: string;
  readonly language: string;
  readonly countryCode?: string;
  readonly types?: readonly string[];
  readonly limit: number;
  readonly near?: { readonly longitude: number; readonly latitude: number };
}

/**
 * The `v1:` prefix is a manual invalidation lever: changing the normalisation
 * or adding a dimension bumps it, rather than serving entries built under the
 * old rules until their TTL expires.
 */
export function autocompleteCacheKey(parts: AutocompleteKeyParts): string {
  const bias = parts.near
    ? `${parts.near.longitude.toFixed(BIAS_GRID_DECIMALS)},${parts.near.latitude.toFixed(BIAS_GRID_DECIMALS)}`
    : '*';
  const types = parts.types?.length ? [...parts.types].sort().join('+') : '*';
  return [
    'geo:v1:search',
    parts.language,
    parts.countryCode ?? '*',
    types,
    String(parts.limit),
    bias,
    normalizeQueryForKey(parts.query),
  ].join('|');
}

export function resolveCacheKey(providerId: string, ref: string, language: string): string {
  return ['geo:v1:resolve', language, providerId, ref].join('|');
}

/**
 * Grid for a reverse-geocode key: 4 dp is ~11 m, finer than any street address
 * needs and coarser than any building.
 *
 * It was 6 dp (~11 cm), and that was wrong twice over — both halves caught in
 * review of #390:
 *
 *  - **Privacy.** The cache's KEYS then held building-precision positions —
 *    every point anyone reverse-geocoded, retained for the TTL, visible to a
 *    heap dump or to whatever backs this store next. ADR 0002 §8.1's whole
 *    argument is that degrading on the way IN is what makes a value unable to
 *    leak later, from a log, a backup or an endpoint that does not exist yet.
 *    Forty lines above, {@link BIAS_GRID_DECIMALS} states exactly that
 *    principle for the bias point; the two are now consistent.
 *  - **It barely functioned as a cache.** At 11 cm, two drags of the same map
 *    pin essentially never share a key, so the hit rate approached zero for the
 *    one case it exists to serve — which made the OSM rate-limit protection it
 *    appeared to provide largely illusory. Worse, a test asserting a hit on a
 *    repeated IDENTICAL call passes under either precision, so the suite could
 *    not tell the difference; the test now re-queries a nearby point instead.
 *
 * 11 m cannot resolve two neighbouring buildings, which is the property that
 * makes it safe. It is far short of the ~110 m at which a reverse geocode would
 * start naming the wrong street.
 */
const REVERSE_GRID_DECIMALS = 4;

/**
 * The key for "what is at this coordinate".
 *
 * ADR 0002 §15 sanctions a 24 h server-side reverse cache explicitly; §8.2 is
 * the rule it must not break (no exact coordinate in a URL, a query key, an
 * analytics event, a log line or a persisted store). Gridding the coordinate
 * before it becomes a string satisfies §8.2 structurally rather than by
 * argument about where the map happens to live today.
 */
export function reverseCacheKey(
  longitude: number,
  latitude: number,
  language: string,
): string {
  const gridded = `${longitude.toFixed(REVERSE_GRID_DECIMALS)},${latitude.toFixed(REVERSE_GRID_DECIMALS)}`;
  return ['geo:v1:reverse', language, gridded].join('|');
}
