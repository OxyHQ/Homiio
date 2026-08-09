/**
 * Room create/update ownership (session oxyUserId model).
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { PropertyType, PropertyStatus, OfferingType } from '@homiio/shared-types';

import { createRentProperty } from '../helpers/factories';
import { getDb } from '../../db/postgres';
import { properties } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';

import roomController from '../../controllers/roomController';
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
  app.post('/rooms', (req, res, next) => roomController.createRoom(req, res, next));
  app.put('/rooms/:id', (req, res, next) => roomController.updateRoom(req, res, next));
  app.use(errorHandler);
  return app;
}

async function validRoomBody(parentPropertyId: unknown) {
  return {
    parentPropertyId: String(parentPropertyId),
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 800, currency: 'EUR' },
  };
}

async function seedRoom(oxyUserId: string, parentPropertyId: string): Promise<{ id: string }> {
  const parent = await findPropertyById(parentPropertyId);
  assertFound(parent, 'parent');
  const [room] = await getDb()
    .insert(properties)
    .values({
      oxyUserId,
      // A room with no address of its own is in its parent's building — the
      // same inheritance `roomController.createRoom` performs.
      addressId: parent.property.addressId,
      parentPropertyId,
      type: PropertyType.ROOM,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 800,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
    })
    .returning({ id: properties.id });
  return room;
}

describe('roomController.createRoom', () => {
  it('creates a room owned by the authenticated user', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const res = await request(buildApp('oxy-owner')).post('/rooms').send(await validRoomBody(parent.id));
    expect(res.status).toBe(201);
    const persisted = await findPropertyById(res.body.data.id);
    assertFound(persisted, 'persisted');
    expect(persisted.property.oxyUserId).toBe('oxy-owner');
    expect(persisted.property.type).toBe(PropertyType.ROOM);
    // The room inherits its parent's building rather than inventing an address.
    expect(persisted.property.parentPropertyId).toBe(res.body.data.parentPropertyId);
  });
});

describe('roomController.updateRoom', () => {
  it('lets the owner update their room', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent.id);
    const res = await request(buildApp('oxy-owner'))
      .put(`/rooms/${room.id}`)
      .send({ description: 'Updated room' });
    expect(res.status).toBe(200);
  });

  it('rejects a non-owner update with 404', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent.id);
    const res = await request(buildApp('oxy-intruder'))
      .put(`/rooms/${room.id}`)
      .send({ description: 'Hijack' });
    expect(res.status).toBe(404);
  });
});
