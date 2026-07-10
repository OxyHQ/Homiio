/**
 * Ownership enforcement for property update/delete (session oxyUserId model).
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
    expect(res.body.data.description).toBe('Updated by owner');
  });

  it('rejects a non-owner update with 404', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const res = await request(buildApp('oxy-intruder'))
      .put(`/properties/${property._id}`)
      .send({ description: 'Hijack attempt' });
    expect(res.status).toBe(404);
  });

  it('soft-deletes when the owner deletes', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const res = await request(buildApp('oxy-owner')).delete(`/properties/${property._id}`);
    expect(res.status).toBe(200);
    const archived = await Property.findById(property._id);
    expect(archived.status).toBe(PropertyStatus.ARCHIVED);
  });
});

describe('property create ownership', () => {
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

  it('creates a listing owned by the authenticated user', async () => {
    const res = await request(buildApp('oxy-owner')).post('/properties').send(await validCreateBody());
    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.oxyUserId).toBe('oxy-owner');
  });
});
