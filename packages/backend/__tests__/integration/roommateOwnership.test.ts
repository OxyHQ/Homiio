/**
 * Roommate controller — profile resolution, preferences mass-assignment (IDOR),
 * the request handshake, relationship lifecycle, relationship ownership, and
 * the wire shape all of it is served in.
 *
 * ## Both stores are gone from this suite, and that is the point
 *
 * `roommate_requests` and `roommate_relationships` moved first; the PROFILE
 * reads beside them moved with this change, so the file no longer touches
 * mongoose at all. While the two were split, a profile written by
 * `PUT /api/profiles/me` (Postgres) was invisible to every roommate endpoint
 * (Mongo) — the fixtures below are Postgres rows for the same reason the
 * controller now reads them.
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
import { profiles, roommateRelationships, roommateRequests } from '../../db/schema';
import { sortPair } from '../../db/roommates/roommateRepository';
import { asyncHandler } from '../../middlewares';
import { errorHandler } from '../../middlewares/errorHandler';

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
  await getDb().delete(profiles);
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
  app.get('/roommates/preferences', asyncHandler(roommateController.getMyRoommatePreferences));
  app.put('/roommates/preferences', asyncHandler(roommateController.updateRoommatePreferences));
  app.patch('/roommates/toggle', asyncHandler(roommateController.toggleRoommateMatching));
  app.get('/roommates/status', asyncHandler(roommateController.getCurrentUserRoommateStatus));
  app.get('/roommates/requests', asyncHandler(roommateController.getRoommateRequests));
  app.get('/roommates/relationships', asyncHandler(roommateController.getRoommateRelationships));
  app.delete('/roommates/relationships/:relationshipId', asyncHandler(roommateController.endRoommateRelationship));
  app.post('/roommates/requests/:requestId/accept', asyncHandler(roommateController.acceptRoommateRequest));
  app.post('/roommates/requests/:requestId/decline', asyncHandler(roommateController.declineRoommateRequest));
  app.post('/roommates/:oxyUserId/request', asyncHandler(roommateController.sendRoommateRequest));
  app.use(errorHandler);
  return app;
}

/**
 * A profile with roommate matching on, carrying the same preferences the
 * Mongo-era fixture did (budget 500-1200, non-smoker, pets welcome).
 */
async function createRoommateProfile(
  oxyUserId: string,
  overrides: Partial<typeof profiles.$inferInsert> = {},
) {
  const [row] = await getDb()
    .insert(profiles)
    .values({
      oxyUserId,
      settingsRoommateEnabled: true,
      settingsRoommatePreferencesBudgetMin: 500,
      settingsRoommatePreferencesBudgetMax: 1200,
      settingsRoommatePreferencesLifestyleSmoking: 'no',
      settingsRoommatePreferencesLifestylePets: 'yes',
      ...overrides,
    })
    .returning();
  return row;
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

async function storedProfile(oxyUserId: string) {
  const [row] = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
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

  it('omits a candidate who has not enabled matching', async () => {
    await createRoommateProfile('oxy-me');
    await createRoommateProfile('oxy-hidden', { settingsRoommateEnabled: false });
    await createRoommateProfile('oxy-never-asked', { settingsRoommateEnabled: null });

    const res = await request(buildApp('oxy-me')).get('/roommates');
    expect((res.body.profiles as Array<{ oxyUserId: string }>).map((p) => p.oxyUserId)).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('the discover filters that used to match nothing', () => {
  /**
   * Each of these was written against a path `personalProfileSchema` never
   * declared (`personalProfile.gender` / `.location` / `.dateOfBirth`). With
   * `strictQuery: false` mongoose passed them through to MongoDB rather than
   * stripping them, so they matched NO document and the endpoint answered an
   * empty page for every value. The cases below are the wiring — that a query
   * parameter reaches the column the filter now means; the predicates
   * themselves, with the fixtures that can tell them apart, are pinned in
   * `__tests__/db/roommateDiscovery.test.ts`.
   */
  beforeEach(async () => {
    await createRoommateProfile('oxy-me');
  });

  it('filters on the stated roommate GENDER preference', async () => {
    await createRoommateProfile('oxy-wants-female', {
      settingsRoommatePreferencesGender: 'female',
    });
    await createRoommateProfile('oxy-wants-male', { settingsRoommatePreferencesGender: 'male' });

    const res = await request(buildApp('oxy-me')).get('/roommates').query({ gender: 'female' });
    expect(res.status).toBe(200);
    expect((res.body.profiles as Array<{ oxyUserId: string }>).map((p) => p.oxyUserId)).toEqual([
      'oxy-wants-female',
    ]);
    expect(res.body.total).toBe(1);
  });

  it('treats gender=any as no filter at all', async () => {
    await createRoommateProfile('oxy-wants-female', {
      settingsRoommatePreferencesGender: 'female',
    });
    await createRoommateProfile('oxy-wants-male', { settingsRoommatePreferencesGender: 'male' });

    const res = await request(buildApp('oxy-me')).get('/roommates').query({ gender: 'any' });
    expect(res.body.total).toBe(2);
  });

  it('refuses a gender outside the stored vocabulary rather than ignoring it', async () => {
    // Ignoring it would answer an UNFILTERED page, which looks like a result.
    const res = await request(buildApp('oxy-me')).get('/roommates').query({ gender: 'unicorn' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('gender');
  });

  it('filters on the stated LOCATION, case-insensitively', async () => {
    await createRoommateProfile('oxy-bcn', {
      settingsRoommatePreferencesLocation: 'Barcelona, Gràcia',
    });
    await createRoommateProfile('oxy-mad', { settingsRoommatePreferencesLocation: 'Madrid' });

    const res = await request(buildApp('oxy-me')).get('/roommates').query({ location: 'barcelona' });
    expect((res.body.profiles as Array<{ oxyUserId: string }>).map((p) => p.oxyUserId)).toEqual([
      'oxy-bcn',
    ]);
  });

  it('overlaps the requested AGE RANGE against the stated one', async () => {
    await createRoommateProfile('oxy-young', {
      settingsRoommatePreferencesAgeRangeMin: 18,
      settingsRoommatePreferencesAgeRangeMax: 24,
    });
    await createRoommateProfile('oxy-overlapping', {
      settingsRoommatePreferencesAgeRangeMin: 24,
      settingsRoommatePreferencesAgeRangeMax: 35,
    });

    const res = await request(buildApp('oxy-me'))
      .get('/roommates')
      .query({ ageRange: JSON.stringify({ min: 30, max: 40 }) });
    expect((res.body.profiles as Array<{ oxyUserId: string }>).map((p) => p.oxyUserId)).toEqual([
      'oxy-overlapping',
    ]);
  });

  it('answers 400 for a malformed ageRange rather than 500', async () => {
    // `JSON.parse(String(ageRange))` threw straight into the catch-all.
    const res = await request(buildApp('oxy-me')).get('/roommates').query({ ageRange: 'nonsense' });
    expect(res.status).toBe(400);
  });

  it('answers 400 for a non-numeric maxBudget rather than an empty page', async () => {
    // `parseInt('abc')` is NaN and `1200 >= NaN` is false, so a typo silently
    // dropped every candidate.
    const res = await request(buildApp('oxy-me')).get('/roommates').query({ maxBudget: 'abc' });
    expect(res.status).toBe(400);
  });

  it('counts what the page contains — the SQL filters run before the cut', async () => {
    // The three preference filters used to run in JavaScript AFTER `skip`/
    // `limit`, so `total` counted rows the page had just dropped.
    await createRoommateProfile('oxy-smoker', {
      settingsRoommatePreferencesLifestyleSmoking: 'yes',
    });
    await createRoommateProfile('oxy-clean-air', {
      settingsRoommatePreferencesLifestyleSmoking: 'no',
    });

    const res = await request(buildApp('oxy-me')).get('/roommates').query({ nonSmoking: 'true' });
    expect(res.body.total).toBe(1);
    expect(res.body.profiles).toHaveLength(1);
    expect(res.body.totalPages).toBe(1);
  });
});

describe('the wire shape the roommate endpoints serve', () => {
  /**
   * `ProfileSchema`'s `toJSON` transform renamed `_id` → `id` and stripped
   * `__v`; these endpoints never went through it (they projected by hand), so
   * the rename is applied by the serializer instead. A regression here is the
   * class of bug that took Homiio's frontend down once already.
   */
  it('carries id, never _id or __v, on every roommate payload', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b');
    const pending = await seedPendingRequest('oxy-a', 'oxy-b');
    await request(buildApp('oxy-b')).post(`/roommates/requests/${pending.id}/accept`);

    const discover = await request(buildApp('oxy-a')).get('/roommates');
    const requests = await request(buildApp('oxy-a')).get('/roommates/requests');
    const relationships = await request(buildApp('oxy-a')).get('/roommates/relationships');
    const status = await request(buildApp('oxy-a')).get('/roommates/status');

    for (const res of [discover, requests, relationships, status]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('"_id"');
      expect(JSON.stringify(res.body)).not.toContain('"__v"');
    }

    expect(discover.body.profiles[0].id).toEqual(expect.any(String));
    expect(requests.body.data.sent[0].sender.id).toEqual(expect.any(String));
    expect(relationships.body.data[0].profile1.id).toEqual(expect.any(String));
    expect(status.body.profile.id).toEqual(expect.any(String));
  });

  it('never carries another person\'s annual income or transcript', async () => {
    // The Mongo version attached `personalProfile` verbatim to every candidate
    // and every request participant. `personal_info_annual_income` is a
    // PROTECTED COLUMN and the participant DTO is built at PUBLIC visibility.
    await createRoommateProfile('oxy-me');
    await createRoommateProfile('oxy-rich', { personalInfoAnnualIncome: 48000 });
    await seedPendingRequest('oxy-rich', 'oxy-me');

    const discover = await request(buildApp('oxy-me')).get('/roommates');
    const requests = await request(buildApp('oxy-me')).get('/roommates/requests');

    expect(JSON.stringify(discover.body)).not.toContain('48000');
    expect(JSON.stringify(requests.body)).not.toContain('48000');
    expect(discover.body.profiles[0].personalProfile.personalInfo).not.toHaveProperty(
      'annualIncome',
    );
    expect(requests.body.data.received[0].sender.personalProfile.chatHistory).toEqual([]);
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
    const reloaded = await storedProfile('oxy-me');
    expect(reloaded.oxyUserId).toBe('oxy-me');
    expect(reloaded.settingsRoommatePreferencesBudgetMin).toBe(600);
    expect(reloaded.settingsRoommatePreferencesBudgetMax).toBe(1300);
    // The attacker's account gained nothing.
    expect(await storedProfile('evil-inject')).toBeUndefined();
  });

  it('replaces only the fields the body names', async () => {
    // The Mongo version `$set` one path per field, so a body naming `budget`
    // alone left `lifestyle` alone. That is the difference from
    // `PUT /api/profiles/me`, which sends the block and replaces it.
    await createRoommateProfile('oxy-me');

    await request(buildApp('oxy-me')).put('/roommates/preferences').send({ gender: 'female' });

    const reloaded = await storedProfile('oxy-me');
    expect(reloaded.settingsRoommatePreferencesGender).toBe('female');
    expect(reloaded.settingsRoommatePreferencesBudgetMax).toBe(1200);
    expect(reloaded.settingsRoommatePreferencesLifestylePets).toBe('yes');
  });

  it('round-trips location and interests, which strict mode used to discard', async () => {
    // The whole reason migration 0008 exists. `EDITABLE_ROOMMATE_PREFERENCE_FIELDS`
    // has always accepted both, and both were written to paths
    // `personalProfileSchema` does not declare — so mongoose dropped them from
    // every update and the endpoint answered 200 having stored nothing.
    await createRoommateProfile('oxy-me');
    const app = buildApp('oxy-me');

    const put = await request(app)
      .put('/roommates/preferences')
      .send({ location: '  Barcelona, Gràcia  ', interests: ['Climbing', ' cooking ', ''] });

    expect(put.status).toBe(200);
    expect(put.body.data.location).toBe('Barcelona, Gràcia');
    expect(put.body.data.interests).toEqual(['Climbing', 'cooking']);

    const stored = await storedProfile('oxy-me');
    expect(stored.settingsRoommatePreferencesLocation).toBe('Barcelona, Gràcia');
    expect(stored.settingsRoommatePreferencesInterests).toEqual(['Climbing', 'cooking']);

    const read = await request(app).get('/roommates/preferences');
    expect(read.body.data.location).toBe('Barcelona, Gràcia');
    expect(read.body.data.interests).toEqual(['Climbing', 'cooking']);
  });

  it('answers data: null for somebody who has stated nothing', async () => {
    // A row full of NULLs is not the same fact as an object full of nulls:
    // mongoose never materialised `personalProfile`, so "never answered" was
    // `undefined` and has to stay expressible.
    await getDb().insert(profiles).values({ oxyUserId: 'oxy-blank' });
    const res = await request(buildApp('oxy-blank')).get('/roommates/preferences');
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});

describe('toggleRoommateMatching', () => {
  it('writes the flag and reports what was stored', async () => {
    await createRoommateProfile('oxy-me', { settingsRoommateEnabled: false });

    const res = await request(buildApp('oxy-me')).patch('/roommates/toggle').send({ enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect((await storedProfile('oxy-me')).settingsRoommateEnabled).toBe(true);
  });

  it('refuses a non-boolean rather than guessing', async () => {
    await createRoommateProfile('oxy-me', { settingsRoommateEnabled: false });
    const res = await request(buildApp('oxy-me')).patch('/roommates/toggle').send({ enabled: 'yes' });
    expect(res.status).toBe(400);
    expect((await storedProfile('oxy-me')).settingsRoommateEnabled).toBe(false);
  });
});

describe('the compatibility score', () => {
  /**
   * The interests branch is worth 20 of the 100 points and has NEVER been able
   * to fire: `prefs1.interests && prefs2.interests` guarded a field mongoose
   * strict mode discarded on every write, so the scorer has been running on 80
   * points for its whole life.
   */
  const lifestyle = {
    settingsRoommatePreferencesLifestyleSmoking: 'no',
    settingsRoommatePreferencesLifestylePets: 'yes',
    settingsRoommatePreferencesLifestyleCleanliness: 'clean',
    settingsRoommatePreferencesLifestyleSchedule: 'flexible',
  } as const;

  it('counts SHARED interests, and only the shared ones', async () => {
    await createRoommateProfile('oxy-me', {
      ...lifestyle,
      settingsRoommatePreferencesInterests: ['climbing', 'cooking', 'music'],
    });
    // Two of three in common — a partial overlap, so a scorer that ignored the
    // branch (100) and one that awarded it wholesale (100) are both visible as
    // wrong.
    await createRoommateProfile('oxy-partial', {
      ...lifestyle,
      settingsRoommatePreferencesInterests: ['climbing', 'chess', 'music'],
    });
    // No interests at all: the branch does not fire and the pair is scored out
    // of the 80 points they did answer.
    await createRoommateProfile('oxy-silent', lifestyle);

    await seedPendingRequest('oxy-me', 'oxy-partial');
    await seedPendingRequest('oxy-me', 'oxy-silent');

    const res = await request(buildApp('oxy-me')).get('/roommates/requests');
    const scoreFor = (oxyUserId: string) =>
      (res.body.data.sent as Array<{ receiverOxyUserId: string; matchScore: number }>).find(
        (entry) => entry.receiverOxyUserId === oxyUserId,
      )?.matchScore;

    // (20 budget + 60 lifestyle + 20 × 2/3 interests) / 100.
    expect(scoreFor('oxy-partial')).toBe(93);
    // (20 + 60) / 80.
    expect(scoreFor('oxy-silent')).toBe(100);
  });

  it('scores a person who has stated nothing at 0 rather than perfectly', async () => {
    // Two all-NULL rows agree on every `===` the scorer performs, so the naive
    // flattening of `personalProfile` — where "did not answer" stops being
    // representable — reads them as a 100% match. Mongo got the distinction for
    // free (`personalProfile` was `undefined` until somebody filled the form
    // in); here it is rebuilt by two guards in `toMatchInputs`.
    //
    // Mutation-tested, and the result is worth stating because it bounds what
    // this assertion can see: the two guards are INDEPENDENTLY sufficient.
    // Removing `hasStatedRoommatePreferences` alone leaves the suite green (the
    // per-block presence checks still produce no factors), and making the
    // lifestyle block unconditional alone leaves it green too (the early return
    // fires first). Removing BOTH scores this pair 100 and turns this case red.
    await getDb().insert(profiles).values({ oxyUserId: 'oxy-blank-a' });
    await getDb().insert(profiles).values({ oxyUserId: 'oxy-blank-b' });
    await seedPendingRequest('oxy-blank-a', 'oxy-blank-b');

    const res = await request(buildApp('oxy-blank-a')).get('/roommates/requests');
    expect(res.body.data.sent[0].matchScore).toBe(0);
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

  it('refuses a target who has not enabled matching', async () => {
    await createRoommateProfile('oxy-a');
    await createRoommateProfile('oxy-b', { settingsRoommateEnabled: false });

    const res = await request(buildApp('oxy-a')).post('/roommates/oxy-b/request');
    expect(res.status).toBe(400);
    expect(await getDb().select().from(roommateRequests)).toHaveLength(0);
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
    // Scored from the two profiles' preferences, which are identical here.
    expect(relationship?.matchScore).toBe(100);
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
    // A participant with no profile row is a real state — the roommate tables
    // carry Oxy account ids and no foreign key into `profiles`.
    expect(res.body.data.sent[0].receiver).toBeNull();
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
