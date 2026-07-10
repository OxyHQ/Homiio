/**
 * Room create/update ownership + mass-assignment enforcement.
 *
 * A "room" is a Property whose `type` is PropertyType.ROOM (see roomController).
 * These tests mount the real `createRoom`/`updateRoom` handlers behind a
 * fake-auth middleware and assert that:
 *   - a room is ALWAYS owned by the authenticated user's active profile
 *     (client-supplied `oxyUserId` is ignored),
 *   - the room `type` cannot be overridden away from ROOM on create,
 *   - system-managed fields (`isVerified`, `views`) are never mass-assigned,
 *   - a non-owner cannot update someone else's room.
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

/** A room's create body always references a parent property the caller owns. */
async function validRoomBody(parentPropertyId: unknown) {
  return {
    parentPropertyId: String(parentPropertyId),
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 800, currency: 'EUR' },
  };
}

async function seedRoom(
  oxyUserId: unknown,
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
  it('creates a ROOM owned by the authenticated user (server-resolved profile)', async () => {
        const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-owner')).post('/rooms').send(body);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.type).toBe(PropertyType.ROOM);
    expect(String(persisted.oxyUserId)).toBe(String('oxy-owner'));
    expect(String(persisted.parentPropertyId)).toBe(String(parent._id));
  });

  it('ignores injected owner (oxyUserId) on create', async () => {
        const otherProfile = // no profile needed;
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-owner'))
      .post('/rooms')
      .send({ ...body, oxyUserId: String('oxy-other') });

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(String(persisted.oxyUserId)).toBe(String('oxy-owner'));
    expect(String(persisted.oxyUserId)).not.toBe(String('oxy-other'));
  });

  it('rejects creating a room under a parent the requester does not own with 403', async () => {
        // no profile needed;
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-intruder')).post('/rooms').send(body);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('forces type=ROOM even when the body injects a different type', async () => {
        const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-owner'))
      .post('/rooms')
      .send({ ...body, type: PropertyType.APARTMENT });

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.type).toBe(PropertyType.ROOM);
  });

  it('ignores injected system-managed fields (isVerified/views) on create', async () => {
        const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const body = await validRoomBody(parent._id);

    const res = await request(buildApp('oxy-owner'))
      .post('/rooms')
      .send({ ...body, isVerified: true, views: 9999 });

    expect(res.status).toBe(201);
    const persisted = await Property.findById(res.body.data.id ?? res.body.data._id);
    expect(persisted.isVerified).toBe(false);
    expect(persisted.views).not.toBe(9999);
  });
});

describe('roomController.updateRoom', () => {
  it('lets the owner update their own room', async () => {
        const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);

    const res = await request(buildApp('oxy-owner'))
      .put(`/rooms/${room._id}`)
      .send({ description: 'Updated by owner' });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Updated by owner');
  });

  it('rejects a non-owner update with 403', async () => {
        // no profile needed;
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);

    const res = await request(buildApp('oxy-intruder'))
      .put(`/rooms/${room._id}`)
      .send({ description: 'Hijack attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const unchanged = await Property.findById(room._id);
    expect(unchanged.description).toBeUndefined();
  });

  it('ignores owner reassignment (oxyUserId) and system fields on update', async () => {
        const otherProfile = // no profile needed;
    const parent = await createRentProperty({ oxyUserId: 'oxy-owner' });
    const room = await seedRoom('oxy-owner', parent._id);

    const res = await request(buildApp('oxy-owner'))
      .put(`/rooms/${room._id}`)
      .send({
        description: 'Legit edit',
        oxyUserId: String('oxy-other'),
        isVerified: true,
        views: 9999,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.description).toBe('Legit edit');

    const reloaded = await Property.findById(room._id);
    expect(String(reloaded.oxyUserId)).toBe(String('oxy-owner'));
    expect(reloaded.isVerified).toBe(false);
    expect(reloaded.views).not.toBe(9999);
  });
});
