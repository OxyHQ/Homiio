/**
 * `GET /properties/:propertyId/stats` against the REAL Postgres this worker owns.
 *
 * The lease aggregate compared `lease_terms_*` with a `Date` interpolated into a
 * raw `sql` template. postgres-js sends that as `Date#toString()`
 * ("Thu Sep 17 2026 05:59:12 GMT+0000 (Coordinated Universal Time)"), which
 * Postgres refuses as a timestamptz — so the endpoint answered 500 for EVERY
 * listing, with or without leases. A mocked db cannot see this: only a real
 * driver serialises the parameter.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import * as propertyController from '../../controllers/property';
import { asyncHandler, errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(serializeWireIds);
  app.get('/properties/:propertyId/stats', asyncHandler(propertyController.getPropertyStats));
  app.use(errorHandler);
  return app;
}

beforeEach(async () => {
  await resetGeoTables();
});

// Leave the shared tables as this file found them (see leaseOwnership.test.ts).
afterAll(async () => {
  await resetGeoTables();
});

describe('propertyController.getPropertyStats', () => {
  it('answers 200 for a listing with no leases', async () => {
    const { propertyId } = await seedListingWithGeo({});

    const res = await request(buildApp()).get(`/properties/${propertyId}/stats`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ monthlyRevenue: 0, savesCount: 0 });
  });

  it('answers 404 for an unknown listing', async () => {
    const res = await request(buildApp()).get('/properties/no-such-listing/stats');

    expect(res.status).toBe(404);
  });
});
