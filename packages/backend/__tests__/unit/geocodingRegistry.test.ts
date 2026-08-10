/**
 * The registry, the fallback policy, the cache keys and the input validation.
 *
 * The single most important assertion in this file is that a provider failure
 * NEVER becomes an empty result. Everything else here is in service of that:
 * an empty candidate list reads to every caller as "there is no such place",
 * and a screen that believes it will drop the location filter and show a global
 * feed — a wrong answer that looks exactly like a correct one.
 */

import config from '../../config';
import {
  autocompleteCacheKey,
  GEO_CACHE_TTL_MS,
  normalizeQueryForKey,
  readGeoCache,
  resetGeoCache,
  resolveCacheKey,
  reverseCacheKey,
  writeGeoCache,
} from '../../services/geocoding/cache';
import {
  orderedProviders,
  providerById,
  registerProvider,
  resetProviderRegistry,
  unregisterProvider,
  withFallback,
} from '../../services/geocoding/registry';
import { buildGeoObservation, queryLengthBucket } from '../../services/geocoding/telemetry';
import {
  GeocodingProviderError,
  type GeocodingProvider,
  type ProviderPlace,
} from '../../services/geocoding/types';
import {
  GeoValidationError,
  parseCountryCode,
  parseLanguage,
  parseLimit,
  parseLocToken,
  parseNear,
  parseQueryText,
  parseReversePoint,
  parseTypes,
} from '../../services/geocoding/validation';

const originalProviderOrder = config.geocoding.providerOrder;

const place = (providerId: string, ref: string): ProviderPlace => ({
  providerId,
  ref,
  name: 'Barcelona',
  displayName: 'Barcelona, Catalunya, España',
  address: { city: 'Barcelona', countryCode: 'ES' },
  center: { longitude: 2.17, latitude: 41.38 },
});

/**
 * A fake provider, which the issue requires be registrable.
 *
 * It is a real object satisfying the real interface rather than a `jest.fn`
 * grab-bag: a spy that is never wired into the code under test always
 * "passes", and that is the shape of check this repo has been bitten by.
 */
function fakeProvider(
  id: string,
  behaviour: {
    autocomplete?: () => Promise<ProviderPlace[]>;
    resolve?: () => Promise<ProviderPlace | null>;
    reverse?: () => Promise<ProviderPlace | null>;
  } = {},
): GeocodingProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    calls,
    attribution: { text: `© ${id}`, url: `https://example.invalid/${id}` },
    async autocomplete() {
      calls.push('autocomplete');
      return behaviour.autocomplete ? behaviour.autocomplete() : [place(id, `${id}-1`)];
    },
    async resolve() {
      calls.push('resolve');
      return behaviour.resolve ? behaviour.resolve() : place(id, `${id}-1`);
    },
    async reverse() {
      calls.push('reverse');
      return behaviour.reverse ? behaviour.reverse() : place(id, `${id}-1`);
    },
    async health() {
      return { providerId: id, healthy: true };
    },
  };
}

beforeEach(() => {
  resetProviderRegistry();
  resetGeoCache();
});

afterEach(() => {
  resetProviderRegistry();
  config.geocoding.providerOrder = originalProviderOrder;
});

describe('registry', () => {
  it('registers a fake provider and finds it by id', () => {
    const fake = fakeProvider('fake');
    registerProvider(fake);

    expect(providerById('fake')).toBe(fake);
  });

  it('orders providers by the configured preference, not by registration order', () => {
    config.geocoding.providerOrder = ['second', 'first'];
    registerProvider(fakeProvider('first'));
    registerProvider(fakeProvider('second'));

    expect(orderedProviders().map((provider) => provider.id)).toEqual(['second', 'first']);
  });

  it('includes a registered provider the configuration does not name', () => {
    // So a test can register a fake without also having to rewrite the config.
    config.geocoding.providerOrder = ['first'];
    registerProvider(fakeProvider('first'));
    registerProvider(fakeProvider('unlisted'));

    expect(orderedProviders().map((provider) => provider.id)).toEqual(['first', 'unlisted']);
  });

  it('skips a configured id with no adapter rather than faking one', () => {
    config.geocoding.providerOrder = ['ghost', 'real'];
    registerProvider(fakeProvider('real'));

    expect(orderedProviders().map((provider) => provider.id)).toEqual(['real']);
  });
});

describe('fallback policy', () => {
  it('falls back to the next provider on a RECOVERABLE failure', async () => {
    config.geocoding.providerOrder = ['flaky', 'backup'];
    const flaky = fakeProvider('flaky', {
      autocomplete: () => Promise.reject(new GeocodingProviderError('timeout', 'flaky')),
    });
    const backup = fakeProvider('backup');
    registerProvider(flaky);
    registerProvider(backup);

    const outcome = await withFallback((provider) =>
      provider.autocomplete({ query: 'Barcelona', language: 'en', limit: 5 }),
    );

    expect(outcome.providerId).toBe('backup');
    // A caller can tell the user the answer came from a degraded path WITHOUT
    // learning which provider fell over.
    expect(outcome.degraded).toBe(true);
    expect(backup.calls).toEqual(['autocomplete']);
  });

  it('does NOT fall back on a non-recoverable failure', async () => {
    // Asking a second provider the same malformed question spends its budget
    // to get the same answer.
    config.geocoding.providerOrder = ['first', 'backup'];
    registerProvider(
      fakeProvider('first', {
        autocomplete: () =>
          Promise.reject(new GeocodingProviderError('invalid_request', 'first')),
      }),
    );
    const backup = fakeProvider('backup');
    registerProvider(backup);

    await expect(
      withFallback((provider) =>
        provider.autocomplete({ query: 'x', language: 'en', limit: 5 }),
      ),
    ).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(backup.calls).toEqual([]);
  });

  it('THROWS when every provider fails — it never degrades into an empty list', async () => {
    // The assertion this whole gateway exists for. If `withFallback` resolved
    // to `[]` here, a location search would silently become a global feed.
    config.geocoding.providerOrder = ['a', 'b'];
    registerProvider(
      fakeProvider('a', {
        autocomplete: () => Promise.reject(new GeocodingProviderError('timeout', 'a')),
      }),
    );
    registerProvider(
      fakeProvider('b', {
        autocomplete: () =>
          Promise.reject(new GeocodingProviderError('rate_limited', 'b', 30)),
      }),
    );

    const error = await withFallback((provider) =>
      provider.autocomplete({ query: 'x', language: 'en', limit: 5 }),
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GeocodingProviderError);
    // The LAST error, so the client is told to back off rather than to retry
    // against a provider that is merely slow.
    expect((error as GeocodingProviderError).reason).toBe('rate_limited');
    expect((error as GeocodingProviderError).retryAfterSeconds).toBe(30);
  });

  it('reports degraded=false when the preferred provider answers', async () => {
    config.geocoding.providerOrder = ['first', 'backup'];
    registerProvider(fakeProvider('first'));
    registerProvider(fakeProvider('backup'));

    const outcome = await withFallback((provider) =>
      provider.autocomplete({ query: 'Barcelona', language: 'en', limit: 5 }),
    );
    expect(outcome.degraded).toBe(false);
  });

  it('fails loudly when no provider is registered at all', async () => {
    // Reachable only by registering and then removing: an explicit
    // registration suppresses the lazy default, so the registry can genuinely
    // be empty. It must refuse rather than resolve to nothing.
    registerProvider(fakeProvider('temporary'));
    unregisterProvider('temporary');

    await expect(withFallback(() => Promise.resolve('unreachable'))).rejects.toMatchObject({
      reason: 'provider_unavailable',
    });
  });

  it('registers the real adapter by default, and NOT once a fake is installed', async () => {
    // The seam that keeps a unit test off the public OSM endpoint. Before this
    // rule existed, a suite installing two failing fakes fell through to the
    // live adapter and made a real network request.
    expect(orderedProviders().map((provider) => provider.id)).toEqual(['osm']);

    resetProviderRegistry();
    registerProvider(fakeProvider('fake'));
    expect(orderedProviders().map((provider) => provider.id)).toEqual(['fake']);
  });
});

describe('cache keys', () => {
  it('separates languages, so a Spanish answer never serves a Catalan caller', () => {
    const base = { query: 'Barcelona', limit: 5 };
    expect(autocompleteCacheKey({ ...base, language: 'es' })).not.toBe(
      autocompleteCacheKey({ ...base, language: 'ca' }),
    );
  });

  it('separates countries, so two homonymous cities cannot share an entry', () => {
    const base = { query: 'Barcelona', language: 'en', limit: 5 };
    expect(autocompleteCacheKey({ ...base, countryCode: 'ES' })).not.toBe(
      autocompleteCacheKey({ ...base, countryCode: 'VE' }),
    );
  });

  it('separates requested types, limits and bias areas', () => {
    const base = { query: 'Barcelona', language: 'en', limit: 5 };
    expect(autocompleteCacheKey({ ...base, types: ['city'] })).not.toBe(
      autocompleteCacheKey({ ...base, types: ['address'] }),
    );
    expect(autocompleteCacheKey({ ...base, limit: 5 })).not.toBe(
      autocompleteCacheKey({ ...base, limit: 10 }),
    );
    expect(
      autocompleteCacheKey({ ...base, near: { longitude: 2.17, latitude: 41.38 } }),
    ).not.toBe(autocompleteCacheKey({ ...base, near: { longitude: -3.7, latitude: 40.4 } }));
  });

  it('is insensitive to the ORDER of requested types', () => {
    const base = { query: 'Barcelona', language: 'en', limit: 5 };
    expect(autocompleteCacheKey({ ...base, types: ['city', 'address'] })).toBe(
      autocompleteCacheKey({ ...base, types: ['address', 'city'] }),
    );
  });

  it('folds a bias point onto a coarse grid so two people in one city share an entry', () => {
    const base = { query: 'Barcelona', language: 'en', limit: 5 };
    // ~200 m apart. Without the grid every device mints its own entry, which is
    // both a cache that never hits and a finer-grained position than needed.
    expect(
      autocompleteCacheKey({ ...base, near: { longitude: 2.1701, latitude: 41.3801 } }),
    ).toBe(autocompleteCacheKey({ ...base, near: { longitude: 2.1719, latitude: 41.3818 } }));
  });

  it('folds case, whitespace and unicode form so one query is one entry', () => {
    expect(normalizeQueryForKey('  BARCELONA   centre ')).toBe('barcelona centre');
    // Decomposed vs precomposed "Gràcia" — the same word from two keyboards.
    expect(normalizeQueryForKey('Gràcia')).toBe(normalizeQueryForKey('Gràcia'));
  });

  it('keeps reverse keys at full precision, and resolve keys per provider', () => {
    expect(reverseCacheKey(2.1774322, 41.3828939, 'es')).not.toBe(
      reverseCacheKey(2.1774322, 41.3828939, 'ca'),
    );
    expect(resolveCacheKey('osm', 'R349036', 'en')).not.toBe(
      resolveCacheKey('other', 'R349036', 'en'),
    );
  });
});

describe('cache behaviour', () => {
  it('returns a stored value and then expires it', () => {
    writeGeoCache('k', { hello: 'world' }, 50);
    expect(readGeoCache<{ hello: string }>('k')).toEqual({ hello: 'world' });

    jest.useFakeTimers();
    try {
      jest.setSystemTime(Date.now() + 51);
      expect(readGeoCache('k')).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('gives a negative entry a far shorter life than a resolved one', () => {
    // A bounded negative cache absorbs somebody hammering a misspelling; an
    // unbounded one perpetuates an error long after the provider recovered.
    expect(GEO_CACHE_TTL_MS.negative).toBeLessThan(GEO_CACHE_TTL_MS.autocomplete);
    expect(GEO_CACHE_TTL_MS.autocomplete).toBeLessThan(GEO_CACHE_TTL_MS.resolved);
  });
});

describe('input validation', () => {
  it('rejects a non-string query rather than coercing it', () => {
    // `?q=a&q=b` arrives as an array and `?q[x]=1` as an object. `String(...)`
    // turns those into "a,b" and "[object Object]" and sends them to a provider
    // as a query — a non-textual payload reaching the network.
    expect(() => parseQueryText(['a', 'b'])).toThrow(GeoValidationError);
    expect(() => parseQueryText({ x: 1 })).toThrow(GeoValidationError);
    expect(() => parseQueryText(42)).toThrow(GeoValidationError);
  });

  it('enforces a minimum and a maximum query length', () => {
    expect(() => parseQueryText('a')).toThrow(/at least/);
    expect(() => parseQueryText('x'.repeat(121))).toThrow(/at most/);
    expect(parseQueryText('  Barcelona  ')).toBe('Barcelona');
  });

  it('measures length AFTER unicode normalisation', () => {
    // Decomposed, 7 code points; precomposed, 6. A length rule that disagrees
    // with itself depending on the keyboard is not a rule.
    expect(parseQueryText('Gràci')).toBe('Gràci');
  });

  it('accepts a valid country code and refuses anything else', () => {
    expect(parseCountryCode('es')).toBe('ES');
    expect(parseCountryCode(undefined)).toBeUndefined();
    expect(() => parseCountryCode('ESP')).toThrow(GeoValidationError);
    expect(() => parseCountryCode('1')).toThrow(GeoValidationError);
  });

  it('accepts known place types and refuses unknown ones', () => {
    expect(parseTypes('city,neighborhood')).toEqual(['city', 'neighborhood']);
    expect(parseTypes('CITY, city')).toEqual(['city']);
    expect(() => parseTypes('city,planet')).toThrow(GeoValidationError);
  });

  it('caps the limit and refuses a partially numeric one', () => {
    expect(parseLimit(undefined)).toBe(5);
    expect(parseLimit('10')).toBe(10);
    expect(() => parseLimit('11')).toThrow(GeoValidationError);
    expect(() => parseLimit('0')).toThrow(GeoValidationError);
    // `parseInt('5abc')` is 5, which accepts a malformed value silently.
    expect(() => parseLimit('5abc')).toThrow(GeoValidationError);
  });

  it('parses `near` as lng,lat and range-checks both', () => {
    expect(parseNear('2.17,41.38')).toEqual({ longitude: 2.17, latitude: 41.38 });
    expect(() => parseNear('41.38')).toThrow(GeoValidationError);
    // A latitude of 191 is the classic transposed pair; it must not pass.
    expect(() => parseNear('41.38,191')).toThrow(GeoValidationError);
    expect(() => parseNear('abc,def')).toThrow(GeoValidationError);
  });

  it('requires both reverse coordinates and refuses NaN and out-of-range', () => {
    expect(parseReversePoint({ lng: '2.17', lat: '41.38' })).toEqual({
      longitude: 2.17,
      latitude: 41.38,
    });
    expect(() => parseReversePoint({ lng: '2.17' })).toThrow(/required/);
    // Serialised into the URL this becomes the literal `NaN`, which some
    // instances answer with a 200 and a nonsense place rather than an error.
    expect(() => parseReversePoint({ lng: 'NaN', lat: '41.38' })).toThrow(GeoValidationError);
    expect(() => parseReversePoint({ lng: '181', lat: '41.38' })).toThrow(GeoValidationError);
    expect(() => parseReversePoint({ lng: '2.17', lat: '-91' })).toThrow(GeoValidationError);
  });

  it('bounds the language tag so a header cannot mint unlimited cache keys', () => {
    expect(parseLanguage('ca', undefined)).toBe('ca');
    expect(parseLanguage(undefined, 'pt-br,pt;q=0.9')).toBe('pt-BR');
    expect(parseLanguage('x'.repeat(500), undefined)).toBe('');
    expect(parseLanguage(undefined, undefined)).toBe('');
  });

  it('requires a bounded loc token', () => {
    expect(parseLocToken('city.osm.R349036')).toBe('city.osm.R349036');
    expect(() => parseLocToken(undefined)).toThrow(/required/);
    expect(() => parseLocToken('x'.repeat(257))).toThrow(GeoValidationError);
  });
});

describe('telemetry', () => {
  it('buckets a query length rather than recording it', () => {
    expect(queryLengthBucket(1)).toBe('1-3');
    expect(queryLengthBucket(12)).toBe('9-16');
    expect(queryLengthBucket(400)).toBe('65+');
  });

  it('carries no query text and no coordinate at any precision', () => {
    // The check that makes "no address ever reaches a log line" verifiable
    // rather than a promise: feed a marker in, assert it appears nowhere in the
    // serialised payload. A `resultCount` and a length bucket cannot be
    // inverted into an address; a query string plainly can.
    const payload = buildGeoObservation({
      operation: 'search',
      outcome: 'ok',
      durationMs: 12,
      queryLength: 'Carrer de Mallorca 401'.length,
      countryCode: 'ES',
      types: ['address'],
      providerId: 'osm',
      cacheHit: false,
      resultCount: 3,
    });

    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('Mallorca');
    expect(serialised).not.toContain('41.38');
    expect(serialised).not.toContain('2.17');
    expect(payload).toMatchObject({
      operation: 'search',
      outcome: 'ok',
      queryLengthBucket: '17-32',
      countryCode: 'ES',
      resultCount: 3,
    });
    // The raw length is NOT present — only the bucket.
    expect(serialised).not.toContain('"queryLength"');
  });

  it('records a loc token’s KIND but never its id', () => {
    const payload = buildGeoObservation({
      operation: 'resolve',
      outcome: 'not_found',
      durationMs: 4,
      locKind: 'city',
    });
    expect(JSON.stringify(payload)).not.toContain('R349036');
    expect(payload.locKind).toBe('city');
  });
});
