/**
 * Lease ownership + status-transition enforcement.
 *
 * Uses the real LeaseController instance and Lease/Profile/Property models on
 * the in-memory Mongo, mounted behind a fake-auth middleware. Asserts that a
 * non-party cannot read a lease (403) and that a signed/active lease cannot be
 * updated (409).
 */

import express, { type Express } from 'express';
import request from 'supertest';

import { createProfile, createRentProperty, createLease } from '../helpers/factories';

const leaseController = require('../../controllers/leaseController');
const { errorHandler } = require('../../middlewares/errorHandler');

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
  app.get('/leases/:id', (req, res, next) => leaseController.getLeaseById(req, res, next));
  app.put('/leases/:id', (req, res, next) => leaseController.updateLease(req, res, next));
  app.use(errorHandler);
  return app;
}

async function seedLease(status = 'draft') {
  const landlord = await createProfile('oxy-landlord');
  const tenant = await createProfile('oxy-tenant');
  const property = await createRentProperty({ profileId: landlord._id });
  const lease = await createLease({
    propertyId: property._id,
    landlordProfileId: landlord._id,
    tenantProfileId: tenant._id,
    status,
  });
  return { landlord, tenant, lease };
}

describe('leaseController.getLeaseById', () => {
  it('lets the landlord (a party) read the lease', async () => {
    const { lease } = await seedLease();
    const res = await request(buildApp('oxy-landlord')).get(`/leases/${lease._id}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('lets the tenant (a party) read the lease', async () => {
    const { lease } = await seedLease();
    const res = await request(buildApp('oxy-tenant')).get(`/leases/${lease._id}`);
    expect(res.status).toBe(200);
  });

  it('rejects a non-party with 403', async () => {
    const { lease } = await seedLease();
    await createProfile('oxy-stranger');
    const res = await request(buildApp('oxy-stranger')).get(`/leases/${lease._id}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 404 for a missing lease', async () => {
    await createProfile('oxy-landlord');
    const res = await request(buildApp('oxy-landlord')).get('/leases/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('LEASE_NOT_FOUND');
  });
});

describe('leaseController.updateLease', () => {
  it('lets the landlord update a draft lease', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${lease._id}`)
      .send({ notes: 'updated terms' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects updating a non-draft (active) lease with 409', async () => {
    const { lease } = await seedLease('active');
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${lease._id}`)
      .send({ notes: 'too late' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LEASE_NOT_EDITABLE');
  });

  it('rejects a tenant trying to update the lease with 403', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-tenant'))
      .put(`/leases/${lease._id}`)
      .send({ notes: 'tenant edit' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
