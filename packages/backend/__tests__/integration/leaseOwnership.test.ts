/**
 * Lease ownership enforcement (session oxyUserId model).
 */

import express, { type Express } from 'express';
import request from 'supertest';

import { createRentProperty, createLease } from '../helpers/factories';

const leaseController = require('../../controllers/leaseController');
const { Lease } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.post('/leases', (req, res, next) => leaseController.createLease(req, res, next));
  app.get('/leases/:id', (req, res, next) => leaseController.getLeaseById(req, res, next));
  app.put('/leases/:id', (req, res, next) => leaseController.updateLease(req, res, next));
  app.post('/leases/:id/sign', (req, res, next) => leaseController.signLease(req, res, next));
  app.post('/leases/:id/documents', (req, res, next) => leaseController.uploadLeaseDocument(req, res, next));
  app.use(errorHandler);
  return app;
}

async function seedLease(status = 'draft') {
  const property = await createRentProperty({ oxyUserId: 'oxy-landlord' });
  const lease = await createLease({
    propertyId: property._id,
    landlordOxyUserId: 'oxy-landlord',
    tenantOxyUserId: 'oxy-tenant',
    status,
  });
  return { lease };
}

describe('leaseController.getLeaseById', () => {
  it('lets the landlord read the lease', async () => {
    const { lease } = await seedLease();
    const res = await request(buildApp('oxy-landlord')).get(`/leases/${lease._id}`);
    expect(res.status).toBe(200);
  });

  it('rejects a non-party with 403', async () => {
    const { lease } = await seedLease();
    const res = await request(buildApp('oxy-stranger')).get(`/leases/${lease._id}`);
    expect(res.status).toBe(403);
  });
});

describe('leaseController.updateLease', () => {
  it('lets the landlord update a draft lease', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${lease._id}`)
      .send({ notes: 'updated terms' });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('updated terms');
  });

  it('rejects a tenant update with 403', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-tenant'))
      .put(`/leases/${lease._id}`)
      .send({ notes: 'tenant edit' });
    expect(res.status).toBe(403);
  });
});

describe('leaseController.createLease', () => {
  it('creates a draft lease with server-resolved landlord', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-landlord' });
    const now = new Date();
    const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const res = await request(buildApp('oxy-landlord')).post('/leases').send({
      propertyId: property._id,
      tenantOxyUserId: 'oxy-tenant',
      leaseTerms: { startDate: now, endDate: end },
      rentDetails: { monthlyRent: 1200, currency: 'EUR' },
    });
    expect(res.status).toBe(201);
    const persisted = await Lease.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.landlordOxyUserId).toBe('oxy-landlord');
    expect(persisted.status).toBe('draft');
  });

  it('rejects create for property the requester does not own', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-landlord' });
    const now = new Date();
    const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const res = await request(buildApp('oxy-stranger')).post('/leases').send({
      propertyId: property._id,
      tenantOxyUserId: 'oxy-tenant',
      leaseTerms: { startDate: now, endDate: end },
      rentDetails: { monthlyRent: 1200, currency: 'EUR' },
    });
    expect(res.status).toBe(403);
  });
});

describe('leaseController.signLease', () => {
  it('records tenant signature', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${lease._id}/sign`)
      .send({ acceptTerms: true });
    expect(res.status).toBe(200);
    const persisted = await Lease.findById(lease._id);
    expect(persisted.signatures.tenant.signed).toBe(true);
  });
});

describe('leaseController.uploadLeaseDocument', () => {
  it('stores server-resolved uploadedBy', async () => {
    const { lease } = await seedLease('active');
    const res = await request(buildApp('oxy-landlord'))
      .post(`/leases/${lease._id}/documents`)
      .send({
        name: 'Signed agreement',
        url: 'https://files.example.com/lease.pdf',
        type: 'lease_agreement',
        uploadedBy: 'oxy-tenant',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.uploadedBy).toBe('oxy-landlord');
  });
});
