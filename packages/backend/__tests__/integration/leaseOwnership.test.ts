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
const { Lease } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
  app.post('/leases', (req, res, next) => leaseController.createLease(req, res, next));
  app.get('/leases/:id', (req, res, next) => leaseController.getLeaseById(req, res, next));
  app.put('/leases/:id', (req, res, next) => leaseController.updateLease(req, res, next));
  app.post('/leases/:id/sign', (req, res, next) => leaseController.signLease(req, res, next));
  app.post('/leases/:id/payments', (req, res, next) => leaseController.createPayment(req, res, next));
  app.get('/leases/:id/payments', (req, res, next) => leaseController.getLeasePayments(req, res, next));
  app.post('/leases/:id/documents', (req, res, next) => leaseController.uploadLeaseDocument(req, res, next));
  app.get('/leases/:id/documents', (req, res, next) => leaseController.getLeaseDocuments(req, res, next));
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
  it('lets the landlord update a draft lease and persists whitelisted notes', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${lease._id}`)
      .send({ notes: 'updated terms' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.notes).toBe('updated terms');
    const persisted = await Lease.findById(lease._id);
    expect(persisted.notes).toBe('updated terms');
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

  it('applies a whitelisted field change (rentDetails) on a draft', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${lease._id}`)
      .send({ rentDetails: { monthlyRent: 1500, currency: 'EUR' } });
    expect(res.status).toBe(200);
    const persisted = await Lease.findById(lease._id);
    expect(persisted.rentDetails.monthlyRent).toBe(1500);
  });

  it('ignores injected owner/status fields on update (mass-assignment guard)', async () => {
    const { lease, tenant } = await seedLease('draft');
    const res = await request(buildApp('oxy-landlord'))
      .put(`/leases/${lease._id}`)
      .send({
        landlordProfileId: tenant._id,
        status: 'active',
        signatures: { landlord: { signed: true }, tenant: { signed: true } },
        rentDetails: { monthlyRent: 1500, currency: 'EUR' },
      });
    expect(res.status).toBe(200);
    const persisted = await Lease.findById(lease._id);
    // Whitelisted field changed; owner + lifecycle fields untouched.
    expect(persisted.rentDetails.monthlyRent).toBe(1500);
    expect(persisted.landlordProfileId.toString()).not.toBe(tenant._id.toString());
    expect(persisted.status).toBe('draft');
    expect(persisted.signatures.landlord.signed).toBe(false);
    expect(persisted.signatures.tenant.signed).toBe(false);
  });
});

describe('leaseController.createLease', () => {
  async function seedForCreate() {
    const landlord = await createProfile('oxy-landlord');
    const tenant = await createProfile('oxy-tenant');
    const stranger = await createProfile('oxy-stranger');
    const property = await createRentProperty({ profileId: landlord._id });
    const now = new Date();
    const end = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
    const validBody = {
      propertyId: property._id,
      tenantProfileId: tenant._id,
      leaseTerms: { startDate: now, endDate: end },
      rentDetails: { monthlyRent: 1200, currency: 'EUR' },
    };
    return { landlord, tenant, stranger, property, validBody };
  }

  it('creates a draft lease with the server-resolved landlord', async () => {
    const { landlord, validBody } = await seedForCreate();
    const res = await request(buildApp('oxy-landlord')).post('/leases').send(validBody);
    expect(res.status).toBe(201);
    const persisted = await Lease.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.landlordProfileId.toString()).toBe(landlord._id.toString());
    expect(persisted.status).toBe('draft');
  });

  it('ignores injected owner/status/signature fields on create (mass-assignment guard)', async () => {
    const { landlord, stranger, validBody } = await seedForCreate();
    const res = await request(buildApp('oxy-landlord'))
      .post('/leases')
      .send({
        ...validBody,
        landlordProfileId: stranger._id,
        status: 'active',
        signatures: { landlord: { signed: true }, tenant: { signed: true } },
        paymentSchedule: [{ dueDate: new Date(), amount: 999, type: 'rent' }],
      });
    expect(res.status).toBe(201);
    const persisted = await Lease.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.landlordProfileId.toString()).toBe(landlord._id.toString());
    expect(persisted.status).toBe('draft');
    expect(persisted.signatures.landlord.signed).toBe(false);
    expect(persisted.paymentSchedule.length).toBe(0);
  });

  it('rejects creating a lease for a property the requester does not own with 403', async () => {
    const { validBody } = await seedForCreate();
    const res = await request(buildApp('oxy-stranger')).post('/leases').send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('leaseController.signLease', () => {
  it('records only the signer (tenant) and moves the lease to pending_signatures', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${lease._id}/sign`)
      .send({ acceptTerms: true, signature: 'e-sign' });
    expect(res.status).toBe(200);
    const persisted = await Lease.findById(lease._id);
    expect(persisted.signatures.tenant.signed).toBe(true);
    expect(persisted.signatures.landlord.signed).toBe(false);
    expect(persisted.status).toBe('pending_signatures');
  });

  it('activates the lease once both parties have signed', async () => {
    const { lease } = await seedLease('draft');
    await request(buildApp('oxy-landlord'))
      .post(`/leases/${lease._id}/sign`)
      .send({ acceptTerms: true });
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${lease._id}/sign`)
      .send({ acceptTerms: true });
    expect(res.status).toBe(200);
    const persisted = await Lease.findById(lease._id);
    expect(persisted.signatures.landlord.signed).toBe(true);
    expect(persisted.signatures.tenant.signed).toBe(true);
    expect(persisted.status).toBe('active');
  });

  it('rejects signing without accepting terms (400)', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${lease._id}/sign`)
      .send({ signature: 'e-sign' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TERMS_NOT_ACCEPTED');
  });

  it('rejects a non-party signer with 403', async () => {
    const { lease } = await seedLease('draft');
    await createProfile('oxy-stranger');
    const res = await request(buildApp('oxy-stranger'))
      .post(`/leases/${lease._id}/sign`)
      .send({ acceptTerms: true });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ignores injected status/signature fields on sign (mass-assignment guard)', async () => {
    const { lease } = await seedLease('draft');
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${lease._id}/sign`)
      .send({
        acceptTerms: true,
        status: 'active',
        signatures: { landlord: { signed: true }, tenant: { signed: true } },
      });
    expect(res.status).toBe(200);
    const persisted = await Lease.findById(lease._id);
    // Only the tenant's signature was recorded; the injected landlord signature
    // and the forced 'active' status are ignored.
    expect(persisted.signatures.landlord.signed).toBe(false);
    expect(persisted.signatures.tenant.signed).toBe(true);
    expect(persisted.status).toBe('pending_signatures');
  });
});

describe('leaseController.createPayment', () => {
  it('adds a pending payment for the landlord, ignoring injected paid/system fields', async () => {
    const { lease } = await seedLease('active');
    const res = await request(buildApp('oxy-landlord'))
      .post(`/leases/${lease._id}/payments`)
      .send({
        dueDate: new Date().toISOString(),
        amount: 1200,
        type: 'rent',
        status: 'paid',
        paidAmount: 9999,
        transactionId: 'injected-tx',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.paidAmount).toBeUndefined();
    expect(res.body.data.transactionId).toBeUndefined();
    expect(res.body.data.amount).toBe(1200);
  });

  it('rejects a tenant adding a payment with 403', async () => {
    const { lease } = await seedLease('active');
    const res = await request(buildApp('oxy-tenant'))
      .post(`/leases/${lease._id}/payments`)
      .send({ dueDate: new Date().toISOString(), amount: 1200, type: 'rent' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('leaseController.uploadLeaseDocument', () => {
  it('stores server-resolved uploadedBy, ignoring an injected uploadedBy', async () => {
    const { lease, landlord, tenant } = await seedLease('active');
    const res = await request(buildApp('oxy-landlord'))
      .post(`/leases/${lease._id}/documents`)
      .send({
        name: 'Signed agreement',
        url: 'https://files.example.com/lease.pdf',
        type: 'lease_agreement',
        uploadedBy: tenant._id,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.uploadedBy).toBe(landlord._id.toString());
    expect(res.body.data.uploadedBy).not.toBe(tenant._id.toString());
    const persisted = await Lease.findById(lease._id);
    expect(persisted.documents.length).toBe(1);
    expect(persisted.documents[0].url).toBe('https://files.example.com/lease.pdf');
    expect(persisted.documents[0].type).toBe('lease_agreement');
  });

  it('rejects a non-party attaching a document with 403', async () => {
    const { lease } = await seedLease('active');
    await createProfile('oxy-stranger');
    const res = await request(buildApp('oxy-stranger'))
      .post(`/leases/${lease._id}/documents`)
      .send({ name: 'x', url: 'https://files.example.com/x.pdf' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
