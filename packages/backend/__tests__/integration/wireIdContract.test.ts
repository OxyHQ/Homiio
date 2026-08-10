/**
 * The `_id` → `id` wire contract, asserted on the real router.
 *
 * `@homiio/shared-types` names a document's identity `id` and nothing else, so
 * every consumer reads `id`. `middlewares/wireIds.ts` is the one place any other
 * spelling is resolved.
 *
 * Mongo is GONE — every row this API serves comes from Postgres, where the
 * column is already `id` — so the middleware no longer has a producer of `_id`
 * to correct. It is kept, and kept tested, as the boundary that makes "nothing
 * this API returns is named `_id`" a checked property of the WIRE rather than a
 * claim about the ~100 call sites behind it. The sweep below is the part that
 * still earns its keep; the unit cases pin the branches it relies on.
 *
 * This file exists because a typecheck cannot see any of it. The frontend
 * compiles against the DTOs; the backend hands `res.json` a serializer's plain
 * object, which is not typed as a DTO, so `tsc` is green whether the body
 * carries `id`, `_id`, or both. Only a real request can tell those apart.
 *
 * The NEGATIVE half of every assertion is the load-bearing one. Checking that
 * `id` is present passes just as happily on the old dual-spelling body that also
 * shipped `_id` — which is exactly the state this cut replaced — so each case
 * asserts the absence too.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import publicRoutes from '../../routes/public';
import { errorHandler } from '../../middlewares/errorHandler';
import { renameWireIds } from '../../middlewares/wireIds';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // The wiring production uses: `publicRoutes()` mounted at `/api`, exactly as
  // server.ts does it, so the serializer under test is reached the same way.
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

describe('renameWireIds', () => {
  it('moves `_id` to `id` and drops it', () => {
    expect(renameWireIds({ _id: 'abc', name: 'x' })).toEqual({ name: 'x', id: 'abc' });
  });

  it('renames inside nested objects and arrays', () => {
    const out = renameWireIds({
      data: [{ _id: '1', address: { _id: '2' } }, { _id: '3' }],
    }) as { data: Array<Record<string, unknown>> };

    expect(out.data[0].id).toBe('1');
    expect(out.data[0]).not.toHaveProperty('_id');
    expect((out.data[0].address as Record<string, unknown>).id).toBe('2');
    expect((out.data[0].address as Record<string, unknown>)).not.toHaveProperty('_id');
    expect(out.data[1].id).toBe('3');
  });

  it('keeps an `id` that was already set and still drops `_id`', () => {
    // A DTO mapper or a schema `toJSON` that set `id` made the more specific
    // decision; overwriting it would silently undo, for example, toLeaseDTO.
    expect(renameWireIds({ _id: 'raw', id: 'chosen' })).toEqual({ id: 'chosen' });
  });

  /**
   * A NON-STRING `_id` is stringified rather than emitted as an object.
   *
   * The fixture used to be a real `mongoose.Types.ObjectId`, which is what this
   * branch was written for. Nothing produces one any more — the models are gone
   * and every id in Postgres is already `text` — so the fixture is now the
   * SHAPE the branch actually handles: a value whose string form comes from its
   * own `toString`. That is precisely what `String(raw)` consumes, so the
   * substitution loses no coverage; asserting a real ObjectId here would only
   * pin a type this service can no longer construct.
   */
  it('stringifies a non-string `_id` rather than emitting it as an object', () => {
    const hex = '507f1f77bcf86cd799439011';
    const objectIdLike = { toString: () => hex };
    const out = renameWireIds({ _id: objectIdLike }) as { id: unknown };

    expect(out.id).toBe(hex);
    expect(typeof out.id).toBe('string');
  });

  it('leaves a Date alone', () => {
    const when = new Date('2026-08-09T00:00:00.000Z');
    expect((renameWireIds({ createdAt: when }) as { createdAt: Date }).createdAt).toEqual(when);
  });

  /**
   * `toPlain` runs `toJSON` BEFORE the walk, so the rename applies to the
   * REDUCED shape rather than to the wrapper's own enumerable properties.
   *
   * This case was written against a real Mongoose document created through the
   * `Country` model — the one thing in the codebase that defined `toJSON` and
   * carried `_id`. Both are gone, so the fixture is now stated directly: an
   * object whose `toJSON` yields `_id`, with a decoy enumerable property that
   * `toJSON` does NOT expose. The decoy is what keeps this honest — a
   * `renameWireIds` that skipped `toPlain` and walked the wrapper would emit
   * `notOnTheWire` and no `id`, so it fails rather than passing on a shape that
   * happens to look similar.
   */
  it('reduces a value through its own toJSON before renaming', () => {
    const document = {
      notOnTheWire: 'wrapper internals',
      toJSON: () => ({ _id: 'pt-1', name: 'Portugal' }),
    };
    const out = renameWireIds(document) as Record<string, unknown>;

    expect(out).not.toHaveProperty('_id');
    expect(out).not.toHaveProperty('notOnTheWire');
    expect(out.id).toBe('pt-1');
    expect(out.name).toBe('Portugal');
    // The input is untouched — it is not this function's to edit, and the same
    // object may be a cache entry or be reused after the response.
    expect(document.notOnTheWire).toBe('wrapper internals');
  });

  it('passes primitives and null through', () => {
    expect(renameWireIds(null)).toBeNull();
    expect(renameWireIds('x')).toBe('x');
    expect(renameWireIds(3)).toBe(3);
  });
});

describe('the wire contract, over a real request', () => {
  const app = buildApp();

  beforeEach(async () => {
    await resetGeoTables();
  });

  /**
   * Seed a published property in a city — in POSTGRES, which is where every
   * endpoint in the sweep below now reads it from.
   *
   * The country CODE is distinct from the one the sweep's own
   * `seedGeoChain` uses, because `countries_code_key` is UNIQUE and this
   * function runs alongside it in the same test.
   */
  async function seedCityProperty(): Promise<{ cityId: string; propertyId: string }> {
    const chain = await seedGeoChain({
      cityName: 'Barcelona',
      countryCode: 'ES-wire',
      regionName: 'Catalonia',
    });
    const addressId = await seedAddress({
      chain,
      street: 'Carrer de Mallorca',
      postalCode: '08013',
      longitude: 2.1734,
      latitude: 41.3851,
    });
    const propertyId = await seedProperty({
      addressId,
      overrides: {
        type: PropertyType.APARTMENT,
        bedrooms: 2,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 1800,
        longTermRentCurrency: 'EUR',
        status: PropertyStatus.PUBLISHED,
        isExternal: true,
        source: 'fixture',
        sourceId: 'wire-id-contract-1',
        sourceUrl: 'https://fixtures.homiio.com/wire-id-contract',
      },
    });

    return { cityId: chain.cityId, propertyId };
  }

  it('serializes a joined read as `id`, never `_id`, including nested documents', async () => {
    const { cityId, propertyId } = await seedCityProperty();

    const res = await request(app).get(`/api/cities/${cityId}/properties?limit=8`).expect(200);

    const [property] = res.body.data.properties;
    expect(property.id).toBe(propertyId);
    expect(property).not.toHaveProperty('_id');
    // The nested address arrives from the JOIN inside the same row; a
    // serializer that only renamed the top level would leave this one behind.
    expect(property.address).toBeDefined();
    expect(property.address).not.toHaveProperty('_id');
    // And the city on the same body, built by `serializeCity` from its own
    // joined row — a second, independently-constructed object in one response.
    expect(res.body.data.city.id).toBe(cityId);
    expect(res.body.data.city).not.toHaveProperty('_id');
  });

  it('leaves no `_id` anywhere in the body, at any depth', async () => {
    const { cityId } = await seedCityProperty();

    const res = await request(app).get(`/api/cities/${cityId}/properties?limit=8`).expect(200);

    // A whole-body scan rather than named fields: the point of a chokepoint is
    // that nothing gets past it, and a per-field assertion only covers the
    // fields somebody remembered.
    expect(JSON.stringify(res.body)).not.toContain('"_id"');
  });

  /**
   * The sweep, and the reason it carries a vacuity floor.
   *
   * One endpoint proving the serializer works says nothing about the one added
   * next week, and the claim this middleware rests on is about the WHOLE router:
   * "nothing this API returns is legitimately named `_id`". That is checkable,
   * so it is checked.
   *
   * A scan for `"_id"` over a body that came back `[]` or `500` passes for the
   * wrong reason, and the first draft of this test did exactly that — 10 of its
   * 16 paths returned an empty list, a 404, or an error, so it would have gone
   * green with the serializer removed from most of them. Hence the split below:
   * a path is only counted as COVERAGE once its body is asserted to contain
   * real entity data, and the assertion names the path that failed.
   *
   * The city endpoints read Postgres, so they need the Postgres fixtures seeded
   * — they were ported in an earlier batch and stopped reading the Mongo `City`
   * model, which is the concrete way that first draft was silently empty.
   *
   * ## What this deliberately does NOT catch, so nobody reads it as a hole
   *
   * Putting `_id` back into a CONTROLLER's own response literal fails nothing
   * here — verified by mutation, not assumed. That is the chokepoint working:
   * `middlewares/wireIds.ts` strips it downstream, so the wire is still correct
   * and there is no regression to report. What these cases do catch is a hole in
   * the serializer itself (mutated to skip property-shaped objects: three cases
   * red, naming `/api/properties` and the city-properties path) and the
   * serializer being unmounted altogether. The subject under test is the WIRE,
   * not which layer happens to produce it.
   */
  it('emits no `_id` from any public endpoint that returns entities', async () => {
    const { cityId, propertyId } = await seedCityProperty();
    const chain = await seedGeoChain({ cityName: 'Barcelona', propertiesCount: 3 });

    const entityPaths = [
      '/api/cities',
      '/api/cities/search?q=Barc',
      '/api/cities/lookup?name=Barcelona',
      `/api/cities/${chain.cityId}`,
      `/api/cities/${cityId}/properties?limit=8`,
      '/api/properties',
      // Joined the sweep once #290 gave it a status filter that can match. It
      // was excluded here for as long as `controllers/property/batch.ts`
      // filtered `status: 'active'` — a value outside `PropertyStatus`, so the
      // body was permanently empty and would have passed the `_id` scan for the
      // wrong reason. That exclusion is what surfaced the bug; this line is the
      // other end of it, and the `empty` floor below is what keeps it honest.
      `/api/properties/by-ids?ids=${propertyId}`,
    ];
    // `/api/analytics/stats` is deliberately absent and it is not laziness: it
    // returns aggregates, not entities, so it has no `id` to floor on. It has
    // its own case below.

    const leaked: string[] = [];
    const empty: string[] = [];
    for (const path of entityPaths) {
      const res = await request(app).get(path);
      const body = JSON.stringify(res.body ?? null);
      if (body.includes('"_id"')) leaked.push(`${path} (HTTP ${res.status})`);
      // The floor. A body with no `"id":` in it exercised nothing, so treating it
      // as a pass would be the bug this whole test exists to catch.
      if (res.status !== 200 || !body.includes('"id":')) {
        empty.push(`${path} (HTTP ${res.status}, ${body.slice(0, 60)})`);
      }
    }

    // Naming the offending path is the difference between a gate that tells you
    // where to look and one that tells you only that something is wrong.
    expect(leaked).toEqual([]);
    expect(empty).toEqual([]);
  });

  /**
   * Failure bodies go through the transform too — `errorHandler` runs on a
   * response whose `res.json` this middleware already replaced. They carry no
   * `_id`, but they DO pass through, and the envelope has to survive the rebuild.
   */
  it('passes error bodies through intact and without `_id`', async () => {
    const errorPaths = [
      '/api/cities/000000000000000000000000',
      '/api/cities/lookup?name=Atlantis&country=Nowhere',
    ];

    for (const path of errorPaths) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('"_id"');
      expect(res.body.success).toBe(false);
      expect(typeof res.body.message).toBe('string');
    }
  });

  it('leaves the envelope, the pagination block and a non-entity `id` intact', async () => {
    const { cityId } = await seedCityProperty();

    const res = await request(app).get(`/api/cities/${cityId}/properties?limit=8`).expect(200);

    // The transform rebuilds every object it walks, so the envelope keys have to
    // survive that rebuild — a serializer that dropped `pagination` would still
    // pass every `_id` assertion in this file.
    expect(res.body.success).toBe(true);
    expect(res.body.data.pagination).toEqual(
      expect.objectContaining({ page: 1, limit: 8, total: 1, pages: 1 }),
    );
    expect(res.body.data.city.name).toBe('Barcelona');

    // A NUMERIC `id` is what an Overpass/OSM element carries, and the one shape a
    // "stringify the id" transform would quietly corrupt if it ever stopped
    // deferring to an `id` already present.
    expect(renameWireIds({ id: 42, tags: { amenity: 'cafe' } })).toEqual({
      id: 42,
      tags: { amenity: 'cafe' },
    });
  });

  /**
   * `analyticsController` is the one endpoint whose underlying data really does
   * have an `_id` that is NOT an entity id — a `$group` key. It maps that into
   * `cityId` and `bucket` BEFORE responding, which is the reason a whole-body
   * strip is safe on this router at all. Pinning it here means the day someone
   * returns a raw aggregation, this fails rather than the meaning of a field
   * silently changing.
   */
  it('keeps aggregation group keys mapped to named fields, never `_id`', async () => {
    await seedCityProperty();

    const res = await request(app).get('/api/analytics/stats').expect(200);

    expect(JSON.stringify(res.body)).not.toContain('"_id"');
    for (const row of res.body.data.topCities ?? []) {
      expect(row).toHaveProperty('cityId');
      expect(row).not.toHaveProperty('id');
    }
    for (const row of res.body.data.priceBuckets ?? []) {
      expect(row).toHaveProperty('bucket');
      expect(row).not.toHaveProperty('id');
    }
  });
});
