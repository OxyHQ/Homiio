/**
 * Room create/update ownership — rooms are Property docs with type=ROOM.
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

async function seedRoom(
  oxyUserId: string,
  parentPropertyId: unknown,
  status: string = PropertyStatus.PUBLISHED,
) {
  const parent = await Property.findById(parentPropertyId);
  return Property.create({
    oxyUserId,
    addressId: parent.addressId,
    parentPropertyId,
    type: PropertyType.ROOM,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 800, currency: 'EUR' },
    status,
  });
}

describe('roomController.createRoom', () => {
  it('creates a ROOM owned by the authenticated user', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-owner')).post('/rooms').send(body);

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.type).toBe(PropertyType.ROOM);
    expect(String(persisted.oxyUserId)).toBe('oxy-owner');
  });

  it('rejects creating a room under a parent the requester does not own', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-stranger')).post('/rooms').send(body);
    expect(res.status).toBe(403);
  });
});

describe('roomController.updateRoom', () => {
  it('lets the owner update their own room', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);

    const res = await request(buildApp('oxy-owner'))
      .put(`/rooms/${room._id}`)
      .send({ description: 'Updated room' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated room');
  });

  it('rejects a non-owner update with 404', async () => {
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);

    const res = await request(buildApp('oxy-stranger'))
      .put(`/rooms/${room._id}`)
      .send({ description: 'Hijack' });

    expect(res.status).toBe(404);
  });
});
