/**
 * The Nominatim adapter: what it builds from a provider payload, and how it
 * classifies every way a provider can fail.
 *
 * The failure half matters more than it looks. The gateway decides whether to
 * try a second provider, whether to tell the client to retry, and whether to
 * surface a recoverable error rather than an empty list — and all three
 * decisions are made from the `reason` this adapter assigns. A misclassified
 * 429 becomes "no such place", which is the single bug this whole gateway
 * exists to prevent.
 *
 * `fetch` is stubbed with REAL `Response` objects rather than hand-rolled
 * look-alikes, following `__tests__/unit/residentialProxy.test.ts`: a stand-in
 * diverges from the real thing in ways nothing catches (a `headers.get()` that
 * always returns null would silently disable the `Retry-After` handling below).
 */

import config from '../../config';
import {
  createNominatimProvider,
  NOMINATIM_PROVIDER_ID,
  resetNominatimRateLimiter,
} from '../../services/geocoding/nominatimProvider';
import { GeocodingProviderError } from '../../services/geocoding/types';

const originalFetch = global.fetch;
const originalMinInterval = config.geocoding.minIntervalMs;

/** Barcelona, as `format=jsonv2&addressdetails=1` returns it. */
const BARCELONA = {
  osm_type: 'relation',
  osm_id: 349036,
  place_id: 999,
  name: 'Barcelona',
  lat: '41.3828939',
  lon: '2.1774322',
  display_name: 'Barcelona, Barcelonès, Barcelona, Catalunya, España',
  class: 'boundary',
  type: 'administrative',
  addresstype: 'city',
  // Nominatim order: [south, north, west, east].
  boundingbox: ['41.3170353', '41.4679135', '2.0524977', '2.2283555'],
  address: {
    city: 'Barcelona',
    state: 'Catalunya',
    'ISO3166-2-lvl4': 'ES-CT',
    country: 'España',
    country_code: 'es',
    postcode: '08001',
  },
};

type FetchArgs = { url: string; headers: Record<string, string> };

/** Stub `fetch`, recording what it was called with. */
function stubFetch(responder: (url: string) => Response | Promise<Response>): FetchArgs[] {
  const calls: FetchArgs[] = [];
  (global as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    return responder(url);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

beforeEach(() => {
  resetNominatimRateLimiter();
  // The 1 s OSM policy interval is correct in production and would add a
  // second to every case here. The queue itself is exercised in its own test.
  config.geocoding.minIntervalMs = 0;
});

afterEach(() => {
  (global as { fetch: typeof originalFetch }).fetch = originalFetch;
  config.geocoding.minIntervalMs = originalMinInterval;
});

describe('nominatim adapter — building a provider place', () => {
  it('maps a city onto the provider-neutral shape', async () => {
    stubFetch(() => json([BARCELONA]));
    const [place] = await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'es',
      limit: 5,
    });

    expect(place.providerId).toBe(NOMINATIM_PROVIDER_ID);
    expect(place.name).toBe('Barcelona');
    expect(place.center).toEqual({ longitude: 2.1774322, latitude: 41.3828939 });
    expect(place.address).toMatchObject({
      city: 'Barcelona',
      region: 'Catalunya',
      regionCode: 'ES-CT',
      country: 'España',
      countryCode: 'ES',
      postalCode: '08001',
    });
    // Uninterpreted: the place TYPE is normalisation's job, not the adapter's.
    expect(place.rawClass).toBe('boundary');
    expect(place.rawAddressType).toBe('city');
  });

  it('derives a stable ref from osm_type + osm_id, never from place_id', async () => {
    stubFetch(() => json([BARCELONA]));
    const [place] = await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'es',
      limit: 5,
    });

    // `place_id` is a row number that changes on every reimport, so a `loc`
    // token built from it would resolve to a different place after one.
    expect(place.ref).toBe('R349036');
    expect(place.ref).not.toContain(String(BARCELONA.place_id));
  });

  it('converts the bounding box out of Nominatim order into west/south/east/north', async () => {
    stubFetch(() => json([BARCELONA]));
    const [place] = await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'es',
      limit: 5,
    });

    // The source array is [south, north, west, east]. Reading it positionally
    // yields a box in the Indian Ocean, and the numbers still look plausible.
    expect(place.bounds).toEqual({
      west: 2.0524977,
      south: 41.3170353,
      east: 2.2283555,
      north: 41.4679135,
    });
  });

  it('keeps a non-Latin name verbatim', async () => {
    // ADR 0002 §9.4: no re-casing, no transliteration. A label that arrives in
    // Japanese must leave in Japanese.
    stubFetch(() =>
      json([
        {
          ...BARCELONA,
          osm_id: 1,
          name: '千代田区',
          display_name: '千代田区, 東京都, 日本',
          address: { city: '千代田区', state: '東京都', country: '日本', country_code: 'jp' },
        },
      ]),
    );
    const [place] = await createNominatimProvider().autocomplete({
      query: '千代田',
      language: 'ja',
      limit: 5,
    });

    expect(place.name).toBe('千代田区');
    expect(place.address.countryCode).toBe('JP');
  });

  it('keeps diacritics rather than folding them', async () => {
    stubFetch(() =>
      json([
        {
          ...BARCELONA,
          osm_id: 2,
          name: 'Gràcia',
          display_name: 'Gràcia, Barcelona, Catalunya, España',
        },
      ]),
    );
    const [place] = await createNominatimProvider().autocomplete({
      query: 'Gracia',
      language: 'ca',
      limit: 5,
    });

    expect(place.name).toBe('Gràcia');
  });

  it('discards a bounding box whose south exceeds its north', async () => {
    // `types.ts` declares that ordering an error. Passing it on would put an
    // unsatisfiable rectangle into a search query, which returns zero results
    // and looks like "nothing here".
    stubFetch(() =>
      json([{ ...BARCELONA, boundingbox: ['41.9', '41.1', '2.05', '2.22'] }]),
    );
    const [place] = await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'es',
      limit: 5,
    });

    expect(place.bounds).toBeUndefined();
  });

  it('keeps a bounding box whose west exceeds its east', async () => {
    // LEGAL: that is the antimeridian-crossing box (ADR 0002 §9.3), and
    // "tidying it up" inverts every such query into its complement.
    stubFetch(() =>
      json([{ ...BARCELONA, boundingbox: ['-20', '-16', '170', '-170'] }]),
    );
    const [place] = await createNominatimProvider().autocomplete({
      query: 'Fiji',
      language: 'en',
      limit: 5,
    });

    expect(place.bounds).toEqual({ west: 170, south: -20, east: -170, north: -16 });
  });

  it('drops a result with no usable coordinate or ref rather than inventing one', async () => {
    stubFetch(() =>
      json([
        { ...BARCELONA, osm_id: undefined, osm_type: undefined },
        { ...BARCELONA, osm_id: 3, lat: 'not-a-number' },
        BARCELONA,
      ]),
    );
    const places = await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'es',
      limit: 5,
    });

    expect(places).toHaveLength(1);
    expect(places[0].ref).toBe('R349036');
  });
});

describe('nominatim adapter — request construction', () => {
  it('sends the identifying User-Agent the OSM policy requires', async () => {
    const calls = stubFetch(() => json([BARCELONA]));
    await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'ca',
      limit: 5,
    });

    // A browser refuses to let JavaScript set this header at all, which is one
    // concrete reason the client cannot be the one calling.
    expect(calls[0].headers['User-Agent']).toBe(config.geocoding.userAgent);
    expect(calls[0].headers['Accept-Language']).toBe('ca');
  });

  it('biases towards `near` WITHOUT filtering to it', async () => {
    const calls = stubFetch(() => json([BARCELONA]));
    await createNominatimProvider().autocomplete({
      query: 'Barcelona',
      language: 'en',
      limit: 5,
      near: { longitude: 2.17, latitude: 41.38 },
    });

    const url = new URL(calls[0].url);
    expect(url.searchParams.get('viewbox')).toBeTruthy();
    // `bounded=1` is what turns a bias into a filter, and it would drop a valid
    // result from another country that the user explicitly asked for. Its
    // ABSENCE is the assertion — the issue names this as a required test.
    expect(url.searchParams.get('bounded')).toBeNull();
  });

  it('restricts by country only when asked', async () => {
    const calls = stubFetch(() => json([BARCELONA]));
    const provider = createNominatimProvider();
    await provider.autocomplete({ query: 'Barcelona', language: 'en', limit: 5 });
    await provider.autocomplete({
      query: 'Barcelona',
      language: 'en',
      limit: 5,
      countryCode: 'VE',
    });

    expect(new URL(calls[0].url).searchParams.get('countrycodes')).toBeNull();
    expect(new URL(calls[1].url).searchParams.get('countrycodes')).toBe('ve');
  });

  it('refuses a ref it could never have minted without calling the network', async () => {
    const calls = stubFetch(() => json([BARCELONA]));
    await expect(
      createNominatimProvider().resolve({ ref: '../../etc/passwd', language: 'en' }),
    ).rejects.toMatchObject({ reason: 'invalid_request' });

    expect(calls).toHaveLength(0);
  });
});

describe('nominatim adapter — failure classification', () => {
  const provider = () => createNominatimProvider();
  const search = () =>
    provider().autocomplete({ query: 'Barcelona', language: 'en', limit: 5 });

  it('classifies 429 as rate_limited and carries Retry-After', async () => {
    stubFetch(() => new Response('slow down', { status: 429, headers: { 'retry-after': '42' } }));

    await expect(search()).rejects.toMatchObject({
      reason: 'rate_limited',
      retryAfterSeconds: 42,
    });
  });

  it('classifies 5xx as provider_unavailable', async () => {
    stubFetch(() => new Response('boom', { status: 503 }));
    await expect(search()).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('classifies a 400 as invalid_request, which must NOT trigger a fallback', async () => {
    stubFetch(() => new Response('bad', { status: 400 }));
    const error = await search().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GeocodingProviderError);
    expect((error as GeocodingProviderError).reason).toBe('invalid_request');
    expect((error as GeocodingProviderError).isRecoverable).toBe(false);
  });

  it('classifies unparseable JSON as invalid_response', async () => {
    stubFetch(() => new Response('<html>not json</html>', { status: 200 }));
    await expect(search()).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('classifies a JSON body of the wrong SHAPE as invalid_response', async () => {
    // Valid JSON, wrong type. Without this the `.map` below would throw a raw
    // TypeError and escape the gateway's classification entirely.
    stubFetch(() => json({ error: 'Unable to geocode' }));
    await expect(search()).rejects.toMatchObject({ reason: 'invalid_response' });
  });

  it('classifies an aborted request as a timeout', async () => {
    stubFetch(() => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      return Promise.reject(error);
    });
    await expect(search()).rejects.toMatchObject({ reason: 'timeout' });
  });

  it('classifies a network failure as provider_unavailable', async () => {
    stubFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(search()).rejects.toMatchObject({ reason: 'provider_unavailable' });
  });

  it('reports an empty result as an empty list, never as a failure', async () => {
    // The distinction the entire gateway rests on: "there is no such place" is
    // an ANSWER. Only a healthy provider is allowed to make that claim.
    stubFetch(() => json([]));
    await expect(search()).resolves.toEqual([]);
  });

  it('reads Nominatim’s 200-with-an-error-body reverse reply as "no result"', async () => {
    stubFetch(() => json({ error: 'Unable to geocode' }));
    await expect(
      provider().reverse({ point: { longitude: 0, latitude: 0 }, language: 'en' }),
    ).resolves.toBeNull();
  });

  it('reverse-geocodes a valid coordinate', async () => {
    stubFetch(() => json(BARCELONA));
    const place = await provider().reverse({
      point: { longitude: 2.1774322, latitude: 41.3828939 },
      language: 'es',
    });

    expect(place?.ref).toBe('R349036');
    expect(place?.address.city).toBe('Barcelona');
  });
});

describe('nominatim adapter — the OSM policy queue', () => {
  it('spaces request STARTS by the configured interval', async () => {
    config.geocoding.minIntervalMs = 60;
    stubFetch(() => json([BARCELONA]));
    const provider = createNominatimProvider();

    const startedAt = Date.now();
    await Promise.all([
      provider.autocomplete({ query: 'one', language: 'en', limit: 1 }),
      provider.autocomplete({ query: 'two', language: 'en', limit: 1 }),
      provider.autocomplete({ query: 'three', language: 'en', limit: 1 }),
    ]);
    const elapsed = Date.now() - startedAt;

    // Three calls at 60 ms spacing: the second waits 60, the third 120. Asserted
    // with slack below the true figure so a loaded machine cannot flake it, but
    // high enough that removing the queue entirely (elapsed ≈ 0) fails.
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('does not wedge the queue when one call fails', async () => {
    config.geocoding.minIntervalMs = 5;
    let call = 0;
    stubFetch(() => {
      call += 1;
      return call === 1
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve(json([BARCELONA]));
    });
    const provider = createNominatimProvider();

    await expect(
      provider.autocomplete({ query: 'one', language: 'en', limit: 1 }),
    ).rejects.toBeInstanceOf(GeocodingProviderError);
    // If the failed slot poisoned the chain this would never settle.
    await expect(
      provider.autocomplete({ query: 'two', language: 'en', limit: 1 }),
    ).resolves.toHaveLength(1);
  });
});
