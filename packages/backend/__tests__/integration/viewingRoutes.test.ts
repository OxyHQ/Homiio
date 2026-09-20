/**
 * Are the viewing handlers actually REACHABLE? (#518 §7.5) Against the REAL
 * Postgres and the REAL routers.
 *
 * ## The defect this exists to catch, which no handler test could
 *
 * `viewingController.createViewingRequest` and `listPropertyViewingRequests`
 * were mounted NOWHERE. `routes/properties.ts` contained no `viewings` string
 * at all, while `packages/frontend/services/viewingService.ts` had been posting
 * to `/api/properties/:propertyId/viewings` since the screen was written. In
 * production every attempt to arrange a viewing was a 404.
 *
 * The suite was green throughout, because every viewing test built its OWN
 * express app and mounted the handlers onto it by hand — which tests the
 * handler and asserts nothing whatsoever about the application. So this file
 * mounts `routes/index.ts` exactly as `server.ts` does and drives it over HTTP:
 * the assertion is that the PATH resolves, and it fails the moment somebody
 * deletes the mount, whatever the handlers do.
 *
 * The un-mounted path is also asserted directly — a request to a neighbouring
 * path that nothing declares must 404 — so "it answered 201" cannot be an
 * accident of some catch-all.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import apiRoutes from '../../routes';
import { getDb } from '../../db/postgres';
import { viewingRequests } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const OWNER = 'oxy-owner';
const VISITOR = 'oxy-visitor';

/**
 * The authenticated half of the API, mounted the way `server.ts` mounts it.
 *
 * `createOxyAuthMiddleware(oxy)` is stood in for by a middleware that sets the
 * session — the point of this file is the ROUTING table, not the token.
 */
function buildApi(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.use('/api', apiRoutes());
  app.use(errorHandler);
  return app;
}

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

async function seedListing(): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: { oxyUserId: OWNER, status: 'published', isExternal: false },
  });
  return propertyId;
}

/** Tomorrow, in the SERVER's zone — which is how the controller reads it. */
function tomorrow(): string {
  const day = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

beforeEach(async () => {
  await getDb().delete(viewingRequests);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(viewingRequests);
  await resetGeoTables();
});

describe('POST /api/properties/:propertyId/viewings', () => {
  it('is MOUNTED — the request the app has always made now reaches a handler', async () => {
    const propertyId = await seedListing();

    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: tomorrow(), time: '11:00', message: 'Is the boiler new?' });

    expect(res.status).toBe(201);
    expect(res.body.data.propertyId).toBe(propertyId);
    expect(res.body.data.status).toBe('pending');
    // Persisted, not merely answered.
    expect(await getDb().select().from(viewingRequests)).toHaveLength(1);
  });

  it('answers 404 on a path nothing declares, so the 201 above is not a catch-all', async () => {
    const propertyId = await seedListing();
    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings/not-a-route`)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('GET /api/properties/:propertyId/viewings', () => {
  it('is MOUNTED, and scopes a non-owner to their own requests', async () => {
    const propertyId = await seedListing();
    await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: tomorrow(), time: '11:00' });
    await request(buildApi('oxy-somebody-else'))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: tomorrow(), time: '12:00' });

    const owner = await request(buildApi(OWNER)).get(`/api/properties/${propertyId}/viewings`);
    expect(owner.status).toBe(200);
    expect(owner.body.data).toHaveLength(2);

    // The scope IS the authorization: a non-owner sees only their own.
    const visitor = await request(buildApi(VISITOR)).get(`/api/properties/${propertyId}/viewings`);
    expect(visitor.status).toBe(200);
    expect(visitor.body.data).toHaveLength(1);
    expect(visitor.body.data[0].requesterOxyUserId).toBe(VISITOR);
  });
});
