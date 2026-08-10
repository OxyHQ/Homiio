/**
 * `GET /api/cities/lookup` — the deterministic place contract of #295, over real
 * Postgres and the real router.
 *
 * ## Every fixture here is built to tell a correct implementation from a WRONG
 * one, not merely to pass
 *
 * `docs/adr/0002-location-and-search-contract.md` §12.2 states the rule and it
 * governs this whole file: the two rows must differ in id, `countryCode` AND
 * `regionName`, and the test must select the SECOND one. A fixture whose
 * intended answer is also the first row, the most-listed row, or the
 * default-country row cannot distinguish a correct implementation from four
 * different wrong ones — it passes against `results[0]`, against
 * "most listings wins", and against a hardcoded country default alike.
 *
 * So the Venezuelan Barcelona is seeded SECOND, with ONE listing against Spain's
 * five hundred, and it is the row every discriminator test asks for. An
 * implementation that takes the first row, or the popular row, fails here.
 *
 * ## Insertion order is load-bearing, and that is on purpose
 *
 * Several cases seed the row that must come LAST first. Physical (heap) order is
 * what a scan returns when an `ORDER BY` is removed, so a fixture inserted in
 * the answer's own order cannot tell a sorted query from an unsorted one — the
 * mutation would survive. `seedCity` therefore takes explicit ids and the tests
 * choose them so that "sorted by id" and "insertion order" disagree.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import publicRoutes from '../../routes/public';
import { errorHandler } from '../../middlewares/errorHandler';
import { getDb } from '../../db/postgres';
import { cities, countries, regions } from '../../db/schema';
import type { CityPlaceCandidate } from '@homiio/shared-types';

import { slugifyPlaceName } from '../../db/geo/placeSlug';
import { resetGeoTables } from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

const app = buildApp();

type Candidate = CityPlaceCandidate;

async function seedCountry(id: string, code: string, name: string): Promise<string> {
  await getDb().insert(countries).values({ id, code, name });
  return id;
}

async function seedRegion(id: string, countryId: string, name: string, code?: string): Promise<string> {
  await getDb().insert(regions).values({ id, countryId, name, ...(code ? { code } : {}) });
  return id;
}

async function seedCity(options: {
  id: string;
  countryId: string;
  regionId: string;
  name: string;
  propertiesCount?: number;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
}): Promise<string> {
  await getDb().insert(cities).values({
    id: options.id,
    countryId: options.countryId,
    regionId: options.regionId,
    name: options.name,
    propertiesCount: options.propertiesCount ?? 0,
    latitude: options.latitude ?? null,
    longitude: options.longitude ?? null,
    ...(options.isActive === undefined ? {} : { isActive: options.isActive }),
  });
  return options.id;
}

/**
 * The two Barcelonas of ADR §12.2.
 *
 * `ES` first and hugely more popular; `VE` second and nearly empty. Ids are
 * chosen so Spain also sorts first by id, which means NO ordering signal in this
 * fixture points at Venezuela — every test that expects Venezuela is therefore
 * testing a discriminator and nothing else.
 */
async function seedTwoBarcelonas(): Promise<{ es: string; ve: string; esRegion: string; veRegion: string }> {
  const spain = await seedCountry('t-ctry-a-es', 'ES', 'Spain');
  const catalonia = await seedRegion('t-rg-a-cat', spain, 'Catalonia', 'ES-CT');
  const es = await seedCity({
    id: 't-city-a-bcn-es',
    countryId: spain,
    regionId: catalonia,
    name: 'Barcelona',
    propertiesCount: 500,
    latitude: 41.3851,
    longitude: 2.1734,
  });

  const venezuela = await seedCountry('t-ctry-b-ve', 'VE', 'Venezuela');
  const anzoategui = await seedRegion('t-rg-b-anz', venezuela, 'Anzoátegui', 'VE-O');
  const ve = await seedCity({
    id: 't-city-b-bcn-ve',
    countryId: venezuela,
    regionId: anzoategui,
    name: 'Barcelona',
    propertiesCount: 1,
    latitude: 10.1333,
    longitude: -64.6833,
  });

  return { es, ve, esRegion: catalonia, veRegion: anzoategui };
}

function candidatesOf(body: unknown): Candidate[] {
  const data = (body as { data?: { candidates?: Candidate[] } }).data;
  return data?.candidates ?? [];
}

function placeOf(body: unknown): Candidate | undefined {
  return (body as { data?: { place?: Candidate } }).data?.place;
}

beforeEach(async () => {
  await resetGeoTables();
});

describe('two cities called Barcelona, in different countries and regions', () => {
  it('answers `ambiguous` with BOTH, and picks neither', async () => {
    const { es, ve } = await seedTwoBarcelonas();

    const res = await request(app).get('/api/cities/lookup?name=Barcelona').expect(200);

    expect(res.body.data.status).toBe('ambiguous');
    expect(res.body.data.code).toBe('AMBIGUOUS_LOCATION');
    // The negative half, and it is the whole point: no `place` was chosen. An
    // implementation that resolved to Spain would satisfy every positive
    // assertion a lazier test could make.
    expect(res.body.data).not.toHaveProperty('place');
    expect(candidatesOf(res.body).map((c) => c.id).sort()).toEqual([es, ve].sort());
  });

  it('gives each candidate the country, region, centre and id #352 needs to tell them apart', async () => {
    await seedTwoBarcelonas();

    const res = await request(app).get('/api/cities/lookup?name=Barcelona').expect(200);
    const byCountry = new Map(candidatesOf(res.body).map((c) => [c.admin.countryCode, c]));

    expect(byCountry.get('ES')).toEqual(
      expect.objectContaining({
        slug: 'barcelona',
        qualifiedSlug: 'barcelona-catalonia-es',
        placeType: 'city',
        matchedOn: 'name',
        precision: 'centroid',
        center: { longitude: 2.1734, latitude: 41.3851 },
        source: { kind: 'homiio', entity: 'city', id: byCountry.get('ES')?.id },
        label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
        admin: expect.objectContaining({ regionName: 'Catalonia', regionCode: 'ES-CT', cityName: 'Barcelona' }),
      }),
    );
    expect(byCountry.get('VE')).toEqual(
      expect.objectContaining({
        qualifiedSlug: 'barcelona-anzoategui-ve',
        label: expect.objectContaining({ secondary: 'Anzoátegui, Venezuela' }),
        admin: expect.objectContaining({ regionName: 'Anzoátegui' }),
      }),
    );
    // Nothing writes `cities.bbox_*` yet (#351 does), so `bounds` is ABSENT
    // rather than null or invented — asserted so a later "helpful" derived
    // envelope has to be a decision somebody makes on purpose.
    expect(byCountry.get('ES')).not.toHaveProperty('bounds');
  });

  it('resolves to the SECOND, less popular Barcelona when the country says so', async () => {
    const { ve } = await seedTwoBarcelonas();

    const res = await request(app).get('/api/cities/lookup?name=Barcelona&countryCode=VE').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(ve);
    expect(placeOf(res.body)?.admin.countryCode).toBe('VE');
  });

  it('resolves by region id, without a country', async () => {
    const { ve, veRegion } = await seedTwoBarcelonas();

    const res = await request(app).get(`/api/cities/lookup?name=Barcelona&regionId=${veRegion}`).expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(ve);
  });

  it('resolves by region NAME, which is what the legacy `?state=` param carries', async () => {
    const { ve } = await seedTwoBarcelonas();

    const res = await request(app).get('/api/cities/lookup?name=Barcelona&state=Anzoátegui').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(ve);
  });

  it('404s when the narrowing country or region names nothing', async () => {
    await seedTwoBarcelonas();

    for (const path of [
      '/api/cities/lookup?name=Barcelona&country=Atlantis',
      '/api/cities/lookup?name=Barcelona&state=Atlantis',
      '/api/cities/lookup?name=Barcelona&countryCode=ZZ',
    ]) {
      const res = await request(app).get(path).expect(404);
      expect(res.body.code).toBe('PLACE_NOT_FOUND');
    }
  });
});

describe('two homonyms inside the SAME country', () => {
  it('is still ambiguous — a shared country is not a discriminator', async () => {
    const spain = await seedCountry('t-ctry-es', 'ES', 'Spain');
    const valenciana = await seedRegion('t-rg-a-vc', spain, 'Valencian Community', 'ES-VC');
    const aragon = await seedRegion('t-rg-b-ar', spain, 'Aragon', 'ES-AR');
    const city = await seedCity({ id: 't-city-a-val', countryId: spain, regionId: valenciana, name: 'Valencia', propertiesCount: 300 });
    const village = await seedCity({ id: 't-city-b-val', countryId: spain, regionId: aragon, name: 'Valencia', propertiesCount: 0 });

    const res = await request(app).get('/api/cities/lookup?name=Valencia&countryCode=ES').expect(200);

    expect(res.body.data.status).toBe('ambiguous');
    expect(candidatesOf(res.body).map((c) => c.id).sort()).toEqual([city, village].sort());
  });

  it('resolves the same pair once a region is named', async () => {
    const spain = await seedCountry('t-ctry-es', 'ES', 'Spain');
    const valenciana = await seedRegion('t-rg-a-vc', spain, 'Valencian Community', 'ES-VC');
    const aragon = await seedRegion('t-rg-b-ar', spain, 'Aragon', 'ES-AR');
    await seedCity({ id: 't-city-a-val', countryId: spain, regionId: valenciana, name: 'Valencia', propertiesCount: 300 });
    const village = await seedCity({ id: 't-city-b-val', countryId: spain, regionId: aragon, name: 'Valencia', propertiesCount: 0 });

    const res = await request(app).get('/api/cities/lookup?name=Valencia&region=Aragon').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(village);
  });
});

describe('a geographic bias', () => {
  /**
   * The bias ORDERS the candidate list; it never removes a row from it.
   *
   * Both assertions are needed and neither alone is enough: the first shows the
   * bias reaches the query at all, the second shows it did not silently become a
   * filter — which would be a different bug wearing the same green test.
   */
  it('leads with the nearest candidate, and still returns the far one', async () => {
    const { es, ve } = await seedTwoBarcelonas();

    const nearVenezuela = await request(app)
      .get('/api/cities/lookup?name=Barcelona&near=-64.7,10.1')
      .expect(200);
    expect(candidatesOf(nearVenezuela.body).map((c) => c.id)).toEqual([ve, es]);

    const nearSpain = await request(app).get('/api/cities/lookup?name=Barcelona&near=2.2,41.4').expect(200);
    expect(candidatesOf(nearSpain.body).map((c) => c.id)).toEqual([es, ve]);
  });

  it('400s on a malformed bias rather than ignoring it', async () => {
    await seedTwoBarcelonas();

    for (const value of ['nonsense', '2.2', '2.2,41.4,0', '400,41.4']) {
      const res = await request(app).get(`/api/cities/lookup?name=Barcelona&near=${encodeURIComponent(value)}`).expect(400);
      expect(res.body.code).toBe('INVALID_PLACE_QUERY');
    }
  });
});

describe('a bounding box', () => {
  it('filters candidates to the box', async () => {
    const { es } = await seedTwoBarcelonas();

    const res = await request(app).get('/api/cities/lookup?name=Barcelona&bounds=2.0,41.3,2.3,41.5').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(es);
  });

  it('reads `west > east` as crossing the antimeridian, not as an error', async () => {
    const fiji = await seedCountry('t-ctry-fj', 'FJ', 'Fiji');
    const central = await seedRegion('t-rg-fj', fiji, 'Central');
    // Suva is inside the 20-degree strip over the Pacific; Madrid is outside it
    // at the same latitude band's longitude scale. A box normalised by SWAPPING
    // west and east returns the exact complement of this — Madrid and not Suva.
    const suva = await seedCity({ id: 't-city-suva', countryId: fiji, regionId: central, name: 'Portside', latitude: -18.14, longitude: 178.44 });
    await seedCity({ id: 't-city-far', countryId: fiji, regionId: central, name: 'Portside Far', latitude: -18, longitude: 0 });

    const res = await request(app).get('/api/cities/lookup?name=Portside&bounds=170,-20,-170,-16').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(suva);
  });

  it('400s when latitudes are inverted, which is a real error', async () => {
    await seedTwoBarcelonas();
    const res = await request(app).get('/api/cities/lookup?name=Barcelona&bounds=2.0,41.5,2.3,41.3').expect(400);
    expect(res.body.code).toBe('INVALID_PLACE_QUERY');
  });
});

describe('a complete tie', () => {
  /**
   * Two rows agreeing on EVERY ranking signal — same name, same listing count,
   * both without coordinates, no bias — so only the final `id` key can separate
   * them.
   *
   * The higher id is inserted FIRST. Without an `ORDER BY` a scan returns them in
   * that (heap) order, which is the reverse of the answer, so this case can tell
   * a sorted query from an unsorted one. Seeded in the answer's own order it
   * could not, and the ordering mutation would survive.
   */
  it('is ordered by stable id, and the fixture is seeded in the opposite order', async () => {
    const nowhere = await seedCountry('t-ctry-xx', 'XX', 'Elsewhere');
    const north = await seedRegion('t-rg-a-n', nowhere, 'North');
    const south = await seedRegion('t-rg-b-s', nowhere, 'South');
    const later = await seedCity({ id: 't-city-z-tie', countryId: nowhere, regionId: north, name: 'Springfield', propertiesCount: 7 });
    const earlier = await seedCity({ id: 't-city-a-tie', countryId: nowhere, regionId: south, name: 'Springfield', propertiesCount: 7 });

    const res = await request(app).get('/api/cities/lookup?name=Springfield').expect(200);

    expect(res.body.data.status).toBe('ambiguous');
    expect(candidatesOf(res.body).map((c) => c.id)).toEqual([earlier, later]);
    expect(earlier < later).toBe(true);
  });
});

describe('ranking below the ambiguity decision', () => {
  /**
   * A place we can put on a map beats one we cannot, all else equal — and the
   * coordinate-less row is seeded FIRST and given MORE listings, so neither heap
   * order nor `properties_count` can produce this answer by accident.
   */
  it('leads with the city that has coordinates over the one that has none', async () => {
    const nowhere = await seedCountry('t-ctry-xx', 'XX', 'Elsewhere');
    const north = await seedRegion('t-rg-a-n', nowhere, 'North');
    const south = await seedRegion('t-rg-b-s', nowhere, 'South');
    const blind = await seedCity({ id: 't-city-a-blind', countryId: nowhere, regionId: north, name: 'Riverside', propertiesCount: 90 });
    const mapped = await seedCity({
      id: 't-city-b-mapped', countryId: nowhere, regionId: south, name: 'Riverside', propertiesCount: 2, latitude: 12, longitude: 34,
    });

    const res = await request(app).get('/api/cities/lookup?name=Riverside').expect(200);

    expect(candidatesOf(res.body).map((c) => c.id)).toEqual([mapped, blind]);
    // The coordinate-less row says `area` rather than carrying an invented point.
    expect(candidatesOf(res.body)[1]).not.toHaveProperty('center');
    expect(candidatesOf(res.body)[1].precision).toBe('area');
  });

  /**
   * `properties_count` orders the list a human is offered. It does NOT decide —
   * the answer is still `ambiguous` — which is the documented bias of #295 and
   * the reason this assertion checks the status as well as the order.
   */
  it('orders by listing count without letting it resolve anything', async () => {
    const nowhere = await seedCountry('t-ctry-xx', 'XX', 'Elsewhere');
    const north = await seedRegion('t-rg-a-n', nowhere, 'North');
    const south = await seedRegion('t-rg-b-s', nowhere, 'South');
    const quiet = await seedCity({ id: 't-city-a-quiet', countryId: nowhere, regionId: north, name: 'Lakeview', propertiesCount: 1 });
    const busy = await seedCity({ id: 't-city-b-busy', countryId: nowhere, regionId: south, name: 'Lakeview', propertiesCount: 900 });

    const res = await request(app).get('/api/cities/lookup?name=Lakeview').expect(200);

    expect(res.body.data.status).toBe('ambiguous');
    expect(candidatesOf(res.body).map((c) => c.id)).toEqual([busy, quiet]);
  });
});

describe('slugs and old URLs', () => {
  /**
   * The token is `malaga` and the stored name is `Málaga`, so the NAME predicate
   * (`lower(name) = lower($1)`) cannot match and only the slug can.
   *
   * A city whose lowercased name already equals its slug — `girona` — would be
   * satisfied by the name branch alone and could not tell the two apart, which
   * is how `matchedOn` was first asserted here and why it was wrong.
   */
  it('resolves a bare slug when only one city carries it', async () => {
    const spain = await seedCountry('t-ctry-es', 'ES', 'Spain');
    const andalusia = await seedRegion('t-rg-and', spain, 'Andalusia');
    const malaga = await seedCity({ id: 't-city-malaga', countryId: spain, regionId: andalusia, name: 'Málaga' });

    const res = await request(app).get('/api/cities/lookup?city=malaga').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(malaga);
    expect(placeOf(res.body)?.matchedOn).toBe('slug');
  });

  it('keeps a bare shared slug AMBIGUOUS instead of quietly changing which city it means', async () => {
    const { es, ve } = await seedTwoBarcelonas();

    const res = await request(app).get('/api/cities/lookup?city=barcelona').expect(200);

    expect(res.body.data.status).toBe('ambiguous');
    expect(candidatesOf(res.body).map((c) => c.id).sort()).toEqual([es, ve].sort());
  });

  it('resolves the context-carrying form, in all three qualified spellings', async () => {
    const { es, ve } = await seedTwoBarcelonas();

    for (const [slug, expected] of [
      ['barcelona-catalonia-es', es],
      ['barcelona-catalonia', es],
      ['barcelona-es', es],
      ['barcelona-anzoategui-ve', ve],
      ['barcelona-ve', ve],
    ] as const) {
      const res = await request(app).get(`/api/cities/lookup?slug=${slug}`).expect(200);
      expect([slug, res.body.data.status]).toEqual([slug, 'resolved']);
      expect([slug, placeOf(res.body)?.id]).toEqual([slug, expected]);
    }
  });

  it('matches an accented name through its unaccented slug', async () => {
    const spain = await seedCountry('t-ctry-es', 'ES', 'Spain');
    const castile = await seedRegion('t-rg-cyl', spain, 'Castile and León');
    const avila = await seedCity({ id: 't-city-avila', countryId: spain, regionId: castile, name: 'Ávila' });

    const res = await request(app).get('/api/cities/lookup?city=avila').expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(avila);
    // The region slug in the qualified form is unaccented by the same rule.
    expect(placeOf(res.body)?.qualifiedSlug).toBe('avila-castile-and-leon-es');
  });

  it('404s for a slug that names nothing', async () => {
    await seedTwoBarcelonas();
    await request(app).get('/api/cities/lookup?city=atlantis-nowhere-zz').expect(404);
  });
});

describe('identity', () => {
  it('resolves an id outright, even while its name is ambiguous', async () => {
    const { ve } = await seedTwoBarcelonas();

    const res = await request(app).get(`/api/cities/lookup?q=${ve}`).expect(200);

    expect(res.body.data.status).toBe('resolved');
    expect(placeOf(res.body)?.id).toBe(ve);
    expect(placeOf(res.body)?.matchedOn).toBe('id');
  });

  it('never returns an inactive city', async () => {
    const spain = await seedCountry('t-ctry-es', 'ES', 'Spain');
    const catalonia = await seedRegion('t-rg-cat', spain, 'Catalonia');
    await seedCity({ id: 't-city-hidden', countryId: spain, regionId: catalonia, name: 'Hidden', isActive: false });

    await request(app).get('/api/cities/lookup?name=Hidden').expect(404);
  });
});

describe('validation', () => {
  it('400s without a token', async () => {
    const res = await request(app).get('/api/cities/lookup').expect(400);
    expect(res.body.code).toBe('INVALID_PLACE_QUERY');
  });

  it('400s on a limit outside the allowed range', async () => {
    await seedTwoBarcelonas();
    for (const limit of ['0', '26', '2.5', 'many']) {
      const res = await request(app).get(`/api/cities/lookup?name=Barcelona&limit=${limit}`).expect(400);
      expect(res.body.code).toBe('INVALID_PLACE_QUERY');
    }
  });
});

describe('the slug rule agrees in TypeScript and in Postgres', () => {
  /**
   * `db/geo/placeSlug.ts` emits the rule twice — as an expression the database
   * computes `cities.slug` with, and as a function that slugs an inbound token.
   * Both are derived from the same tables, which is an argument; this is the
   * measurement.
   *
   * A disagreement is silent and total: an inbound `?city=malaga` simply stops
   * matching the row stored as `Málaga`, with no error anywhere.
   */
  it('produces the same slug for names that exercise every branch of it', async () => {
    const spain = await seedCountry('t-ctry-es', 'ES', 'Spain');
    const region = await seedRegion('t-rg-any', spain, 'Anywhere');
    const names = [
      'Barcelona',
      'Málaga',
      'São Paulo',
      "L'Hospitalet de Llobregat",
      'Straße',
      'Cluj-Napoca',
      'Ávila',
      'Reykjavík',
      'Kraków',
      'İzmir',
      '  Palma de Mallorca  ',
      'Æbeltoft',
    ];
    await Promise.all(
      names.map((name, index) =>
        seedCity({ id: `t-city-slug-${index}`, countryId: spain, regionId: region, name }),
      ),
    );

    const rows = await getDb().select({ name: cities.name, slug: cities.slug }).from(cities);

    // The floor: a traversal that read nothing would otherwise pass this.
    expect(rows).toHaveLength(names.length);
    const disagreements = rows
      .filter((row) => row.slug !== slugifyPlaceName(row.name))
      .map((row) => `${row.name}: postgres=${row.slug} typescript=${slugifyPlaceName(row.name)}`);
    expect(disagreements).toEqual([]);
  });
});
