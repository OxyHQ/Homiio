/**
 * Ownership enforcement for property update/delete.
 *
 * Seeds two profiles + a property owned by profile A (via the real models on the
 * in-memory Mongo), then mounts the real `updateProperty`/`deleteProperty`
 * handlers behind a tiny fake-auth middleware that injects `req.user`. Asserts
 * that a non-owner is rejected with 403 and the owner succeeds (delete is a soft
 * delete: status → archived + deletedAt set).
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { PropertyStatus, PropertyType, OfferingType } from '@homiio/shared-types';

import { updateProperty, deleteProperty } from '../../controllers/property/updateDelete';
import { createProperty } from '../../controllers/property/create';
import { createProfile, createRentProperty, createAddress, models } from '../helpers/factories';

const { errorHandler } = require('../../middlewares/errorHandler');
const { Property } = models;

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // The create controller reads `req.userId`; update/delete read `req.user.id`.
    // Set both so the same fake-auth app exercises every write path.
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
    const owner = await createProfile('oxy-owner');
    const property = await createRentProperty({ profileId: owner._id });

    const res = await request(buildApp('oxy-owner'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Updated by owner' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.description).toBe('Updated by owner');
  });

  it('rejects a non-owner update with 403', async () => {
    const owner = await createProfile('oxy-owner');
    await createProfile('oxy-intruder');
    const property = await createRentProperty({ profileId: owner._id });

    const res = await request(buildApp('oxy-intruder'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Hijack attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const unchanged = await Property.findById(property._id);
    expect(unchanged.description).toBeUndefined();
  });

  it('rejects a non-owner delete with 403 and leaves the property intact', async () => {
    const owner = await createProfile('oxy-owner');
    await createProfile('oxy-intruder');
    const property = await createRentProperty({ profileId: owner._id });

    const res = await request(buildApp('oxy-intruder')).delete(`/properties/${property._id}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const stillThere = await Property.findById(property._id);
    expect(stillThere.status).toBe(PropertyStatus.PUBLISHED);
    expect(stillThere.deletedAt).toBeNull();
  });

  it('soft-deletes when the owner deletes (status archived + deletedAt set)', async () => {
    const owner = await createProfile('oxy-owner');
    const property = await createRentProperty({ profileId: owner._id });

    const res = await request(buildApp('oxy-owner')).delete(`/properties/${property._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const archived = await Property.findById(property._id);
    expect(archived.status).toBe(PropertyStatus.ARCHIVED);
    expect(archived.deletedAt).toBeInstanceOf(Date);
  });

  it('returns 404 when the property does not exist', async () => {
    await createProfile('oxy-owner');
    const missingId = '507f1f77bcf86cd799439011';

    const res = await request(buildApp('oxy-owner')).delete(`/properties/${missingId}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROPERTY_NOT_FOUND');
  });

  it('ignores owner reassignment (profileId) in the update body — mass-assignment guard', async () => {
    const owner = await createProfile('oxy-owner');
    const otherProfile = await createProfile('oxy-other');
    const property = await createRentProperty({ profileId: owner._id });

    const res = await request(buildApp('oxy-owner'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Legit edit', profileId: String(otherProfile._id) });

    expect(res.status).toBe(200);
    // The legitimate field is applied …
    expect(res.body.data.description).toBe('Legit edit');

    // … but ownership is unchanged: the client-supplied profileId is dropped.
    const reloaded = await Property.findById(property._id);
    expect(String(reloaded.profileId)).toBe(String(owner._id));
    expect(String(reloaded.profileId)).not.toBe(String(otherProfile._id));
  });

  it('ignores system-managed fields (isVerified/views) in the update body', async () => {
    const owner = await createProfile('oxy-owner');
    const property = await createRentProperty({ profileId: owner._id });

    const res = await request(buildApp('oxy-owner'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Edit', isVerified: true, views: 9999 });

    expect(res.status).toBe(200);

    const reloaded = await Property.findById(property._id);
    expect(reloaded.isVerified).toBe(false);
    // The injected view count is dropped (whitelist excludes `views`).
    expect(reloaded.views).not.toBe(9999);
  });
});

describe('property create ownership + mass-assignment', () => {
  async function validCreateBody() {
    const address = await createAddress();
    return {
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
      addressId: address._id,
    };
  }

  it('creates a listing owned by the authenticated user (server-resolved profile)', async () => {
    const owner = await createProfile('oxy-owner');
    const body = await validCreateBody();

    const res = await request(buildApp('oxy-owner')).post('/properties').send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(String(persisted.profileId)).toBe(String(owner._id));
  });

  it('ignores injected owner (profileId) on create — resolves owner server-side', async () => {
    const owner = await createProfile('oxy-owner');
    const otherProfile = await createProfile('oxy-other');
    const body = await validCreateBody();

    const res = await request(buildApp('oxy-owner'))
      .post('/properties')
      .send({ ...body, profileId: String(otherProfile._id) });

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(String(persisted.profileId)).toBe(String(owner._id));
    expect(String(persisted.profileId)).not.toBe(String(otherProfile._id));
  });

  it('ignores injected system-managed fields (isVerified/views) on create', async () => {
    await createProfile('oxy-owner');
    const body = await validCreateBody();

    const res = await request(buildApp('oxy-owner'))
      .post('/properties')
      .send({ ...body, isVerified: true, views: 9999 });

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.isVerified).toBe(false);
    expect(persisted.views).not.toBe(9999);
  });

  it('ignores injected partner attribution (sourcedByPartner) on create', async () => {
    await createProfile('oxy-owner');
    const fakePartnerId = '507f1f77bcf86cd799439011';
    const body = await validCreateBody();

    const res = await request(buildApp('oxy-owner'))
      .post('/properties')
      .send({ ...body, sourcedByPartner: fakePartnerId, sourcedByReferralCode: 'HIJACK' });

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    // Attribution is resolved from a validated `referralCode`, never accepted raw.
    expect(persisted.sourcedByPartner ?? null).toBeNull();
    expect(persisted.sourcedByReferralCode ?? null).toBeNull();
  });
});
