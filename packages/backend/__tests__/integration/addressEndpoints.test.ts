/**
 * The ported `/api/addresses*` endpoints, over real Postgres and the real router.
 *
 * The wire format is the thing most at risk here, because the schema renamed
 * every field on the way in: `postal_code` became `postalCode` in TypeScript
 * (and back to `postal_code` in SQL), `land_plot` became three flat columns, and
 * the GeoJSON `coordinates` pair became two named scalars. None of that may
 * reach the frontend, so the shape assertions below are as load-bearing as the
 * query ones. An address serializes its identity as `id` only — the `_id` that
 * used to ship beside it is gone, and the detail test asserts its ABSENCE, which
 * is the only half that can catch it coming back.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import addressRoutes from '../../routes/addresses';
import { errorHandler } from '../../middlewares/errorHandler';
import { getDb } from '../../db/postgres';
import { addresses } from '../../db/schema';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedNeighborhood,
} from '../helpers/postgresGeoFixtures';

jest.mock('../../services/geocodingService', () => ({
  __esModule: true,
  reverseGeocode: jest.fn(async () => ({ success: false as const, error: 'not called in this suite' })),
  forwardGeocode: jest.fn(async () => ({ success: false as const, error: 'not called in this suite' })),
}));

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/addresses', addressRoutes);
  app.use(errorHandler);
  return app;
}

const app = buildApp();

beforeEach(async () => {
  await resetGeoTables();
});


describe('GET /api/addresses/:id', () => {
  it('resolves the geo display names in the same read', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', regionName: 'Catalonia', countryName: 'Spain' });
    const neighborhoodId = await seedNeighborhood({ cityId: chain.cityId, name: 'Gràcia' });
    const addressId = await seedAddress({ chain, neighborhoodId, street: 'Carrer de Mallorca', number: '401' });

    const res = await request(app).get(`/api/addresses/${addressId}`).expect(200);

    expect(res.body.address.cityName).toBe('Barcelona');
    expect(res.body.address.regionName).toBe('Catalonia');
    expect(res.body.address.countryName).toBe('Spain');
    expect(res.body.address.neighborhoodName).toBe('Gràcia');
    // The derived label the property cards render.
    expect(res.body.address.location).toBe('Barcelona, Catalonia, Spain');
  });

  it('keeps the Mongo field spellings and the GeoJSON coordinate pair', async () => {
    const chain = await seedGeoChain({});
    const addressId = await seedAddress({
      chain,
      street: 'Carrer de Mallorca',
      postalCode: '08013',
      longitude: 2.1734,
      latitude: 41.3851,
    });

    const res = await request(app).get(`/api/addresses/${addressId}`).expect(200);
    const { address } = res.body;

    expect(address.id).toBe(addressId);
    expect(address).not.toHaveProperty('_id');
    expect(address.postal_code).toBe('08013');
    expect(address).not.toHaveProperty('postalCode');
    // `[lng, lat]`, GeoJSON order — transposing this pins a Barcelona listing
    // into the Indian Ocean and nothing about the shape would look wrong.
    expect(address.coordinates).toEqual({ type: 'Point', coordinates: [2.1734, 41.3851] });
  });

  it('exposes the generated address level of a place it publishes, and not a unit’s', async () => {
    const chain = await seedGeoChain({});
    const streetId = await seedAddress({ chain });
    const unitId = await seedAddress({ chain, street: 'Other', floor: '3' });

    expect((await request(app).get(`/api/addresses/${streetId}`).expect(200)).body.address.addressLevel).toBe('STREET');

    // A UNIT row published at building precision names neither its own id nor
    // its level — announcing `UNIT` is announcing that the id names one
    // household. The whole rule, per audience, is in
    // `addressPrecisionPublication.test.ts`.
    const unit = (await request(app).get(`/api/addresses/${unitId}`).expect(200)).body.address;
    expect(unit).not.toHaveProperty('addressLevel');
    expect(unit).not.toHaveProperty('floor');
    expect(unit).not.toHaveProperty('id');
  });

  it('404s for an unknown id of any shape, rather than 400ing on its spelling', async () => {
    // The old `Types.ObjectId.isValid` guard 400'd anything that was not 24 hex,
    // which would reject every uuid v7 the moment one exists.
    await request(app).get('/api/addresses/01997f2c-6b40-7000-8000-0000000000ab').expect(404);
    await request(app).get('/api/addresses/nonsense').expect(404);
  });
});

describe('GET /api/addresses/search', () => {
  it('matches the street with an unanchored, case-insensitive term', async () => {
    const chain = await seedGeoChain({});
    const target = await seedAddress({ chain, street: 'Carrer de Mallorca' });
    await seedAddress({ chain, street: 'Avinguda Diagonal' });

    const res = await request(app).get('/api/addresses/search?query=mallor').expect(200);

    expect(res.body.addresses.map((a: { id: string }) => a.id)).toEqual([target]);
    expect(res.body.pagination.totalItems).toBe(1);
    expect(typeof res.body.pagination.totalItems).toBe('number');
  });

  it('treats a typed % as a literal rather than matching every street', async () => {
    const chain = await seedGeoChain({});
    await seedAddress({ chain, street: 'Carrer de Mallorca' });
    await seedAddress({ chain, street: 'Avinguda Diagonal' });

    const res = await request(app).get('/api/addresses/search?query=%25').expect(200);
    expect(res.body.addresses).toEqual([]);
  });

  it('also matches addresses in a place whose NAME is the term', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const inCity = await seedAddress({ chain, street: 'Avinguda Diagonal' });

    const res = await request(app).get('/api/addresses/search?query=Barcelona').expect(200);
    expect(res.body.addresses.map((a: { id: string }) => a.id)).toEqual([inCity]);
  });

  it('matches on the REGION name and on the NEIGHBORHOOD name', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', regionName: 'Catalonia' });
    const gracia = await seedNeighborhood({ cityId: chain.cityId, name: 'Gràcia' });
    const elsewhere = await seedGeoChain({
      countryCode: 'PT',
      countryName: 'Portugal',
      regionName: 'Lisbon',
      cityName: 'Lisbon',
    });
    const inCatalonia = await seedAddress({ chain, street: 'Avinguda Diagonal' });
    const inGracia = await seedAddress({ chain, street: 'Carrer Gran', neighborhoodId: gracia });
    await seedAddress({ chain: elsewhere, street: 'Rua Augusta' });

    const byRegion = await request(app).get('/api/addresses/search?query=catalonia').expect(200);
    expect(byRegion.body.addresses.map((a: { id: string }) => a.id).sort()).toEqual(
      [inCatalonia, inGracia].sort(),
    );

    const byNeighborhood = await request(app).get('/api/addresses/search?query=gràcia').expect(200);
    expect(byNeighborhood.body.addresses.map((a: { id: string }) => a.id)).toEqual([inGracia]);
  });

  it('ORs the street and geo matches — a street-only hit is never dropped', async () => {
    // The row that matches ONLY on `street`, in a city the term does not name.
    const elsewhere = await seedGeoChain({
      countryCode: 'PT',
      countryName: 'Portugal',
      regionName: 'Lisbon',
      cityName: 'Lisbon',
    });
    const streetOnly = await seedAddress({ chain: elsewhere, street: 'Travessa de Barcelona' });
    // The row that matches ONLY on geo, whose street says nothing about the term.
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const geoOnly = await seedAddress({ chain, street: 'Avinguda Diagonal' });

    const res = await request(app).get('/api/addresses/search?query=Barcelona').expect(200);

    // Both, or the OR has quietly become an AND — or a join, which drops the
    // street-only row for exactly the same reason.
    expect(res.body.addresses.map((a: { id: string }) => a.id).sort()).toEqual(
      [streetOnly, geoOnly].sort(),
    );
    expect(res.body.pagination.totalItems).toBe(2);
  });

  it('400s without a query', async () => {
    await request(app).get('/api/addresses/search').expect(400);
  });
});

describe('POST /api/addresses', () => {
  const BODY = {
    street: 'Carrer de Mallorca',
    number: '401',
    postal_code: '08013',
    city: 'Barcelona',
    state: 'Catalonia',
    country: 'Spain',
    countryCode: 'ES',
    coordinates: { type: 'Point', coordinates: [2.1734, 41.3851] },
  };

  it('resolves the geo chain and dedupes the building', async () => {
    const first = await request(app).post('/api/addresses').send(BODY).expect(201);
    const second = await request(app).post('/api/addresses').send(BODY).expect(201);

    expect(second.body.address.id).toBe(first.body.address.id);
    const rows = await getDb().select({ id: addresses.id }).from(addresses);
    expect(rows).toHaveLength(1);
  });

  it('400s without coordinates, which the table cannot represent', async () => {
    const res = await request(app)
      .post('/api/addresses')
      .send({ ...BODY, coordinates: undefined })
      .expect(400);
    expect(res.body.message).toMatch(/Coordinates are required/);
  });

  it('400s without street, city or country', async () => {
    await request(app).post('/api/addresses').send({ ...BODY, street: undefined }).expect(400);
    await request(app).post('/api/addresses').send({ ...BODY, city: undefined }).expect(400);
  });
});

describe('PUT /api/addresses/:id', () => {
  // WHO may write is `addressWriteAuthorization.test.ts`'s subject. What is left
  // here is the SHAPE of the request: which keys the handler reads at all, and
  // that geo is never among them.
  it('refuses the identity fields and never spreads the body', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona' });
    const other = await seedGeoChain({ countryCode: 'PT', countryName: 'Portugal', regionName: 'Lisbon', cityName: 'Lisbon' });
    const addressId = await seedAddress({ chain, street: 'Carrer de Mallorca' });

    // `street` and `floor` re-key the place, so this is a merge PROPOSAL and not
    // an edit (ADR 0001 §8.1) — refused here, and taken by
    // `POST /api/addresses/:id/corrections`.
    await request(app)
      .put(`/api/addresses/${addressId}`)
      .send({
        street: 'Carrer del Consell de Cent',
        floor: '3',
        cityId: other.cityId,
        countryCode: 'PT',
        normalizedKey: 'forged',
        id: 'forged',
      })
      .expect(400);

    const [row] = await getDb().select().from(addresses).where(eq(addresses.id, addressId));
    expect(row.street).toBe('Carrer de Mallorca');
    expect(row.floor).toBeNull();
    // Geo is resolved at creation time and `req.body` is never spread into an
    // update, so none of the three forged keys lands either.
    expect(row.cityId).toBe(chain.cityId);
    expect(row.countryCode).toBe('ES');
    expect(row.id).toBe(addressId);
  });

  it('serves an empty patch as the read it is, without a session', async () => {
    const chain = await seedGeoChain({});
    const addressId = await seedAddress({ chain, street: 'Carrer de Mallorca' });

    // A PUT that writes nothing needs no authority, because a GET of the same
    // row answers the same body — and the response is built for the audience a
    // GET would be, so it carries neither the level nor the dwelling.
    const res = await request(app).put(`/api/addresses/${addressId}`).send({}).expect(200);
    expect(res.body.address.street).toBe('Carrer de Mallorca');
    // A STREET row publishes its own id and level — the reduction is not
    // unconditional, it withholds what is INSIDE a building.
    expect(res.body.address.addressLevel).toBe('STREET');
    expect(res.body.address).not.toHaveProperty('floor');
  });

  it('404s for an unknown address', async () => {
    await request(app).put(`/api/addresses/${'0'.repeat(24)}`).send({}).expect(404);
  });
});

describe('DELETE /api/addresses/:id', () => {
  it('does not exist — a place is never deleted, only merged', async () => {
    // ADR 0001 §2.1.7. The route is gone rather than guarded, because a
    // canonical address is the permanent identity of a dwelling and eleven of
    // the twelve columns that can point at one REFUSE a delete. The
    // never-orphaned half is in `addressWriteAuthorization.test.ts`.
    const chain = await seedGeoChain({});
    const addressId = await seedAddress({ chain });

    await request(app).delete(`/api/addresses/${addressId}`).expect(404);

    const rows = await getDb().select().from(addresses).where(eq(addresses.id, addressId));
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/addresses/nearby', () => {
  it('returns addresses within the radius, nearest first', async () => {
    const chain = await seedGeoChain({});
    // Barcelona city centre, ~1.3 km away, and ~9 km away.
    const near = await seedAddress({ chain, street: 'Near', longitude: 2.1734, latitude: 41.3851 });
    const mid = await seedAddress({ chain, street: 'Mid', longitude: 2.19, latitude: 41.3851 });
    const far = await seedAddress({ chain, street: 'Far', longitude: 2.28, latitude: 41.3851 });

    const res = await request(app)
      .get('/api/addresses/nearby?lat=41.3851&lng=2.1734&radius=5000')
      .expect(200);

    // The far one is outside the radius; the two inside come back in distance
    // order, which is the assertion a "some rows came back" check would miss.
    expect(res.body.addresses.map((a: { id: string }) => a.id)).toEqual([near, mid]);
    expect(res.body.addresses.map((a: { id: string }) => a.id)).not.toContain(far);
  });

  it('400s without coordinates', async () => {
    await request(app).get('/api/addresses/nearby').expect(400);
    await request(app).get('/api/addresses/nearby?lat=abc&lng=def').expect(400);
  });
});
