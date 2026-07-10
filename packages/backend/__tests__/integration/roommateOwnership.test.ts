/**
 * Roommate controller — profile resolution, preferences mass-assignment (IDOR),
 * relationship lifecycle, and relationship ownership.
 */

import express, { type Express } from 'express';
import request from 'supertest';

const roommateController = require('../../controllers/roommateController');
const { asyncHandler } = require('../../middlewares');
const { errorHandler } = require('../../middlewares/errorHandler');
const { Profile, RoommateRequest, RoommateRelationship } = require('../../models');

beforeAll(() => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }));
});

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string }; userId: string }).user = { id: oxyUserId };
    (req as unknown as { userId: string }).userId = oxyUserId;
    next();
  });
  app.get('/roommates', asyncHandler(roommateController.getRoommateProfiles));
  app.put('/roommates/preferences', asyncHandler(roommateController.updateRoommatePreferences));
  app.get('/roommates/requests', asyncHandler(roommateController.getRoommateRequests));
  app.get('/roommates/relationships', asyncHandler(roommateController.getRoommateRelationships));
  app.delete('/roommates/relationships/:relationshipId', asyncHandler(roommateController.endRoommateRelationship));
  app.post('/roommates/requests/:requestId/accept', asyncHandler(roommateController.acceptRoommateRequest));
  app.post('/roommates/requests/:requestId/decline', asyncHandler(roommateController.declineRoommateRequest));
  app.post('/roommates/:oxyUserId/request', asyncHandler(roommateController.sendRoommateRequest));
  app.use(errorHandler);
  return app;
}

async function createRoommateProfile(
  oxyUserId: string,
  overrides: Record<string, unknown> = {},
) {
  return Profile.create({
    oxyUserId,
    personalProfile: {
      settings: {
        roommate: {
          enabled: true,
          preferences: {
            budget: { min: 500, max: 1200 },
            lifestyle: { smoking: 'no', pets: 'yes' },
          },
        },
      },
    },
    ...overrides,
  });
}

describe('roommateController.getRoommateProfiles — profile resolution', () => {
  it('requires an authenticated user', async () => {
    const app = express();
    app.use(express.json());
    app.get('/roommates', asyncHandler(roommateController.getRoommateProfiles));
    app.use(errorHandler);

    const res = await request(app).get('/roommates');
    expect(res.status).toBe(401);
  });

  it('resolves the caller by oxy user id and excludes their own profile', async () => {
    await createRoommateProfile('oxy-me');
    await createRoommateProfile('oxy-other');

    const res = await request(buildApp('oxy-me')).get('/roommates');

    expect(res.status).toBe(200);
    const ids = (res.body.profiles as Array<{ oxyUserId: string }>).map((p) => p.oxyUserId);
    expect(ids).toContain('oxy-other');
    expect(ids).not.toContain('oxy-me');
  });
});

describe('roommateController.updateRoommatePreferences — mass-assignment guard', () => {
  it('writes only whitelisted matching fields', async () => {
    await createRoommateProfile('oxy-me');

    const res = await request(buildApp('oxy-me'))
      .put('/roommates/preferences')
      .send({
        budget: { min: 600, max: 1300 },
        oxyUserId: 'evil-inject',
      });

    expect(res.status).toBe(200);
    const reloaded = await Profile.findByOxyUserId('oxy-me');
    expect(reloaded?.oxyUserId).toBe('oxy-me');
    const prefs = reloaded?.personalProfile?.settings?.roommate?.preferences;
    expect(prefs?.budget?.min).toBe(600);
    expect(prefs?.budget?.max).toBe(1300);
  });
});

describe('roommateController relationship lifecycle', () => {
  it('accepting a request materializes a relationship', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    const pending = await RoommateRequest.create({
      fromOxyUserId: 'oxy-a',
      toOxyUserId: 'oxy-b',
      status: 'pending',
    });

    const res = await request(buildApp('oxy-b'))
      .post(`/roommates/requests/${pending._id}/accept`);

    expect(res.status).toBe(200);

    const relationship = await RoommateRelationship.findOne({
      $or: [
        { oxyUser1Id: 'oxy-a', oxyUser2Id: 'oxy-b' },
        { oxyUser1Id: 'oxy-b', oxyUser2Id: 'oxy-a' },
      ],
      status: 'active',
    });
    expect(relationship).toBeTruthy();
  });

  it('DELETE /relationships/:id is participant-scoped', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    await createRoommateProfile('oxy-outsider');

    const relationship = await RoommateRelationship.create({
      oxyUser1Id: 'oxy-a',
      oxyUser2Id: 'oxy-b',
      status: 'active',
      startDate: new Date(),
    });

    const res = await request(buildApp('oxy-outsider'))
      .delete(`/roommates/relationships/${relationship._id}`);

    expect(res.status).toBe(404);

    const stillActive = await RoommateRelationship.findById(relationship._id);
    expect(stillActive?.status).toBe('active');
  });
});
