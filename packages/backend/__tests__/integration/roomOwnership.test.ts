/**
 * Room create/update ownership (session oxyUserId model).
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { PropertyType, PropertyStatus, OfferingType } from '@homiio/shared-types';

import { createRentProperty, models } from '../helpers/factories';

const roomController = require('../../controllers/roomController');
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

async function seedRoom(oxyUserId: string, parentPropertyId: unknown) {
  const parent = await Property.findById(parentPropertyId);
  return Property.create({
    oxyUserId,
    addressId: parent.addressId,
    parentPropertyId,
    type: PropertyType.ROOM,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 800, currency: 'EUR' },
    status: PropertyStatus.PUBLISHED,
  });
}

describe('roomController.createRoom', () => {
  it('creates a room owned by the authenticated user', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const res = await request(buildApp('oxy-owner')).post('/rooms').send(await validRoomBody(parent._id));
    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.oxyUserId).toBe('oxy-owner');
    expect(persisted.type).toBe(PropertyType.ROOM);
  });
});

describe('roomController.updateRoom', () => {
  it('lets the owner update their room', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);
    const res = await request(buildApp('oxy-owner'))
      .put(`/rooms/${room._id}`)
      .send({ description: 'Updated room' });
    expect(res.status).toBe(200);
  });

  it('rejects a non-owner update with 404', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);
    const res = await request(buildApp('oxy-intruder'))
      .put(`/rooms/${room._id}`)
      .send({ description: 'Hijack' });
    expect(res.status).toBe(404);
  });
});
