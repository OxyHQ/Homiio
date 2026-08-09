/**
 * Roommate controller — profile resolution, preferences mass-assignment (IDOR),
 * the request handshake, relationship lifecycle, and relationship ownership.
 *
 * ## This suite spans BOTH stores on purpose
 *
 * `roommate_requests` and `roommate_relationships` are on Postgres; `profiles`
 * is still the Mongo model, because it belongs to another batch. The two need no
 * transaction between them — a request row and a profile READ are independent,
 * and nothing here writes both — so the split is a real intermediate state of
 * the migration rather than a lost guarantee. When profiles move, only the
 * `Profile.` calls in the controller change.
 *
 * ## What makes these tests non-vacuous
 *
 * Both tables were empty in production, so "insert one row and read it back"
 * would pass against almost anything. Every case below targets a rule with a way
 * to be wrong — and the two partial unique indexes are asserted on what they
 * PERMIT as well as what they refuse, which `CONVENTIONS.md` names as the half
 * that a plain (total) index would silently eat.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';

import roommateController from '../../controllers/roommateController';
import { getDb } from '../../db/postgres';
import { roommateRelationships, roommateRequests } from '../../db/schema';
import { sortPair } from '../../db/roommates/roommateRepository';
import { asyncHandler } from '../../middlewares';
import { errorHandler } from '../../middlewares/errorHandler';
import { Profile } from '../../models';

beforeAll(() => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [] }),
  }));
});

beforeEach(async () => {
  // Relationships first: `request_id` references `roommate_requests`.
  await getDb().delete(roommateRelationships);
  await getDb().delete(roommateRequests);
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

/** Insert a pending request directly, for cases that start from one. */
async function seedPendingRequest(fromOxyUserId: string, toOxyUserId: string) {
  const [row] = await getDb()
    .insert(roommateRequests)
    .values({ fromOxyUserId, toOxyUserId, status: 'pending' })
    .returning();
  return row;
}

async function activeRelationshipBetween(a: string, b: string) {
  const [oxyUser1Id, oxyUser2Id] = sortPair(a, b);
  const [row] = await getDb()
    .select()
    .from(roommateRelationships)
    .where(
      and(
        eq(roommateRelationships.oxyUser1Id, oxyUser1Id),
        eq(roommateRelationships.oxyUser2Id, oxyUser2Id),
        eq(roommateRelationships.status, 'active'),
      ),
    )
    .limit(1);
  return row;
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

describe('sendRoommateRequest — the pending-pair rule', () => {
  it('stores the request and notifies nobody but the recipient', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    const res = await request(buildApp('oxy-a')).post('/roommates/oxy-b/request').send({ message: 'hola' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toEqual(expect.any(String));
    expect(res.body.data.status).toBe('pending');

    const rows = await getDb().select().from(roommateRequests);
    expect(rows).toHaveLength(1);
    expect(rows[0].fromOxyUserId).toBe('oxy-a');
    expect(rows[0].message).toBe('hola');
  });

  it('refuses a second pending request in the SAME direction with 409', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    const app = buildApp('oxy-a');

    expect((await request(app).post('/roommates/oxy-b/request')).status).toBe(201);
    const second = await request(app).post('/roommates/oxy-b/request');
    expect(second.status).toBe(409);

    expect(await getDb().select().from(roommateRequests)).toHaveLength(1);
  });

  it('refuses a pending request in the REVERSE direction with 409', async () => {
    // The partial unique index is on the ORDERED pair, so it cannot see this
    // one — the repository keeps an explicit read for it, and dropping that read
    // would let two people hold two pending requests about each other.
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    expect((await request(buildApp('oxy-a')).post('/roommates/oxy-b/request')).status).toBe(201);
    const reverse = await request(buildApp('oxy-b')).post('/roommates/oxy-a/request');
    expect(reverse.status).toBe(409);

    expect(await getDb().select().from(roommateRequests)).toHaveLength(1);
  });

  it('PERMITS a fresh request after the first was declined', async () => {
    // The permit half. A plain `UNIQUE(from, to)` passes every refusal
    // assertion above and silently eats this one — which is a person being
    // unable to ask again, months later, with no error anybody can see.
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    const first = await request(buildApp('oxy-a')).post('/roommates/oxy-b/request');
    expect(first.status).toBe(201);

    const declined = await request(buildApp('oxy-b')).post(
      `/roommates/requests/${first.body.data.id}/decline`,
    );
    expect(declined.status).toBe(200);

    const again = await request(buildApp('oxy-a')).post('/roommates/oxy-b/request');
    expect(again.status).toBe(201);

    expect(await getDb().select().from(roommateRequests)).toHaveLength(2);
  });

  it('refuses a request to yourself with 400', async () => {
    await createRoommateProfile('oxy-a');
    const res = await request(buildApp('oxy-a')).post('/roommates/oxy-a/request');
    expect(res.status).toBe(400);
    expect(await getDb().select().from(roommateRequests)).toHaveLength(0);
  });
});

describe('respondToRoommateRequest — only the recipient, only once', () => {
  it('accepting a request materializes a relationship with a SORTED pair', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    // Seeded from `oxy-b` to `oxy-a`, so the stored pair has to be REORDERED.
    // Without the sort the row still inserts and every "a relationship exists"
    // assertion passes — `roommate_relationships_sorted_pair_check` is what
    // turns forgetting it into a loud failure, and this is the case that
    // exercises it.
    const pending = await seedPendingRequest('oxy-b', 'oxy-a');

    const res = await request(buildApp('oxy-a')).post(`/roommates/requests/${pending.id}/accept`);
    expect(res.status).toBe(200);

    const relationship = await activeRelationshipBetween('oxy-a', 'oxy-b');
    expect(relationship).toBeDefined();
    expect(relationship?.oxyUser1Id).toBe('oxy-a');
    expect(relationship?.oxyUser2Id).toBe('oxy-b');
    expect(relationship?.requestId).toBe(pending.id);
  });

  it('is idempotent — a second accept of the same request 404s and creates nothing', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    const pending = await seedPendingRequest('oxy-a', 'oxy-b');
    const app = buildApp('oxy-b');

    expect((await request(app).post(`/roommates/requests/${pending.id}/accept`)).status).toBe(200);
    // The `pending` status is in the UPDATE's own predicate, so the second call
    // matches no row rather than running the acceptance twice.
    expect((await request(app).post(`/roommates/requests/${pending.id}/accept`)).status).toBe(404);

    expect(await getDb().select().from(roommateRelationships)).toHaveLength(1);
  });

  it('converges when the pair is accepted from two different requests', async () => {
    // `roommate_relationships_active_pair_key` is what makes this one row
    // instead of two. The old upsert read first, which two concurrent accepts
    // both passed.
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    const first = await seedPendingRequest('oxy-a', 'oxy-b');
    const second = await seedPendingRequest('oxy-b', 'oxy-a');

    expect((await request(buildApp('oxy-b')).post(`/roommates/requests/${first.id}/accept`)).status).toBe(200);
    expect((await request(buildApp('oxy-a')).post(`/roommates/requests/${second.id}/accept`)).status).toBe(200);

    expect(await getDb().select().from(roommateRelationships)).toHaveLength(1);
  });

  it('does not let a non-recipient accept (404, still pending)', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    await createRoommateProfile('oxy-stranger');
    const pending = await seedPendingRequest('oxy-a', 'oxy-b');

    const res = await request(buildApp('oxy-stranger')).post(`/roommates/requests/${pending.id}/accept`);
    expect(res.status).toBe(404);

    const [row] = await getDb()
      .select()
      .from(roommateRequests)
      .where(eq(roommateRequests.id, pending.id));
    expect(row.status).toBe('pending');
    expect(await getDb().select().from(roommateRelationships)).toHaveLength(0);
  });

  it('answers 404 for a malformed request id rather than 400 or 500', async () => {
    // `ObjectId.isValid` is deleted rather than widened: post-cutover every id
    // is a uuid v7, which that guard rejected.
    await createRoommateProfile('oxy-b');
    const res = await request(buildApp('oxy-b')).post('/roommates/requests/not-an-id/accept');
    expect(res.status).toBe(404);
  });
});

describe('getRoommateRequests', () => {
  it('splits the caller\'s own sent and received requests', async () => {
    await createRoommateProfile('oxy-me');
    await seedPendingRequest('oxy-me', 'oxy-x');
    await seedPendingRequest('oxy-y', 'oxy-me');
    await seedPendingRequest('oxy-x', 'oxy-y');

    const res = await request(buildApp('oxy-me')).get('/roommates/requests');
    expect(res.status).toBe(200);
    expect(res.body.data.sent).toHaveLength(1);
    expect(res.body.data.received).toHaveLength(1);
    expect(res.body.data.sent[0].receiverOxyUserId).toBe('oxy-x');
    expect(res.body.data.received[0].senderOxyUserId).toBe('oxy-y');
  });
});

describe('endRoommateRelationship — participant-scoped', () => {
  it('DELETE /relationships/:id is participant-scoped', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    await createRoommateProfile('oxy-outsider');

    const [relationship] = await getDb()
      .insert(roommateRelationships)
      .values({ oxyUser1Id: 'oxy-a', oxyUser2Id: 'oxy-b', status: 'active', startDate: new Date() })
      .returning();

    const res = await request(buildApp('oxy-outsider')).delete(
      `/roommates/relationships/${relationship.id}`,
    );
    expect(res.status).toBe(404);

    const [stillActive] = await getDb()
      .select()
      .from(roommateRelationships)
      .where(eq(roommateRelationships.id, relationship.id));
    expect(stillActive.status).toBe('active');
    expect(stillActive.endDate).toBeNull();
  });

  it('lets a participant end it, and stamps an end date in the same statement', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    const [relationship] = await getDb()
      .insert(roommateRelationships)
      .values({ oxyUser1Id: 'oxy-a', oxyUser2Id: 'oxy-b', status: 'active', startDate: new Date() })
      .returning();

    const res = await request(buildApp('oxy-b')).delete(`/roommates/relationships/${relationship.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ended');

    const [ended] = await getDb()
      .select()
      .from(roommateRelationships)
      .where(eq(roommateRelationships.id, relationship.id));
    expect(ended.status).toBe('ended');
    // An `ended` row with no end date is a relationship nobody can say when
    // they left; the CHECK only constrains the two dates against each other.
    expect(ended.endDate).not.toBeNull();
  });

  it('PERMITS the same pair rooming together again after they parted', async () => {
    // The second permit half. `roommate_relationships_active_pair_key` is
    // partial on `status = 'active'` precisely so this is possible; a total
    // unique index refuses it, and passes every other assertion in this file.
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');

    const [first] = await getDb()
      .insert(roommateRelationships)
      .values({ oxyUser1Id: 'oxy-a', oxyUser2Id: 'oxy-b', status: 'active', startDate: new Date() })
      .returning();
    await request(buildApp('oxy-a')).delete(`/roommates/relationships/${first.id}`);

    const pending = await seedPendingRequest('oxy-a', 'oxy-b');
    const res = await request(buildApp('oxy-b')).post(`/roommates/requests/${pending.id}/accept`);
    expect(res.status).toBe(200);

    const all = await getDb().select().from(roommateRelationships);
    expect(all).toHaveLength(2);
    expect(all.filter((row) => row.status === 'active')).toHaveLength(1);
  });
});
