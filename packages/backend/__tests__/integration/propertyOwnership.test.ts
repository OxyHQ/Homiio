/**
 * Ownership enforcement for property create/update/delete (session oxyUserId
 * model), against a REAL Postgres.
 *
 * The listing is read back through `findPropertyById` — the same repository
 * `GET /properties/:id` uses — rather than through a raw row read, so
 * "the write landed" and "the catalogue can see it" are ONE assertion. That is
 * the property the write port exists to establish, and a row-level read would
 * pass even if the hydration the API depends on were broken.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { PropertyStatus, PropertyType, OfferingType } from '@homiio/shared-types';

import { updateProperty, deleteProperty } from '../../controllers/property/updateDelete';
import { createProperty } from '../../controllers/property/create';
import { createRentProperty, createAddress } from '../helpers/factories';

import { findPropertyById } from '../../db/properties/propertyReads';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { assertFound } from '../helpers/assertFound';

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  // Production mounts every one of these handlers behind `routes()`, whose
  // first middleware is the wire-id serializer. Without it here the suite
  // would assert a body shape the API no longer serves.
  app.use(serializeWireIds);

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
      .put(`/properties/${property.id}`)
      .send({ description: 'Updated by owner' });
    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated by owner');
  });

  it('rejects a non-owner update with 404', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const res = await request(buildApp('oxy-intruder'))
      .put(`/properties/${property.id}`)
      .send({ description: 'Hijack attempt' });
    expect(res.status).toBe(404);
  });

  it('soft-deletes when the owner deletes', async () => {
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const res = await request(buildApp('oxy-owner')).delete(`/properties/${property.id}`);
    expect(res.status).toBe(200);
    const archived = await findPropertyById(property.id);
    assertFound(archived, 'archived');
    expect(archived.property.status).toBe(PropertyStatus.ARCHIVED);
    // The stamp too, not just the status: every catalogue read filters on
    // `deleted_at IS NULL`, so a listing archived without it stays visible to
    // any read that does not also exclude archived rows.
    expect(archived.property.deletedAt).toBeInstanceOf(Date);
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
      addressId: address.id,
    };
  }

  it('creates a listing owned by the authenticated user', async () => {
    const res = await request(buildApp('oxy-owner')).post('/properties').send(await validCreateBody());
    expect(res.status).toBe(201);
    const persisted = await findPropertyById(res.body.data.id);
    assertFound(persisted, 'persisted');
    expect(persisted.property.oxyUserId).toBe('oxy-owner');
    // The 201 body and a later fetch are the SAME body — the create path reads
    // back through the repository rather than serializing what it just built,
    // so a field the write dropped cannot be masked by the response.
    expect(res.body.data.longTermRent.monthlyAmount).toBe(1200);
    expect(persisted.property.longTermRentMonthlyAmount).toBe(1200);
  });
});
