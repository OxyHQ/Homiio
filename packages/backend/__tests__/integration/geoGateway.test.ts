/**
 * `/api/geo/*` over the real router, a fake provider and real Postgres.
 *
 * The provider is a registered FAKE rather than a mocked module, which is the
 * seam the issue asks for and is a stronger test than a `jest.mock`: the
 * request goes through the real registry, the real fallback policy, the real
 * cache and the real normaliser, so anything wired up wrongly between them
 * fails here rather than in production.
 *
 * ## The assertion this file exists for
 *
 * Every provider failure must reach the client AS A FAILURE. A timeout, a 429
 * and a 5xx each get their own status, and none of them answers `200` with an
 * empty `candidates` array — because a screen that reads an empty list as
 * "nowhere matched" drops the location filter and shows a global feed, which is
 * a wrong answer wearing the costume of a right one.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import publicRoutes from '../../routes/public';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoCache } from '../../services/geocoding/cache';
import {
  registerProvider,
  resetProviderRegistry,
} from '../../services/geocoding/registry';
import {
  GeocodingProviderError,
  type GeocodingProvider,
  type ProviderPlace,
} from '../../services/geocoding/types';
import {
  resetGeoTables,
  seedGeoChain,
  seedNeighborhood,
} from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

const app = buildApp();

interface FakeBehaviour {
  autocomplete?: (query: string, language: string) => Promise<ProviderPlace[]>;
  resolve?: (ref: string) => Promise<ProviderPlace | null>;
  reverse?: () => Promise<ProviderPlace | null>;
}

const PROVIDER_ID = 'fakeosm';

function installFake(behaviour: FakeBehaviour = {}): void {
  const provider: GeocodingProvider = {
    id: PROVIDER_ID,
    attribution: { text: '© Fake contributors', url: 'https://example.invalid/copyright' },
    autocomplete: async (input) =>
      behaviour.autocomplete
        ? behaviour.autocomplete(input.query, input.language)
        : [barcelona()],
    resolve: async (input) => (behaviour.resolve ? behaviour.resolve(input.ref) : barcelona()),
    reverse: async () => (behaviour.reverse ? behaviour.reverse() : barcelona()),
    health: async () => ({ providerId: PROVIDER_ID, healthy: true }),
  };
  registerProvider(provider);
}

function place(overrides: Partial<ProviderPlace> = {}): ProviderPlace {
  return {
    providerId: PROVIDER_ID,
    ref: 'R349036',
    name: 'Barcelona',
    displayName: 'Barcelona, Catalunya, España',
    address: {
      city: 'Barcelona',
      region: 'Catalunya',
      country: 'España',
      countryCode: 'ES',
    },
    center: { longitude: 2.1774322, latitude: 41.3828939 },
    bounds: { west: 2.05, south: 41.31, east: 2.23, north: 41.47 },
    rawAddressType: 'city',
    ...overrides,
  };
}

const barcelona = () => place();

beforeEach(async () => {
  resetProviderRegistry();
  resetGeoCache();
  installFake();
  await resetGeoTables();
});

afterEach(() => {
  resetProviderRegistry();
  resetGeoCache();
});

describe('GET /api/geo/search', () => {
  it('returns a LIST of candidates, and the attribution the licence requires', async () => {
    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(200);

    expect(Array.isArray(res.body.data.candidates)).toBe(true);
    expect(res.body.data.candidates[0]).toMatchObject({
      placeType: 'city',
      source: { kind: 'external', provider: PROVIDER_ID, ref: 'R349036' },
      label: { primary: 'Barcelona', kind: 'place' },
      admin: { countryCode: 'ES', cityName: 'Barcelona', regionName: 'Catalunya' },
      center: { longitude: 2.1774322, latitude: 41.3828939 },
      // A city centre is a framing device and NOT anybody's location.
      precision: 'centroid',
    });
    expect(res.body.data.attribution).toEqual({
      text: '© Fake contributors',
      url: 'https://example.invalid/copyright',
    });
  });

  it('never exposes the provider’s raw payload', async () => {
    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(200);
    const serialised = JSON.stringify(res.body);

    // The adapter's own vocabulary must not reach the wire — that is what makes
    // a provider swap a change with no public consequence.
    expect(serialised).not.toContain('rawAddressType');
    expect(serialised).not.toContain('displayName');
    expect(serialised).not.toContain('osm_id');
  });

  it('offers BOTH homonymous cities and picks neither', async () => {
    // Two cities called Barcelona: one in Spain, one in Venezuela. Auto-picking
    // is how somebody's search silently runs against the wrong continent.
    installFake({
      autocomplete: async () => [
        place(),
        place({
          ref: 'R123',
          displayName: 'Barcelona, Anzoátegui, Venezuela',
          address: { city: 'Barcelona', region: 'Anzoátegui', country: 'Venezuela', countryCode: 'VE' },
          center: { longitude: -64.7, latitude: 10.13 },
        }),
      ],
    });

    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(200);

    expect(res.body.data.candidates).toHaveLength(2);
    expect(res.body.data.candidates.map((c: { admin: { countryCode: string } }) => c.admin.countryCode)).toEqual(
      ['ES', 'VE'],
    );
  });

  it('keeps a valid result from ANOTHER country when a bias is supplied', async () => {
    // A bias must never become a filter: a user in Spain asking for a
    // Venezuelan city has to get it.
    installFake({
      autocomplete: async () => [
        place({
          ref: 'R123',
          address: { city: 'Barcelona', region: 'Anzoátegui', country: 'Venezuela', countryCode: 'VE' },
          center: { longitude: -64.7, latitude: 10.13 },
        }),
      ],
    });

    const res = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', near: '2.17,41.38' })
      .expect(200);

    expect(res.body.data.candidates).toHaveLength(1);
    expect(res.body.data.candidates[0].admin.countryCode).toBe('VE');
  });

  it('handles diacritics and a non-Latin script without mangling the label', async () => {
    installFake({
      autocomplete: async (query) => [
        place({
          ref: 'R900',
          name: query === 'Gracia' ? 'Gràcia' : '千代田区',
          address:
            query === 'Gracia'
              ? { neighborhood: 'Gràcia', city: 'Barcelona', country: 'España', countryCode: 'ES' }
              : { city: '千代田区', region: '東京都', country: '日本', countryCode: 'JP' },
          rawAddressType: query === 'Gracia' ? 'suburb' : 'city',
        }),
      ],
    });

    const accented = await request(app).get('/api/geo/search').query({ q: 'Gracia' }).expect(200);
    expect(accented.body.data.candidates[0].label.primary).toBe('Gràcia');
    expect(accented.body.data.candidates[0].placeType).toBe('neighborhood');

    const japanese = await request(app).get('/api/geo/search').query({ q: '千代田' }).expect(200);
    expect(japanese.body.data.candidates[0].label.primary).toBe('千代田区');
    expect(japanese.body.data.candidates[0].admin.countryCode).toBe('JP');
  });

  it('drops a candidate the provider gave no country code for, rather than inventing one', async () => {
    // ADR §9.4: no default country anywhere. `cityService` once defaulted to
    // `'USA'`, which silently relocated every unresolved place to another
    // continent. Dropping the candidate is visible; a wrong country is not.
    installFake({
      autocomplete: async () => [place({ ref: 'R1', address: { city: 'Nowhere' } }), place()],
    });

    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(200);
    expect(res.body.data.candidates).toHaveLength(1);
    expect(res.body.data.candidates[0].admin.countryCode).toBe('ES');
  });

  it('filters by requested type', async () => {
    installFake({
      autocomplete: async () => [
        place({ rawAddressType: 'city' }),
        place({ ref: 'R2', rawAddressType: 'house_number', address: { ...place().address, houseNumber: '401' } }),
      ],
    });

    const cities = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', types: 'city' })
      .expect(200);
    expect(cities.body.data.candidates).toHaveLength(1);
    expect(cities.body.data.candidates[0].placeType).toBe('city');

    const addresses = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', types: 'address' })
      .expect(200);
    expect(addresses.body.data.candidates).toHaveLength(1);
    // A house-number-level result IS a building, so `exact` is the honest
    // precision — unlike a street, which is a point on a line.
    expect(addresses.body.data.candidates[0].precision).toBe('exact');
  });
});

describe('GET /api/geo/search — failures never become an empty list', () => {
  const expectNotAnEmptyList = (res: request.Response) => {
    expect(res.status).not.toBe(200);
    expect(res.body.data?.candidates).toBeUndefined();
  };

  it('answers 429 for a rate-limited provider, with Retry-After', async () => {
    installFake({
      autocomplete: async () => {
        throw new GeocodingProviderError('rate_limited', PROVIDER_ID, 30);
      },
    });

    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(429);
    expectNotAnEmptyList(res);
    expect(res.body.error.code).toBe('GEO_RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('30');
  });

  it('answers 504 for a timeout', async () => {
    installFake({
      autocomplete: async () => {
        throw new GeocodingProviderError('timeout', PROVIDER_ID);
      },
    });

    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(504);
    expectNotAnEmptyList(res);
    expect(res.body.error.code).toBe('GEO_TIMEOUT');
  });

  it('answers 503 for a 5xx and for an unparseable provider response', async () => {
    installFake({
      autocomplete: async () => {
        throw new GeocodingProviderError('provider_unavailable', PROVIDER_ID);
      },
    });
    expectNotAnEmptyList(
      await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(503),
    );

    installFake({
      autocomplete: async () => {
        throw new GeocodingProviderError('invalid_response', PROVIDER_ID);
      },
    });
    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(503);
    expect(res.body.error.code).toBe('GEO_PROVIDER_UNAVAILABLE');
  });

  it('answers 200 with an EMPTY list only when the provider really found nothing', async () => {
    // The other side of the contract: an empty list is a legitimate answer, and
    // the client must be able to trust that it means what it says.
    installFake({ autocomplete: async () => [] });

    const res = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Zzzzzznowhere' })
      .expect(200);
    expect(res.body.data.candidates).toEqual([]);
  });

  it('never names the provider in an error body', async () => {
    installFake({
      autocomplete: async () => {
        throw new GeocodingProviderError('provider_unavailable', PROVIDER_ID);
      },
    });
    const res = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(503);
    expect(JSON.stringify(res.body)).not.toContain(PROVIDER_ID);
  });
});

describe('GET /api/geo/search — input validation', () => {
  it('rejects a missing, too-short or too-long query', async () => {
    await request(app).get('/api/geo/search').expect(400);
    await request(app).get('/api/geo/search').query({ q: 'a' }).expect(400);
    await request(app).get('/api/geo/search').query({ q: 'x'.repeat(121) }).expect(400);
  });

  it('rejects a non-textual payload rather than coercing it', async () => {
    // `?q=a&q=b` arrives as an array and `?q[x]=1` as an object; `String(...)`
    // would send "a,b" and "[object Object]" to a provider as a query.
    const repeated = await request(app).get('/api/geo/search?q=Barcelona&q=Madrid').expect(400);
    expect(repeated.body.error.code).toBe('INVALID_PARAM_TYPE');
    await request(app).get('/api/geo/search?q[evil]=1').expect(400);
  });

  it('rejects an out-of-range bias, an unknown type and an oversized limit', async () => {
    await request(app).get('/api/geo/search').query({ q: 'Barcelona', near: '2.17,191' }).expect(400);
    await request(app).get('/api/geo/search').query({ q: 'Barcelona', types: 'planet' }).expect(400);
    await request(app).get('/api/geo/search').query({ q: 'Barcelona', limit: '99' }).expect(400);
  });
});

describe('GET /api/geo/search — cache', () => {
  it('serves a repeat from cache without calling the provider again', async () => {
    let calls = 0;
    installFake({
      autocomplete: async () => {
        calls += 1;
        return [barcelona()];
      },
    });

    const first = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(200);
    const second = await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(200);

    expect(calls).toBe(1);
    expect(first.body.data.cached).toBe(false);
    expect(second.body.data.cached).toBe(true);
    expect(second.body.data.candidates).toEqual(first.body.data.candidates);
  });

  it('does NOT let one language’s answer serve another', async () => {
    // The failure this prevents is invisible: a plausible list comes back, in
    // the wrong language, and nothing looks broken.
    installFake({
      autocomplete: async (_query, language) => [
        place({ name: language === 'ca' ? 'Barcelona (ca)' : 'Barcelona (es)' }),
      ],
    });

    const catalan = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', language: 'ca' })
      .expect(200);
    const spanish = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', language: 'es' })
      .expect(200);

    expect(catalan.body.data.candidates[0].label.primary).toBe('Barcelona (ca)');
    expect(spanish.body.data.candidates[0].label.primary).toBe('Barcelona (es)');
  });

  it('does NOT let one country restriction serve another', async () => {
    installFake({
      autocomplete: async () => [place()],
    });
    const spain = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', countryCode: 'ES' })
      .expect(200);
    const venezuela = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona', countryCode: 'VE' })
      .expect(200);

    expect(spain.body.data.cached).toBe(false);
    // A shared key would have made this a cache HIT.
    expect(venezuela.body.data.cached).toBe(false);
  });

  it('does not cache a transient failure', async () => {
    // Caching a timeout turns a network blip into an outage that outlives it.
    let calls = 0;
    installFake({
      autocomplete: async () => {
        calls += 1;
        if (calls === 1) throw new GeocodingProviderError('timeout', PROVIDER_ID);
        return [barcelona()];
      },
    });

    await request(app).get('/api/geo/search').query({ q: 'Barcelona' }).expect(504);
    const recovered = await request(app)
      .get('/api/geo/search')
      .query({ q: 'Barcelona' })
      .expect(200);

    expect(recovered.body.data.candidates).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe('GET /api/geo/resolve', () => {
  it('resolves an external token through the provider that minted it', async () => {
    const res = await request(app)
      .get('/api/geo/resolve')
      .query({ loc: `city.${PROVIDER_ID}.R349036` })
      .expect(200);

    expect(res.body.data.place).toMatchObject({
      source: { kind: 'external', provider: PROVIDER_ID, ref: 'R349036' },
      label: { primary: 'Barcelona' },
    });
  });

  it('404s an EXPIRED candidate rather than falling back to something else', async () => {
    // The provider no longer knows this ref. A fallback here would return a
    // DIFFERENT place under the identity the caller asked for, which is worse
    // than failing.
    installFake({ resolve: async () => null });

    const res = await request(app)
      .get('/api/geo/resolve')
      .query({ loc: `city.${PROVIDER_ID}.R000000` })
      .expect(404);
    expect(res.body.error.code).toBe('PLACE_NOT_FOUND');
  });

  it('resolves a canonical Homiio city out of the database', async () => {
    const chain = await seedGeoChain({
      cityName: 'Barcelona',
      regionName: 'Catalonia',
      countryName: 'Spain',
      countryCode: 'ES',
      latitude: 41.3828939,
      longitude: 2.1774322,
    });

    const res = await request(app)
      .get('/api/geo/resolve')
      .query({ loc: `city.homiio.${chain.cityId}` })
      .expect(200);

    expect(res.body.data.place).toMatchObject({
      source: { kind: 'homiio', entity: 'city', id: chain.cityId },
      placeType: 'city',
      label: { primary: 'Barcelona', secondary: 'Catalonia, Spain' },
      admin: { countryCode: 'ES', cityName: 'Barcelona', regionName: 'Catalonia' },
      precision: 'centroid',
    });
  });

  it('resolves a canonical Homiio neighborhood, bounds included', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES' });
    const neighborhoodId = await seedNeighborhood({
      cityId: chain.cityId,
      name: 'Gràcia',
      latitude: 41.4,
      longitude: 2.15,
    });

    const res = await request(app)
      .get('/api/geo/resolve')
      .query({ loc: `neighborhood.homiio.${neighborhoodId}` })
      .expect(200);

    expect(res.body.data.place.label.primary).toBe('Gràcia');
    expect(res.body.data.place.admin.neighborhoodName).toBe('Gràcia');
  });

  it('404s a Homiio id that names no row', async () => {
    await request(app)
      .get('/api/geo/resolve')
      .query({ loc: 'city.homiio.0199ffffffffffffffffffffff' })
      .expect(404);
  });

  it('400s a malformed token, and a well-formed one that names no place', async () => {
    const malformed = await request(app).get('/api/geo/resolve').query({ loc: 'nonsense' }).expect(400);
    expect(malformed.body.error.code).toBe('INVALID_LOC');

    // `bbox.` is a VALID token carrying its own geometry. Answering 404 would
    // assert that a place the caller named does not exist, which is false.
    const bbox = await request(app)
      .get('/api/geo/resolve')
      .query({ loc: 'bbox.2.05,41.31,2.23,41.47' })
      .expect(400);
    expect(bbox.body.error.code).toBe('LOC_NOT_RESOLVABLE');

    // `here.` never carries coordinates, and resolves to no place either.
    const here = await request(app).get('/api/geo/resolve').query({ loc: 'here.25000' }).expect(400);
    expect(here.body.error.code).toBe('LOC_NOT_RESOLVABLE');
  });

  it('503s a token naming a provider this deployment does not have', async () => {
    // Not "no such place" — a gateway that cannot answer. Reporting it as 404
    // would tell the client the place is gone and invite it to drop the filter.
    const res = await request(app)
      .get('/api/geo/resolve')
      .query({ loc: 'city.someretiredprovider.R1' })
      .expect(503);
    expect(res.body.error.code).toBe('GEO_PROVIDER_UNAVAILABLE');
  });
});

describe('GET /api/geo/reverse', () => {
  it('returns the place a valid coordinate falls in', async () => {
    const res = await request(app)
      .get('/api/geo/reverse')
      .query({ lng: '2.1774322', lat: '41.3828939' })
      .expect(200);

    expect(res.body.data.place.label.primary).toBe('Barcelona');
    expect(res.body.data.place.admin.countryCode).toBe('ES');
  });

  it('rejects invalid coordinates', async () => {
    await request(app).get('/api/geo/reverse').query({ lng: '2.17' }).expect(400);
    await request(app).get('/api/geo/reverse').query({ lng: '181', lat: '41.38' }).expect(400);
    await request(app).get('/api/geo/reverse').query({ lng: '2.17', lat: '-91' }).expect(400);
    // `NaN` would be serialised into the provider URL literally, and some
    // instances answer it with a 200 and a nonsense place.
    await request(app).get('/api/geo/reverse').query({ lng: 'NaN', lat: '41.38' }).expect(400);
  });

  it('404s a coordinate the provider knows nothing about', async () => {
    installFake({ reverse: async () => null });
    await request(app).get('/api/geo/reverse').query({ lng: '0', lat: '0' }).expect(404);
  });

  it('propagates a provider failure instead of answering "no place here"', async () => {
    installFake({
      reverse: async () => {
        throw new GeocodingProviderError('timeout', PROVIDER_ID);
      },
    });
    // A 404 would tell the caller the ocean has no address; a 504 tells the
    // truth, which is that Homiio could not ask.
    await request(app).get('/api/geo/reverse').query({ lng: '2.17', lat: '41.38' }).expect(504);
  });
});
