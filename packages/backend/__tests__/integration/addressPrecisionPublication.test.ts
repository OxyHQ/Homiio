/**
 * A dwelling's floor and door reach only a caller with a recorded relation to
 * it — ADR 0003 §3 (the precision ladder), §4.1 (a serializer takes an explicit
 * audience), §5.1 (a review is filed at a unit and published at the building)
 * and §10.1 (permission is a relationship in the database) — against a REAL
 * Postgres and the REAL routers.
 *
 * The leak this pins is F1/F2 in that ADR: `GET /api/addresses/:id`, the
 * address search and lookup, and the public `GET /api/reviews/address/:id`
 * published `floor`, `unit`, `subunit`, the free-form address text, the
 * unit-keyed `normalizedKey`, an exact coordinate and the UNIT row's own id to
 * anybody. #496 closed the listing half; these are the address surfaces it
 * explicitly left open.
 *
 * Four properties of the suite are what let it fail:
 *
 *  - **The dwelling detail is SENTINEL text** (`FLOOR-7Q`, `DOOR-9Z`, …) and
 *    every sweep reads the WHOLE serialized body, so a copy under a key nobody
 *    thought of — a free-form address line, a nested echo — is still found. The
 *    unit row's ID is swept the same way, because an id is the handle that names
 *    one household even when no label is attached to it.
 *  - **Every sweep is floored** on the thing actually being in the body, with
 *    its street: a response that 404'd, or that silently dropped the address,
 *    would otherwise pass every "the unit is absent" assertion.
 *  - **Both directions.** The listing owner, the tenant on an active lease and
 *    the review's own author must still be served what the ADR gives them. A
 *    serializer that withheld the unit from everybody would pass the negative
 *    half alone.
 *  - **Relations that must NOT unlock are asserted too** — an expired lease, a
 *    review author on the address routes, and a related caller on the LIST
 *    surfaces. Each is a decision (see `db/addresses/addressAudience.ts`), and a
 *    decision nothing asserts is a comment.
 */

import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { checkPublicPrecisionWithinPolicy } from '@homiio/shared-types';

import addressRoutes from '../../routes/addresses';
import publicRoutes from '../../routes/public';
import reviewRoutes from '../../routes/reviews';
import { findOrCreateAgencyByName } from '../../db/agencies/agencyWrites';
import { getDb } from '../../db/postgres';
import { insertReview } from '../../db/reviews/reviewWrites';
import { addresses, leases, properties, reviews } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { assertFound } from '../helpers/assertFound';
import {
  resetGeoTables,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

/** Owns the listing that advertises the flat. */
const OWNER = 'oxy-addr-owner';
/** Lives there today, on an `active` lease. */
const TENANT = 'oxy-addr-tenant';
/** Lived there once, on a lease that has ended. */
const FORMER_TENANT = 'oxy-addr-former-tenant';
/** Wrote the review about the flat. */
const AUTHOR = 'oxy-addr-author';
/** Wrote the review about the BUILDING, which is nobody's flat. */
const NEIGHBOUR = 'oxy-addr-neighbour';
/** Signed in, and nothing else. */
const STRANGER = 'oxy-addr-stranger';

/** Carrer de Verdi, Gràcia — with more decimals than any published rung allows. */
const POINT = { longitude: 2.1568123, latitude: 41.4031287 };

/** Text that must never reach a caller with no relation to the dwelling. */
const SECRETS = {
  floor: 'FLOOR-7Q',
  unit: 'DOOR-9Z',
  subunit: 'SUB-4X',
  addressLine: 'LINE-3r-2a',
  poBox: 'POBOX-881',
  reference: 'REF-UNIT-9Z',
  extras: 'EXTRA-3r-2a',
} as const;

const STREET = 'Carrer de la Precisio';
const NUMBER = '42';
const POSTAL_CODE = '08012';

/** Keys that name the dwelling INSIDE the building, or the hash keyed on one. */
const DWELLING_ADDRESS_KEYS = [
  'floor',
  'unit',
  'subunit',
  'address_lines',
  'po_box',
  'reference',
  'extras',
  'normalizedKey',
] as const;

function withSession(oxyUserId: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  };
}

/** The address router, exactly as `routes/index.ts` mounts it behind the session. */
function addressApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use(withSession(oxyUserId));
  app.use('/api/addresses', addressRoutes);
  app.use(errorHandler);
  return app;
}

/** The PUBLIC router, exactly as `server.ts` mounts it: optional session, no auth. */
function publicApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(withSession(oxyUserId));
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

/** The authenticated review router. */
function reviewApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use(withSession(oxyUserId));
  app.use('/api/reviews', reviewRoutes());
  app.use(errorHandler);
  return app;
}

interface Seeded {
  chain: GeoChain;
  buildingId: string;
  unitId: string;
  listingId: string;
  unitReviewId: string;
  buildingReviewId: string;
  agencySlug: string;
}

async function seed(): Promise<Seeded> {
  const chain = await seedGeoChain({ cityName: `Precisio ${Date.now()}`, countryCode: 'ES' });
  const db = getDb();

  const [building] = await db
    .insert(addresses)
    .values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      cityId: chain.cityId,
      countryCode: 'ES',
      street: STREET,
      postalCode: POSTAL_CODE,
      number: NUMBER,
      longitude: POINT.longitude,
      latitude: POINT.latitude,
    })
    .returning({ id: addresses.id });

  const [unit] = await db
    .insert(addresses)
    .values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      cityId: chain.cityId,
      countryCode: 'ES',
      street: STREET,
      postalCode: POSTAL_CODE,
      number: NUMBER,
      floor: SECRETS.floor,
      unit: SECRETS.unit,
      subunit: SECRETS.subunit,
      addressLines: [SECRETS.addressLine],
      poBox: SECRETS.poBox,
      reference: SECRETS.reference,
      extras: { note: SECRETS.extras },
      longitude: POINT.longitude,
      latitude: POINT.latitude,
      parentAddressId: building.id,
    })
    .returning({ id: addresses.id });

  const listingId = await seedProperty({
    addressId: unit.id,
    overrides: { oxyUserId: OWNER, title: 'Corner flat', floor: 3 },
  });

  const agency = await findOrCreateAgencyByName(`Precisio Agency ${Date.now()}`);
  assertFound(agency, 'agency');

  // A UNIT review — the one §5.1 publishes at the building — and a BUILDING one
  // beside it, so a serializer that reduced everything unconditionally cannot
  // pass: the building review must keep naming its own place.
  const unitReview = await insertReview(db, {
    addressId: unit.id,
    addressLevel: 'UNIT',
    streetLevelId: building.id,
    buildingLevelId: building.id,
    unitLevelId: unit.id,
    oxyUserId: AUTHOR,
    agencyId: agency.id,
    title: 'Two winters in this flat',
    price: 1000,
    currency: 'EUR',
    livedFrom: new Date('2023-01-15T00:00:00.000Z'),
    livedTo: new Date('2024-02-15T00:00:00.000Z'),
    rating: 4,
    recommendation: true,
    opinion: 'Lived here a while — a reasonable opinion string.',
  });

  const buildingReview = await insertReview(db, {
    addressId: building.id,
    addressLevel: 'BUILDING',
    streetLevelId: building.id,
    buildingLevelId: building.id,
    unitLevelId: null,
    oxyUserId: NEIGHBOUR,
    agencyId: agency.id,
    title: 'The stairwell and the lift',
    price: 900,
    currency: 'EUR',
    livedFrom: new Date('2022-01-15T00:00:00.000Z'),
    livedTo: new Date('2023-02-15T00:00:00.000Z'),
    rating: 3,
    recommendation: false,
    opinion: 'The building itself, rather than any one flat in it.',
  });

  // The tenancy that unlocks, and the one that does not. Two listings, because
  // `leases_term_range_gist` refuses two overlapping tenancies on one.
  const formerListingId = await seedProperty({
    addressId: unit.id,
    overrides: { oxyUserId: OWNER, title: 'Corner flat (earlier ad)' },
  });
  await db.insert(leases).values([
    {
      propertyId: listingId,
      landlordOxyUserId: OWNER,
      tenantOxyUserId: TENANT,
      leaseTermsStartDate: new Date('2025-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 1000,
      status: 'active',
    },
    {
      propertyId: formerListingId,
      landlordOxyUserId: OWNER,
      tenantOxyUserId: FORMER_TENANT,
      leaseTermsStartDate: new Date('2019-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2021-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
      status: 'expired',
    },
  ]);

  return {
    chain,
    buildingId: building.id,
    unitId: unit.id,
    listingId,
    unitReviewId: unitReview.id,
    buildingReviewId: buildingReview.id,
    agencySlug: agency.slug,
  };
}

/** Every object anywhere in a body that carries this address's street. */
function addressBodiesIn(body: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.street === STREET) found.push(record);
    Object.values(record).forEach(walk);
  };
  walk(body);
  return found;
}

/**
 * The reduced half: the place IS in the body (the vacuity floor), and nothing
 * that names the dwelling inside it is.
 */
function expectPublishedAtBuilding(body: unknown, unitAddressId: string, where: string): void {
  const bodies = addressBodiesIn(body);
  if (bodies.length === 0) throw new Error(`${where}: no address carrying "${STREET}" is in the response`);

  for (const address of bodies) {
    // The floor, not the assertion: street and number are tier C and stay.
    expect({ where, street: address.street, number: address.number }).toEqual({
      where,
      street: STREET,
      number: NUMBER,
    });
    for (const key of DWELLING_ADDRESS_KEYS) {
      expect({ where, key, present: key in address }).toEqual({ where, key, present: false });
    }
    const [lng, lat] = (address.coordinates as { coordinates: [number, number] }).coordinates;
    expect({ where, rounded: checkPublicPrecisionWithinPolicy({ lat, lng }, 'building').ok }).toEqual({
      where,
      rounded: true,
    });
  }

  // The whole body, not the keys named above: a copy under a key nobody thought
  // of is still a copy. The unit's id is swept with the labels — it is the
  // handle that names one household.
  const serialized = JSON.stringify(body);
  for (const secret of Object.values(SECRETS)) {
    expect({ where, leaked: serialized.includes(secret) ? secret : null }).toEqual({ where, leaked: null });
  }
  expect({ where, unitIdInBody: serialized.includes(unitAddressId) }).toEqual({ where, unitIdInBody: false });
}

/** The related half: every stored detail is served. */
function expectExact(body: unknown, unitAddressId: string, where: string): void {
  const bodies = addressBodiesIn(body);
  if (bodies.length === 0) throw new Error(`${where}: no address carrying "${STREET}" is in the response`);
  for (const address of bodies) {
    expect({
      where,
      id: address.id,
      floor: address.floor,
      unit: address.unit,
      subunit: address.subunit,
    }).toEqual({
      where,
      id: unitAddressId,
      floor: SECRETS.floor,
      unit: SECRETS.unit,
      subunit: SECRETS.subunit,
    });
    expect({ where, lng: (address.coordinates as { coordinates: number[] }).coordinates[0] }).toEqual({
      where,
      lng: POINT.longitude,
    });
  }
}

let seeded: Seeded;

beforeEach(async () => {
  await getDb().delete(leases);
  await getDb().delete(reviews);
  await resetGeoTables();
  seeded = await seed();
});

describe('the address surfaces publish the building and withhold the dwelling', () => {
  const cases: Array<[string, (s: Seeded) => string]> = [
    ['GET /api/addresses/:id (the unit itself)', (s) => `/api/addresses/${s.unitId}`],
    ['GET /api/addresses/search, by street', () => `/api/addresses/search?query=${encodeURIComponent(STREET)}`],
    [
      'GET /api/addresses/nearby',
      () => `/api/addresses/nearby?lat=${POINT.latitude}&lng=${POINT.longitude}&radius=5000&limit=50`,
    ],
  ];

  it.each(cases)('%s, anonymous', async (where, path) => {
    const res = await request(addressApp()).get(path(seeded));
    expect({ where, status: res.status }).toEqual({ where, status: 200 });
    expectPublishedAtBuilding(res.body, seeded.unitId, where);
  });

  it.each(cases)('%s, signed in as somebody else', async (where, path) => {
    const res = await request(addressApp(STRANGER)).get(path(seeded));
    expect({ where, status: res.status }).toEqual({ where, status: 200 });
    expectPublishedAtBuilding(res.body, seeded.unitId, where);
  });

  it('answers a UNIT id with its BUILDING’s id, and with none where no building is recorded', async () => {
    const withParent = await request(addressApp(STRANGER)).get(`/api/addresses/${seeded.unitId}`).expect(200);
    expect(withParent.body.address.id).toBe(seeded.buildingId);
    expect(withParent.body.address).not.toHaveProperty('addressLevel');

    const [orphan] = await getDb()
      .insert(addresses)
      .values({
        countryId: seeded.chain.countryId,
        regionId: seeded.chain.regionId,
        cityId: seeded.chain.cityId,
        countryCode: 'ES',
        street: STREET,
        postalCode: POSTAL_CODE,
        number: NUMBER,
        floor: SECRETS.floor,
        unit: SECRETS.unit,
        longitude: POINT.longitude,
        latitude: POINT.latitude,
      })
      .returning({ id: addresses.id });

    const res = await request(addressApp(STRANGER)).get(`/api/addresses/${orphan.id}`).expect(200);
    expectPublishedAtBuilding(res.body, orphan.id, 'orphan unit');
    expect(res.body.address).not.toHaveProperty('id');
  });

  it('publishes a BUILDING row’s own id and level — the reduction is not unconditional', async () => {
    const res = await request(addressApp(STRANGER)).get(`/api/addresses/${seeded.buildingId}`).expect(200);
    expect(res.body.address.id).toBe(seeded.buildingId);
    expect(res.body.address.addressLevel).toBe('BUILDING');
    expect(res.body.address.number).toBe(NUMBER);
  });

  it('PUT with an empty patch is a read, and answers like one', async () => {
    const res = await request(addressApp(STRANGER)).put(`/api/addresses/${seeded.unitId}`).send({}).expect(200);
    expectPublishedAtBuilding(res.body, seeded.unitId, 'PUT, empty patch');
  });

  it('PUT of one field does not read back the others', async () => {
    const res = await request(addressApp(STRANGER))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ district: 'Gràcia' })
      .expect(200);
    expectPublishedAtBuilding(res.body, seeded.unitId, 'PUT, one field');
    expect(res.body.address.district).toBe('Gràcia');
  });

  it('POST answers the submitter with the row’s own id and no detail they did not send', async () => {
    // The resolver DEDUPES onto the seeded BUILDING row, which is the case that
    // matters: the answer may be a row an ingest wrote.
    const res = await request(addressApp(STRANGER))
      .post('/api/addresses')
      .send({
        street: STREET,
        number: NUMBER,
        postal_code: POSTAL_CODE,
        city: 'Barcelona',
        state: 'Catalonia',
        country: 'Spain',
        countryCode: 'ES',
        coordinates: { type: 'Point', coordinates: [POINT.longitude, POINT.latitude] },
      })
      .expect(201);

    const address = res.body.address as Record<string, unknown>;
    expect(typeof address.id).toBe('string');
    for (const key of DWELLING_ADDRESS_KEYS) {
      expect({ key, present: key in address }).toEqual({ key, present: false });
    }
    const serialized = JSON.stringify(res.body);
    for (const secret of Object.values(SECRETS)) {
      expect({ leaked: serialized.includes(secret) ? secret : null }).toEqual({ leaked: null });
    }
  });
});

describe('a review is filed at the unit and published at the building', () => {
  const cases: Array<[string, (s: Seeded) => string]> = [
    ['GET /api/reviews/address/:unitId', (s) => `/api/reviews/address/${s.unitId}`],
    ['GET /api/reviews/address/:buildingId', (s) => `/api/reviews/address/${s.buildingId}`],
    ['GET /api/agencies/:slug/reviews', (s) => `/api/agencies/${s.agencySlug}/reviews`],
  ];

  it.each(cases)('%s, anonymous', async (where, path) => {
    const res = await request(publicApp()).get(path(seeded));
    expect({ where, status: res.status }).toEqual({ where, status: 200 });
    expectPublishedAtBuilding(res.body, seeded.unitId, where);
  });

  it.each(cases)('%s, signed in as somebody else', async (where, path) => {
    const res = await request(publicApp(STRANGER)).get(path(seeded));
    expect({ where, status: res.status }).toEqual({ where, status: 200 });
    expectPublishedAtBuilding(res.body, seeded.unitId, where);
  });

  it('GET /api/reviews/:id and /api/reviews/user/:oxyUserId reduce for a non-author', async () => {
    const one = await request(reviewApp(STRANGER)).get(`/api/reviews/${seeded.unitReviewId}`).expect(200);
    expectPublishedAtBuilding(one.body, seeded.unitId, 'review detail, stranger');

    // Naming the author in the URL confers nothing: the audience is the SESSION.
    const theirs = await request(reviewApp(STRANGER)).get(`/api/reviews/user/${AUTHOR}`).expect(200);
    expectPublishedAtBuilding(theirs.body, seeded.unitId, 'author feed, stranger');
  });

  it('names the BUILDING as the place the review is published against', async () => {
    const res = await request(publicApp()).get(`/api/reviews/address/${seeded.unitId}`).expect(200);
    const [review] = res.body.unitReviews as Record<string, unknown>[];
    expect(review.addressId).toBe(seeded.buildingId);
    expect(review.buildingLevelId).toBe(seeded.buildingId);
    expect(review.addressLevel).toBe('BUILDING');
    expect('unitLevelId' in review).toBe(false);
    expect((review.populatedAddress as Record<string, unknown>).id).toBe(seeded.buildingId);
    // The vacuity floor for this one: the review really is in the response.
    expect(review.id).toBe(seeded.unitReviewId);
    expect(res.body.totalReviews).toBe(1);
  });

  it('leaves a BUILDING-level review naming its own place', async () => {
    const res = await request(publicApp()).get(`/api/reviews/address/${seeded.buildingId}`).expect(200);
    const [review] = res.body.buildingReviews as Record<string, unknown>[];
    expect(review.id).toBe(seeded.buildingReviewId);
    expect(review.addressId).toBe(seeded.buildingId);
    expect(review.addressLevel).toBe('BUILDING');
  });

  it('serves the AUTHOR their own review exactly as they filed it', async () => {
    const res = await request(reviewApp(AUTHOR)).get(`/api/reviews/${seeded.unitReviewId}`).expect(200);
    expectExact(res.body, seeded.unitId, 'review detail, author');
    expect(res.body.review.addressId).toBe(seeded.unitId);
    expect(res.body.review.unitLevelId).toBe(seeded.unitId);
    expect(res.body.review.addressLevel).toBe('UNIT');

    const mine = await request(reviewApp(AUTHOR)).get(`/api/reviews/user/${AUTHOR}`).expect(200);
    expectExact(mine.body, seeded.unitId, 'own feed, author');
  });

  it('gives the author nothing on the ADDRESS routes — filing a review is self-service', async () => {
    const res = await request(addressApp(AUTHOR)).get(`/api/addresses/${seeded.unitId}`).expect(200);
    expectPublishedAtBuilding(res.body, seeded.unitId, 'address detail, review author');
  });
});

describe('a recorded relation to the dwelling, and what it is worth', () => {
  it('serves the listing OWNER every stored detail', async () => {
    const res = await request(addressApp(OWNER)).get(`/api/addresses/${seeded.unitId}`).expect(200);
    expectExact(res.body, seeded.unitId, 'address detail, listing owner');
    expect(res.body.address.addressLevel).toBe('UNIT');
    expect(res.body.address.po_box).toBe(SECRETS.poBox);
  });

  it('serves the TENANT on an active lease every stored detail', async () => {
    const res = await request(addressApp(TENANT)).get(`/api/addresses/${seeded.unitId}`).expect(200);
    expectExact(res.body, seeded.unitId, 'address detail, active tenant');
  });

  it('withholds it from a tenant whose lease has ENDED', async () => {
    const res = await request(addressApp(FORMER_TENANT)).get(`/api/addresses/${seeded.unitId}`).expect(200);
    expectPublishedAtBuilding(res.body, seeded.unitId, 'address detail, former tenant');
  });

  it('withholds it once the owner’s listing is withdrawn', async () => {
    await getDb()
      .update(properties)
      .set({ deletedAt: new Date() })
      .where(eq(properties.addressId, seeded.unitId));
    await getDb().delete(leases);

    const res = await request(addressApp(OWNER)).get(`/api/addresses/${seeded.unitId}`).expect(200);
    expectPublishedAtBuilding(res.body, seeded.unitId, 'address detail, withdrawn listing');
  });

  it('never escalates the LIST surfaces, not even for the owner or the tenant', async () => {
    for (const [who, viewer] of [
      ['owner', OWNER],
      ['tenant', TENANT],
    ] as const) {
      const search = await request(addressApp(viewer))
        .get(`/api/addresses/search?query=${encodeURIComponent(STREET)}`)
        .expect(200);
      expectPublishedAtBuilding(search.body, seeded.unitId, `search, ${who}`);

      const nearby = await request(addressApp(viewer))
        .get(`/api/addresses/nearby?lat=${POINT.latitude}&lng=${POINT.longitude}&radius=5000&limit=50`)
        .expect(200);
      expectPublishedAtBuilding(nearby.body, seeded.unitId, `nearby, ${who}`);
    }
  });

  it('matches the session, never an id the caller supplied', async () => {
    // The stranger names the owner every way the wire allows. None of them is
    // the session, so none of them is the audience.
    const byQuery = await request(addressApp(STRANGER))
      .get(`/api/addresses/${seeded.unitId}?oxyUserId=${OWNER}&userId=${OWNER}`)
      .expect(200);
    expectPublishedAtBuilding(byQuery.body, seeded.unitId, 'address detail, owner id in the query');

    const byBody = await request(addressApp(STRANGER))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ oxyUserId: OWNER, userId: OWNER })
      .expect(200);
    expectPublishedAtBuilding(byBody.body, seeded.unitId, 'address PUT, owner id in the body');
  });
});
