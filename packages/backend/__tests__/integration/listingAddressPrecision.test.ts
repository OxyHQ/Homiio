/**
 * A listing's floor and unit reach only the audience the owner published them
 * to — ADR 0003 §3.2 (`published_precision`) and §4.1 (a serializer takes an
 * explicit audience), against a REAL Postgres and the REAL public router.
 *
 * The leak this pins: the create/edit wizard's floor "Private" toggle was never
 * sent, and every listing endpoint published `floor`, `address.floor`,
 * `address.unit` and `address.subunit` to anybody.
 *
 * Three properties of the suite are what let it fail:
 *
 *  - **The dwelling detail is SENTINEL text** (`FLOOR-7Q`, `DOOR-9Z`, …) and the
 *    sweep reads the whole serialized body, so a leak through a key nobody
 *    thought to name — a free-form address line, a nested copy — is still found.
 *  - **Every sweep is floored** on the listing actually being in the body, with
 *    its street: a response that silently dropped the listing would otherwise
 *    pass every "the unit is absent" assertion.
 *  - **Both directions.** The owner, and a listing published `exact`, must still
 *    receive the unit. A serializer that withheld it from everybody would pass
 *    the negative half alone.
 */

import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';
import {
  checkPublicPrecisionWithinPolicy,
  LISTING_ADDRESS_PRECISIONS,
  OfferingType,
  PropertyStatus,
  PropertyType,
} from '@homiio/shared-types';

import publicRoutes from '../../routes/public';
import { getPropertiesByOwner } from '../../controllers/property/batch';
import { createProperty } from '../../controllers/property/create';
import { getMyProperties } from '../../controllers/property/retrieve';
import { updateProperty } from '../../controllers/property/updateDelete';
import * as recentlyViewedController from '../../controllers/profile/recentlyViewed';
import * as savedPropertiesController from '../../controllers/profile/savedProperties';
import roomController from '../../controllers/roomController';
import { findOrCreateAgencyByName } from '../../db/agencies/agencyWrites';
import { getDb } from '../../db/postgres';
import { findPropertyById } from '../../db/properties/propertyReads';
import { addresses, properties, recentlyViewed, savedItems } from '../../db/schema';
import { trackPropertyView } from '../../db/saved/recentlyViewedRepository';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { assertFound } from '../helpers/assertFound';
import {
  resetGeoTables,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

const OWNER = 'oxy-precision-owner';
const STRANGER = 'oxy-precision-stranger';

/** Carrer de Verdi, Gràcia — with more decimals than any published rung allows. */
const POINT = { longitude: 2.1568123, latitude: 41.4031287 };

/** Text that must never reach a non-owner below `exact`. */
const SECRETS = {
  floor: 'FLOOR-7Q',
  unit: 'DOOR-9Z',
  subunit: 'SUB-4X',
  addressLine: 'LINE-3r-2a',
  poBox: 'POBOX-881',
  reference: 'REF-UNIT-9Z',
} as const;
/** The listing's own floor column, an integer; asserted by key. */
const LISTING_FLOOR = 17;
const STREET = 'Carrer de la Privacitat';
const NUMBER = '42';

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

/** The public router exactly as `server.ts` mounts it, behind an optional session. */
function publicApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(withSession(oxyUserId));
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

/** The authenticated handlers that serve a listing body. */
function authedApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use(withSession(oxyUserId));
  app.post('/properties', createProperty);
  app.put('/properties/:propertyId', updateProperty);
  app.get('/properties/me/list', getMyProperties);
  app.get('/properties/owner/:oxyUserId', getPropertiesByOwner);
  app.get('/recent-properties', (req, res, next) => recentlyViewedController.getRecentProperties(req, res, next));
  app.post('/save-property', (req, res, next) => savedPropertiesController.saveProperty(req, res, next));
  app.get('/saved-properties', (req, res, next) => savedPropertiesController.getSavedProperties(req, res, next));
  app.get('/rooms', (req, res, next) => roomController.getRooms(req, res, next));
  app.get('/rooms/:id', (req, res, next) => roomController.getRoomById(req, res, next));
  app.use(errorHandler);
  return app;
}

interface Seeded {
  chain: GeoChain;
  cityName: string;
  buildingId: string;
  unitId: string;
  orphanUnitId: string;
  /** Default precision, never set — how every pre-existing row looks. */
  privateListing: string;
  /** The owner published the floor and the door. */
  exactListing: string;
  /** Default precision, on a unit with no recorded building. */
  orphanListing: string;
  /** A room listing on the unit, for the `/rooms` reads. */
  room: string;
  agencySlug: string;
}

async function seedUnitAddress(chain: GeoChain, parentAddressId: string | null): Promise<string> {
  const [row] = await getDb()
    .insert(addresses)
    .values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      cityId: chain.cityId,
      countryCode: 'ES',
      street: STREET,
      postalCode: '08012',
      number: NUMBER,
      floor: SECRETS.floor,
      unit: SECRETS.unit,
      subunit: SECRETS.subunit,
      addressLines: [SECRETS.addressLine],
      poBox: SECRETS.poBox,
      reference: SECRETS.reference,
      longitude: POINT.longitude,
      latitude: POINT.latitude,
      parentAddressId,
    })
    .returning({ id: addresses.id });
  return row.id;
}

async function seed(): Promise<Seeded> {
  const cityName = `Privacitat ${Date.now()}`;
  const chain = await seedGeoChain({ cityName, countryCode: 'ES' });
  const [building] = await getDb()
    .insert(addresses)
    .values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      cityId: chain.cityId,
      countryCode: 'ES',
      street: STREET,
      postalCode: '08012',
      number: NUMBER,
      longitude: POINT.longitude,
      latitude: POINT.latitude,
    })
    .returning({ id: addresses.id });
  const unitId = await seedUnitAddress(chain, building.id);
  const orphanUnitId = await seedUnitAddress(chain, null);
  const agency = await findOrCreateAgencyByName(`Precision Agency ${Date.now()}`);
  assertFound(agency, 'agency');

  const listing = (overrides: Parameters<typeof seedProperty>[0]['overrides'] = {}) => ({
    oxyUserId: OWNER,
    title: 'Corner flat',
    type: PropertyType.APARTMENT,
    status: PropertyStatus.PUBLISHED,
    availabilityIsAvailable: true,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRentMonthlyAmount: 1450,
    longTermRentCurrency: 'EUR' as const,
    bedrooms: 2,
    floor: LISTING_FLOOR,
    agencyId: agency.id,
    ...overrides,
  });

  const privateListing = await seedProperty({ addressId: unitId, overrides: listing() });
  const exactListing = await seedProperty({
    addressId: unitId,
    overrides: listing({ addressPublishedPrecision: 'exact', longTermRentMonthlyAmount: 1500 }),
  });
  const orphanListing = await seedProperty({ addressId: orphanUnitId, overrides: listing() });
  const room = await seedProperty({ addressId: unitId, overrides: listing({ type: PropertyType.ROOM }) });

  return {
    chain,
    cityName,
    buildingId: building.id,
    unitId,
    orphanUnitId,
    privateListing,
    exactListing,
    orphanListing,
    room,
    agencySlug: agency.slug,
  };
}

/** Every object in a body whose `id` is `listingId` and that carries an address. */
function listingsIn(body: unknown, listingId: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (record.id === listingId && typeof record.address === 'object') found.push(record);
    Object.values(record).forEach(walk);
  };
  walk(body);
  return found;
}

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

/**
 * The non-owner half: the listing is IN the body (the vacuity floor), and
 * nothing that names the dwelling inside the building is.
 */
function expectPublishedAtBuilding(body: unknown, listingId: string, unitAddressId: string, where: string): void {
  const copies = listingsIn(body, listingId);
  if (copies.length === 0) throw new Error(`${where}: listing ${listingId} is not in the response`);

  for (const copy of copies) {
    const address = copy.address as Record<string, unknown>;
    expect({ where, street: address.street, number: address.number }).toEqual({
      where,
      street: STREET,
      number: NUMBER,
    });
    expect({ where, floor: copy.floor }).toEqual({ where, floor: undefined });
    for (const key of DWELLING_ADDRESS_KEYS) {
      expect({ where, key, present: key in address }).toEqual({ where, key, present: false });
    }
    // The unit row's id would hand the unit back through `/api/addresses/:id`.
    expect({ where, addressId: address.id }).not.toEqual({ where, addressId: unitAddressId });
    const [lng, lat] = (address.coordinates as { coordinates: [number, number] }).coordinates;
    expect({ where, precision: checkPublicPrecisionWithinPolicy({ lat, lng }, 'building').ok }).toEqual({
      where,
      precision: true,
    });
  }
  // Read the listing's WHOLE serialized body, not the keys named above, so a
  // copy under a key nobody thought of is still found. Scoped to this listing
  // because a feed legitimately carries the `exact` fixture beside it.
  const serialized = JSON.stringify(copies);
  for (const secret of Object.values(SECRETS)) {
    expect({ where, leaked: serialized.includes(secret) ? secret : null }).toEqual({ where, leaked: null });
  }
}

/** The owner half, and the `exact` listing's: every stored detail is served. */
function expectExact(body: unknown, listingId: string, where: string): void {
  const copies = listingsIn(body, listingId);
  if (copies.length === 0) throw new Error(`${where}: listing ${listingId} is not in the response`);
  for (const copy of copies) {
    const address = copy.address as Record<string, unknown>;
    expect({ where, floor: copy.floor, unit: address.unit, addressFloor: address.floor, subunit: address.subunit }).toEqual({
      where,
      floor: LISTING_FLOOR,
      unit: SECRETS.unit,
      addressFloor: SECRETS.floor,
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
  await getDb().delete(savedItems);
  await getDb().delete(recentlyViewed);
  await resetGeoTables();
  seeded = await seed();
});

describe('the column and its default', () => {
  it('defaults a row written without the column to `building`, which withholds the unit', async () => {
    // Exactly how the outgoing image and the worker write during the rollout:
    // an INSERT that does not name the column at all.
    const rows = await getDb().execute<{ id: string; precision: string }>(sql`
      insert into properties (id, address_id, offerings, long_term_rent_monthly_amount, long_term_rent_currency)
      values (${'legacy-precision-row'}, ${seeded.unitId}, array['long_term_rent']::text[], 900, 'EUR')
      returning id, address_published_precision as precision
    `);
    expect(rows[0]?.precision).toBe('building');

    const res = await request(publicApp()).get('/api/properties/legacy-precision-row').expect(200);
    expect(res.body.data.address).not.toHaveProperty('unit');
  });

  it('refuses a value outside the ladder at the CHECK', async () => {
    await expect(
      getDb().update(properties)
        .set({ addressPublishedPrecision: 'unit' as never })
        .where(eq(properties.id, seeded.privateListing)),
    ).rejects.toMatchObject({ cause: expect.objectContaining({ code: '23514' }) });
  });

  it('declares the same ladder the shared type does', async () => {
    const rows = await getDb().execute<{ definition: string }>(sql`
      select pg_get_constraintdef(oid) as definition from pg_constraint
      where conname = 'properties_address_published_precision_check'
    `);
    const definition = rows[0]?.definition ?? '';
    expect(definition).not.toBe('');
    for (const precision of LISTING_ADDRESS_PRECISIONS) {
      expect(definition).toContain(`'${precision}'`);
    }
  });
});

describe('every public read path withholds the floor and the unit from a non-owner', () => {
  const cases: Array<[string, (s: Seeded) => string]> = [
    ['GET /api/properties/:id', (s) => `/api/properties/${s.privateListing}`],
    ['GET /api/properties', () => '/api/properties?limit=50'],
    ['GET /api/properties/search', (s) => `/api/properties/search?city=${encodeURIComponent(s.cityName)}&limit=50`],
    ['GET /api/properties/by-ids', (s) => `/api/properties/by-ids?ids=${s.privateListing}`],
    ['GET /api/properties/nearby', () => `/api/properties/nearby?longitude=${POINT.longitude}&latitude=${POINT.latitude}&maxDistance=5000&limit=50`],
    ['GET /api/properties/radius', () => `/api/properties/radius?longitude=${POINT.longitude}&latitude=${POINT.latitude}&radius=5000&limit=50`],
    ['GET /api/properties/:id/area-insights (comparables)', (s) => `/api/properties/${s.exactListing}/area-insights`],
    ['GET /api/home/sections', (s) => `/api/home/sections?loc=city.homiio.${s.chain.cityId}&offering=long_term_rent`],
    ['GET /api/cities/:id/properties', (s) => `/api/cities/${s.chain.cityId}/properties?limit=50`],
    ['GET /api/agencies/:slug/properties', (s) => `/api/agencies/${s.agencySlug}/properties?limit=50`],
  ];

  it.each(cases)('%s, anonymous', async (where, path) => {
    const res = await request(publicApp()).get(path(seeded));
    expect({ where, status: res.status }).toEqual({ where, status: 200 });
    expectPublishedAtBuilding(res.body, seeded.privateListing, seeded.unitId, where);
  });

  it.each(cases)('%s, signed in as somebody else', async (where, path) => {
    const res = await request(publicApp(STRANGER)).get(path(seeded));
    expect({ where, status: res.status }).toEqual({ where, status: 200 });
    expectPublishedAtBuilding(res.body, seeded.privateListing, seeded.unitId, where);
  });

  it('publishes the building id in place of the unit id, and no id when there is no building', async () => {
    const withParent = await request(publicApp()).get(`/api/properties/${seeded.privateListing}`).expect(200);
    expect(withParent.body.data.address.id).toBe(seeded.buildingId);
    expect(withParent.body.data.address).not.toHaveProperty('addressLevel');

    const orphan = await request(publicApp()).get(`/api/properties/${seeded.orphanListing}`).expect(200);
    expectPublishedAtBuilding(orphan.body, seeded.orphanListing, seeded.orphanUnitId, 'orphan unit');
    expect(orphan.body.data.address).not.toHaveProperty('id');
  });

  it('withholds the number too when the advertiser hid it', async () => {
    await getDb().update(properties).set({ showAddressNumber: false }).where(eq(properties.id, seeded.privateListing));
    const res = await request(publicApp()).get(`/api/properties/${seeded.privateListing}`).expect(200);
    const address = res.body.data.address as Record<string, unknown>;
    expect(address.street).toBe(STREET);
    expect(address).not.toHaveProperty('number');
    expect(address).not.toHaveProperty('id');
    const [lng, lat] = (address.coordinates as { coordinates: [number, number] }).coordinates;
    expect(checkPublicPrecisionWithinPolicy({ lat, lng }, 'street').ok).toBe(true);
  });
});

describe('the authenticated reads a non-owner can reach', () => {
  it('GET /properties/owner/:oxyUserId — naming the owner in the URL confers nothing', async () => {
    const res = await request(authedApp(STRANGER)).get(`/properties/owner/${OWNER}?limit=50`).expect(200);
    expectPublishedAtBuilding(res.body, seeded.privateListing, seeded.unitId, 'owner feed, stranger');
    // Not even for the owner: the id is a URL parameter, not the session.
    const own = await request(authedApp(OWNER)).get(`/properties/owner/${OWNER}?limit=50`).expect(200);
    expectPublishedAtBuilding(own.body, seeded.privateListing, seeded.unitId, 'owner feed, owner');
  });

  it('saved properties', async () => {
    await request(authedApp(STRANGER)).post('/save-property').send({ propertyId: seeded.privateListing }).expect(200);
    const res = await request(authedApp(STRANGER)).get('/saved-properties').expect(200);
    expectPublishedAtBuilding(res.body, seeded.privateListing, seeded.unitId, 'saved');
  });

  it('recently viewed', async () => {
    await trackPropertyView(getDb(), STRANGER, seeded.privateListing);
    const res = await request(authedApp(STRANGER)).get('/recent-properties').expect(200);
    expectPublishedAtBuilding(res.body, seeded.privateListing, seeded.unitId, 'recently viewed');
  });

  it('GET /rooms and GET /rooms/:id', async () => {
    const list = await request(authedApp(STRANGER)).get('/rooms?limit=50').expect(200);
    expectPublishedAtBuilding(list.body, seeded.room, seeded.unitId, 'rooms feed');
    const one = await request(authedApp(STRANGER)).get(`/rooms/${seeded.room}`).expect(200);
    expectPublishedAtBuilding(one.body, seeded.room, seeded.unitId, 'room detail');
  });
});

describe('the owner, and a listing published exact', () => {
  it('serves the owner every stored detail on the public detail route, uncacheable', async () => {
    const res = await request(publicApp(OWNER)).get(`/api/properties/${seeded.privateListing}`).expect(200);
    expectExact(res.body, seeded.privateListing, 'detail, owner');
    expect(res.body.data.address.id).toBe(seeded.unitId);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.data.addressPublishedPrecision).toBe('building');
  });

  it('serves the owner every stored detail on their own list and their own room', async () => {
    const mine = await request(authedApp(OWNER)).get('/properties/me/list?limit=50').expect(200);
    expectExact(mine.body, seeded.privateListing, 'my list');
    const room = await request(authedApp(OWNER)).get(`/rooms/${seeded.room}`).expect(200);
    expectExact(room.body, seeded.room, 'room, owner');
  });

  it('serves a listing published `exact` to anybody', async () => {
    const res = await request(publicApp()).get(`/api/properties/${seeded.exactListing}`).expect(200);
    expectExact(res.body, seeded.exactListing, 'exact listing, anonymous');
    expect(res.headers['cache-control']).toBeUndefined();
  });
});

describe('create and update persist the owner’s choice', () => {
  function createBody(extra: Record<string, unknown> = {}) {
    return {
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms: 1,
      floor: 3,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
      addressId: seeded.unitId,
      status: PropertyStatus.PUBLISHED,
      ...extra,
    };
  }

  it('stores `building` when the body does not choose, and serves the 201 at exact to its owner', async () => {
    const res = await request(authedApp(OWNER)).post('/properties').send(createBody()).expect(201);
    const stored = await findPropertyById(res.body.data.id);
    assertFound(stored, 'created');
    expect(stored.property.addressPublishedPrecision).toBe('building');
    expect(res.body.data.floor).toBe(3);
    expect(res.body.data.address.unit).toBe(SECRETS.unit);

    const publicRead = await request(publicApp()).get(`/api/properties/${res.body.data.id}`).expect(200);
    expect(publicRead.body.data).not.toHaveProperty('floor');
  });

  it('stores `exact` when the owner publishes the floor, and the public read then carries it', async () => {
    const res = await request(authedApp(OWNER))
      .post('/properties')
      .send(createBody({ addressPublishedPrecision: 'exact' }))
      .expect(201);
    const stored = await findPropertyById(res.body.data.id);
    assertFound(stored, 'created');
    expect(stored.property.addressPublishedPrecision).toBe('exact');
    const publicRead = await request(publicApp()).get(`/api/properties/${res.body.data.id}`).expect(200);
    expect(publicRead.body.data.floor).toBe(3);
    expect(publicRead.body.data.address.unit).toBe(SECRETS.unit);
  });

  it('refuses a precision outside the ladder with a 400, not a constraint 500', async () => {
    const res = await request(authedApp(OWNER))
      .post('/properties')
      .send(createBody({ addressPublishedPrecision: 'unit' }));
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_ADDRESS_PRECISION');
  });

  it('changes the choice on update, both ways, and only for the owner', async () => {
    const intruder = await request(authedApp(STRANGER))
      .put(`/properties/${seeded.privateListing}`)
      .send({ addressPublishedPrecision: 'exact' });
    expect(intruder.status).toBe(404);
    const untouched = await findPropertyById(seeded.privateListing);
    assertFound(untouched, 'untouched');
    expect(untouched.property.addressPublishedPrecision).toBe('building');

    await request(authedApp(OWNER))
      .put(`/properties/${seeded.privateListing}`)
      .send({ addressPublishedPrecision: 'exact' })
      .expect(200);
    const opened = await request(publicApp()).get(`/api/properties/${seeded.privateListing}`).expect(200);
    expect(opened.body.data.address.unit).toBe(SECRETS.unit);

    await request(authedApp(OWNER))
      .put(`/properties/${seeded.exactListing}`)
      .send({ addressPublishedPrecision: 'building' })
      .expect(200);
    const closed = await request(publicApp()).get(`/api/properties/${seeded.exactListing}`).expect(200);
    expectPublishedAtBuilding(closed.body, seeded.exactListing, seeded.unitId, 'after closing');
  });
});
