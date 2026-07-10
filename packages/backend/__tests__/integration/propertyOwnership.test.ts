/**
 * Ownership integration tests — property create/update/delete use session oxyUserId.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { PropertyStatus, PropertyType, OfferingType } from '@homiio/shared-types';

import { updateProperty, deleteProperty } from '../../controllers/property/updateDelete';
import { createProperty } from '../../controllers/property/create';
import { createRentProperty, createAddress, models } from '../helpers/factories';

const { errorHandler } = require('../../middlewares/errorHandler');
const { Property } = models;

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.post('/properties', createProperty);
  app.put('/properties/:propertyId', updateProperty);
  app.delete('/properties/:propertyId', deleteProperty);
  app.use(errorHandler);
  return app;
}

describe('property update/delete ownership', () => {
  it('lets the owner update their own property', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-owner'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Updated by owner' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.description).toBe('Updated by owner');
  });

  it('rejects a non-owner update with 404', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-intruder'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Hijack attempt' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const unchanged = await Property.findById(property._id);
    expect(unchanged.description).toBeUndefined();
  });

  it('rejects a non-owner delete with 404 and leaves the property intact', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-intruder')).delete(`/properties/${property._id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const stillThere = await Property.findById(property._id);
    expect(stillThere.status).toBe(PropertyStatus.PUBLISHED);
    expect(stillThere.deletedAt).toBeNull();
  });

  it('soft-deletes when the owner deletes (status archived + deletedAt set)', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-owner')).delete(`/properties/${property._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const archived = await Property.findById(property._id);
    expect(archived.status).toBe(PropertyStatus.ARCHIVED);
    expect(archived.deletedAt).toBeInstanceOf(Date);
  });

  it('returns 404 when the property does not exist', async () => {
    const res = await request(buildApp('oxy-owner')).delete('/properties/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('ignores owner reassignment in the update body', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-owner'))
      .put(`/properties/${property._id}`)
      .send({ oxyUserId: 'oxy-intruder', description: 'still mine' });

    expect(res.status).toBe(200);
    const persisted = await Property.findById(property._id);
    expect(String(persisted.oxyUserId)).toBe('oxy-owner');
    expect(persisted.description).toBe('still mine');
  });

  it('ignores system-managed fields (isVerified/views) in the update body', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });

    const res = await request(buildApp('oxy-owner'))
      .put(`/properties/${property._id}`)
      .send({ isVerified: true, views: 9999, description: 'ok' });

    expect(res.status).toBe(200);
    const persisted = await Property.findById(property._id);
    expect(persisted.isVerified).not.toBe(true);
    expect(persisted.views).not.toBe(9999);
    expect(persisted.description).toBe('ok');
  });
});

describe('property create ownership + mass-assignment', () => {
  async function validBody() {
    const address = await createAddress();
    return {
      type: PropertyType.APARTMENT,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
      addressId: address._id,
    };
  }

  it('creates a listing owned by the authenticated user', async () => {
    const body = await validBody();
    const res = await request(buildApp('oxy-owner')).post('/properties').send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(String(persisted.oxyUserId)).toBe('oxy-owner');
  });

  it('ignores injected owner on create', async () => {
    const body = { ...(await validBody()), oxyUserId: 'oxy-intruder' };
    const res = await request(buildApp('oxy-owner')).post('/properties').send(body);

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(String(persisted.oxyUserId)).toBe('oxy-owner');
  });

  it('ignores injected system-managed fields on create', async () => {
    const body = { ...(await validBody()), isVerified: true, views: 5000 };
    const res = await request(buildApp('oxy-owner')).post('/properties').send(body);

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.isVerified).not.toBe(true);
    expect(persisted.views).not.toBe(5000);
  });

  it('ignores injected partner attribution on create', async () => {
    const body = {
      ...(await validBody()),
      sourcedByPartner: '507f1f77bcf86cd799439011',
      sourcedByReferralCode: 'fake-code',
    };
    const res = await request(buildApp('oxy-owner')).post('/properties').send(body);

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.sourcedByPartner).toBeFalsy();
    expect(persisted.sourcedByReferralCode).toBeFalsy();
  });
});
