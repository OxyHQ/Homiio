/**
 * Roommate controller — profile resolution, preferences mass-assignment (IDOR),
 * relationship lifecycle, and relationship ownership.
 *
 * Mounts the real roommateController handlers behind a fake-auth middleware on
 * the in-memory Mongo. Asserts that:
 *   - the active profile is resolved server-side from the authenticated user
 *     (never a client-supplied profile id), and the caller is excluded from
 *     discovery results;
 *   - `PUT /preferences` writes ONLY the whitelisted matching fields and never
 *     owner/system fields (`oxyUserId`, `profileType`);
 *   - accepting a request materializes a `RoommateRelationship`;
 *   - `GET /relationships` returns the caller's relationships;
 *   - `DELETE /relationships/:id` is participant-scoped (a non-participant gets
 *     404 and the relationship stays active).
 *
 * The display-name hydration (`POST /users/by-ids`) is mocked to an empty
 * payload so tests never hit the network.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { ProfileType } from '@homiio/shared-types';

const roommateController = require('../../controllers/roommateController');
const { asyncHandler } = require('../../middlewares');
const { errorHandler } = require('../../middlewares/errorHandler');
const { Profile, RoommateRequest, RoommateRelationship } = require('../../models');

beforeAll(() => {
  // Mock the Oxy `POST /users/by-ids` hydration call so the serializer never
  // performs a real network request during tests.
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
  app.post('/roommates/:profileId/request', asyncHandler(roommateController.sendRoommateRequest));
  app.use(errorHandler);
  return app;
}

async function createRoommateProfile(
  oxyUserId: string,
  overrides: Record<string, unknown> = {},
) {
  return Profile.create({
    oxyUserId,
    profileType: ProfileType.PERSONAL,
    isActive: true,
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
    const me = await createRoommateProfile('oxy-me');
    const other = await createRoommateProfile('oxy-other');

    const res = await request(buildApp('oxy-me')).get('/roommates');

    expect(res.status).toBe(200);
    const ids = res.body.profiles.map((p: { _id: string }) => String(p._id));
    expect(ids).toContain(String(other._id));
    expect(ids).not.toContain(String(me._id));
  });
});

describe('roommateController.updateRoommatePreferences — mass-assignment (IDOR)', () => {
  it('writes only whitelisted matching fields, never owner/system fields', async () => {
    const me = await createRoommateProfile('oxy-me');

    const res = await request(buildApp('oxy-me'))
      .put('/roommates/preferences')
      .send({
        budget: { min: 700, max: 1500 },
        gender: 'any',
        // Injected owner/system fields must be ignored.
        oxyUserId: 'oxy-attacker',
        profileType: ProfileType.AGENCY,
        _id: '000000000000000000000000',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.budget.max).toBe(1500);

    const reloaded = await Profile.findById(me._id);
    // Owner + type are untouched.
    expect(reloaded.oxyUserId).toBe('oxy-me');
    expect(reloaded.profileType).toBe(ProfileType.PERSONAL);
    // Whitelisted field persisted.
    expect(reloaded.personalProfile.settings.roommate.preferences.budget.max).toBe(1500);
  });

  it('does not clobber unspecified preference subfields', async () => {
    const me = await createRoommateProfile('oxy-me');

    await request(buildApp('oxy-me'))
      .put('/roommates/preferences')
      .send({ budget: { min: 800, max: 1600 } });

    const reloaded = await Profile.findById(me._id);
    // lifestyle (not sent) is preserved from the seed.
    expect(reloaded.personalProfile.settings.roommate.preferences.lifestyle.pets).toBe('yes');
  });
});

describe('roommateController — accept creates a relationship', () => {
  it('materializes a RoommateRelationship when a request is accepted', async () => {
    const sender = await createRoommateProfile('oxy-sender');
    const recipient = await createRoommateProfile('oxy-recipient');

    const req = await RoommateRequest.create({
      fromProfileId: sender._id,
      toProfileId: recipient._id,
      status: 'pending',
    });

    const res = await request(buildApp('oxy-recipient'))
      .post(`/roommates/requests/${req._id}/accept`);

    expect(res.status).toBe(200);

    const relationships = await RoommateRelationship.find({ status: 'active' });
    expect(relationships).toHaveLength(1);
    const participants = [
      String(relationships[0].profile1Id),
      String(relationships[0].profile2Id),
    ].sort();
    expect(participants).toEqual([String(sender._id), String(recipient._id)].sort());
  });

  it('does not create a relationship when a request is declined', async () => {
    const sender = await createRoommateProfile('oxy-sender');
    const recipient = await createRoommateProfile('oxy-recipient');

    const req = await RoommateRequest.create({
      fromProfileId: sender._id,
      toProfileId: recipient._id,
      status: 'pending',
    });

    await request(buildApp('oxy-recipient'))
      .post(`/roommates/requests/${req._id}/decline`);

    expect(await RoommateRelationship.countDocuments({})).toBe(0);
  });
});

describe('roommateController.getRoommateRelationships', () => {
  it("returns the caller's relationships", async () => {
    const me = await createRoommateProfile('oxy-me');
    const other = await createRoommateProfile('oxy-other');
    const stranger = await createRoommateProfile('oxy-stranger');
    const strangerB = await createRoommateProfile('oxy-stranger-b');

    await RoommateRelationship.create({ profile1Id: me._id, profile2Id: other._id, status: 'active' });
    await RoommateRelationship.create({ profile1Id: stranger._id, profile2Id: strangerB._id, status: 'active' });

    const res = await request(buildApp('oxy-me')).get('/roommates/relationships');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const ids = [res.body.data[0].profile1Id, res.body.data[0].profile2Id].sort();
    expect(ids).toEqual([String(me._id), String(other._id)].sort());
  });
});

describe('roommateController.endRoommateRelationship — ownership (IDOR)', () => {
  it('lets a participant end their relationship', async () => {
    const me = await createRoommateProfile('oxy-me');
    const other = await createRoommateProfile('oxy-other');
    const rel = await RoommateRelationship.create({
      profile1Id: me._id,
      profile2Id: other._id,
      status: 'active',
    });

    const res = await request(buildApp('oxy-me'))
      .delete(`/roommates/relationships/${rel._id}`);

    expect(res.status).toBe(200);
    const reloaded = await RoommateRelationship.findById(rel._id);
    expect(reloaded.status).toBe('ended');
    expect(reloaded.endDate).toBeTruthy();
  });

  it('does not let a non-participant end a relationship (404, stays active)', async () => {
    const me = await createRoommateProfile('oxy-me');
    const other = await createRoommateProfile('oxy-other');
    await createRoommateProfile('oxy-intruder');
    const rel = await RoommateRelationship.create({
      profile1Id: me._id,
      profile2Id: other._id,
      status: 'active',
    });

    const res = await request(buildApp('oxy-intruder'))
      .delete(`/roommates/relationships/${rel._id}`);

    expect(res.status).toBe(404);
    const reloaded = await RoommateRelationship.findById(rel._id);
    expect(reloaded.status).toBe('active');
  });
});
