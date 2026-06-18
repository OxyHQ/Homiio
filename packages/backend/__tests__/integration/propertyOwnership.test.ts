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
import { PropertyStatus } from '@homiio/shared-types';

import { updateProperty, deleteProperty } from '../../controllers/property/updateDelete';
import { createProfile, createRentProperty, models } from '../helpers/factories';

const { errorHandler } = require('../../middlewares/errorHandler');
const { Property } = models;

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
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
});
