/**
 * The RE sidecar profile, through the REAL controllers, against the REAL
 * Postgres this worker owns.
 *
 * Four things, and the last two are the ones a port usually gets wrong:
 *
 *  1. **The nesting round-trips.** Sixteen frontend modules read
 *     `profile.personalProfile.settings.roommate.…`; the columns are flat with
 *     the wrapper dropped (63-byte identifier ceiling). Whatever the edit form
 *     sends must come back the same shape or the next save writes NULL over it.
 *  2. **Ownership.** The owner comes from the session and never from the body.
 *  3. **Privacy.** `/api/public/profiles/*` needs no authentication, so what a
 *     stranger gets is decided by the flags rather than by what happens to be
 *     stored. Mongo returned the whole document there, income included.
 *  4. **`/ai/history` writes ANYTHING AT ALL.** It used to read and write
 *     `profile.chatHistory` while `ProfileSchema` declares the array at
 *     `personalProfile.chatHistory`, so strict mode dropped it: `GET` always
 *     answered `[]`, `POST` stored nothing, `DELETE` was a no-op. All five
 *     production profiles have an empty transcript for that reason, so a test
 *     that only checked "the endpoint answers 200" would have passed against
 *     the broken version.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import aiRouter from '../../routes/ai';
import * as profileController from '../../controllers/profile';
import { getDb } from '../../db/postgres';
import { profileChatMessages, profiles } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { PROFILE_CHAT_HISTORY_LIMIT, ensureProfile } from '../../db/profiles/profileRepository';

function buildApp(oxyUserId: string | null): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
  app.get('/profiles/me', (req, res, next) => profileController.getOrCreateProfile(req, res, next));
  app.put('/profiles/me', (req, res, next) => profileController.updateMyProfile(req, res, next));
  app.get('/public/profiles/oxy/:oxyUserId', (req, res, next) =>
    profileController.getPublicProfileByOxyUserId(req, res, next),
  );
  app.use('/ai', aiRouter());
  app.use(errorHandler);
  return app;
}

const owner = (): string => `oxy-${uuidv7()}`;

beforeEach(async () => {
  await getDb().delete(profiles);
});

describe('GET /profiles/me — get or create', () => {
  it('creates the sidecar row on first read, with every column NULL', async () => {
    const oxyUserId = owner();
    const res = await request(buildApp(oxyUserId)).get('/profiles/me');

    expect(res.status).toBe(200);
    expect(res.body.data.oxyUserId).toBe(oxyUserId);

    // NOT seeded with the schema's defaults. `_createDefaultProfile` used to
    // write `language: 'en'`, `timezone: 'UTC'`, `profileVisibility: 'public'`,
    // which made "the user chose UTC" indistinguishable from "nobody asked".
    // Mongoose never materialized the sub-document either, so none of the five
    // production rows carries them.
    const [stored] = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
    expect(stored.settingsLanguage).toBeNull();
    expect(stored.settingsTimezone).toBeNull();
    expect(stored.settingsPrivacyProfileVisibility).toBeNull();
    expect(res.body.data.personalProfile.settings.language).toBeNull();
  });

  it('is idempotent — a second read returns the SAME row, not a second one', async () => {
    const oxyUserId = owner();
    const first = await request(buildApp(oxyUserId)).get('/profiles/me');
    const second = await request(buildApp(oxyUserId)).get('/profiles/me');

    expect(second.body.data.id).toBe(first.body.data.id);
    const rows = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
    expect(rows).toHaveLength(1);
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await request(buildApp(null)).get('/profiles/me');
    expect(res.status).toBe(401);
  });

  it('converges when two first requests race, INSIDE a caller transaction', async () => {
    // The hazard: `ensureProfile` runs inside a transaction its CALLER opened
    // (`updateMyProfile`, and all three `/ai/history` handlers). A caught
    // `23505` would abort that transaction, so the recovery SELECT would answer
    // `25P02 current transaction is aborted` and the race the unique index
    // exists to absorb would surface as a 500 — only under concurrency, which
    // is exactly where nobody would see it. `ON CONFLICT DO NOTHING` never
    // fails, so no statement can abort anything.
    const oxyUserId = owner();
    const db = getDb();

    const results = await Promise.all([
      db.transaction((tx) => ensureProfile(tx, oxyUserId, 'owner')),
      db.transaction((tx) => ensureProfile(tx, oxyUserId, 'owner')),
      db.transaction((tx) => ensureProfile(tx, oxyUserId, 'owner')),
    ]);

    const ids = new Set(results.map((r) => r.profile.id));
    expect(ids.size).toBe(1);
    expect(await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId))).toHaveLength(1);
  });

  it('converges when the row is created between the read and the insert', async () => {
    // The narrow window the `ON CONFLICT` branch exists for, forced rather than
    // waited for: the row appears after `ensureProfile` has already looked and
    // found nothing, so the insert is the statement that meets the conflict.
    const oxyUserId = owner();
    const db = getDb();

    await db.transaction(async (tx) => {
      const before = await tx.select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
      expect(before).toHaveLength(0);
      // A committed row from "another request", inserted on the ROOT handle so
      // it is visible to the transaction's next statement.
      await getDb().insert(profiles).values({ oxyUserId });

      const converged = await ensureProfile(tx, oxyUserId, 'owner');
      expect(converged.profile.oxyUserId).toBe(oxyUserId);
      // The transaction is still usable afterwards, which is the whole point.
      const after = await tx.select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
      expect(after).toHaveLength(1);
    });
  });
});

describe('PUT /profiles/me — the allow-listed write', () => {
  it('round-trips the whole personalProfile subtree', async () => {
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    const sent = {
      personalProfile: {
        personalInfo: {
          bio: '  Tenant in Gràcia  ',
          occupation: 'Nurse',
          employmentStatus: 'employed',
          leaseDuration: 'yearly',
        },
        preferences: {
          propertyTypes: ['apartment', 'room'],
          maxRent: 1200,
          priceUnit: 'month',
          preferredAmenities: ['  Balcony ', 'LIFT'],
          preferredLocations: [{ city: 'Barcelona', state: 'Catalonia', radius: 5 }],
          petFriendly: true,
        },
        settings: {
          privacy: { profileVisibility: 'public', showContactInfo: true, showRentalHistory: true },
          roommate: {
            enabled: true,
            preferences: {
              ageRange: { min: 25, max: 40 },
              gender: 'any',
              lifestyle: { smoking: 'no', cleanliness: 'very_clean', schedule: 'early_bird' },
              budget: { min: 500, max: 900 },
              leaseDuration: '6_months',
            },
            history: [
              { startDate: '2024-01-01T00:00:00.000Z', location: 'Sants', roommateCount: 2 },
            ],
          },
          language: 'ca',
          timezone: 'Europe/Madrid',
          currency: 'EUR',
        },
      },
    };

    const put = await request(app).put('/profiles/me').send(sent);
    expect(put.status).toBe(200);

    const read = await request(app).get('/profiles/me');
    const p = read.body.data.personalProfile;

    // Trimmed and lowercased at the CALL SITE — Mongo's `trim`/`lowercase` are
    // application behaviour with no Postgres counterpart.
    expect(p.personalInfo.bio).toBe('Tenant in Gràcia');
    expect(p.preferences.preferredAmenities).toEqual(['balcony', 'lift']);

    expect(p.personalInfo.employmentStatus).toBe('employed');
    expect(p.preferences.propertyTypes).toEqual(['apartment', 'room']);
    expect(p.preferences.maxRent).toBe(1200);
    expect(p.preferences.preferredLocations).toHaveLength(1);
    expect(p.preferences.preferredLocations[0]).toMatchObject({ city: 'Barcelona', radius: 5 });
    expect(p.settings.roommate.enabled).toBe(true);
    expect(p.settings.roommate.preferences.ageRange).toEqual({ min: 25, max: 40 });
    expect(p.settings.roommate.preferences.lifestyle.cleanliness).toBe('very_clean');
    expect(p.settings.roommate.preferences.budget).toEqual({ min: 500, max: 900 });
    expect(p.settings.roommate.history).toHaveLength(1);
    expect(p.settings.roommate.history[0].location).toBe('Sants');
    expect(p.settings.language).toBe('ca');
    expect(p.settings.currency).toBe('EUR');
  });

  it('replaces only the blocks the body carries', async () => {
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    await request(app)
      .put('/profiles/me')
      .send({
        personalProfile: {
          personalInfo: { bio: 'first' },
          preferences: { maxRent: 900 },
        },
      });

    // A second save naming only `personalInfo` must not blank `preferences`.
    await request(app)
      .put('/profiles/me')
      .send({ personalProfile: { personalInfo: { occupation: 'Teacher' } } });

    const read = await request(app).get('/profiles/me');
    const p = read.body.data.personalProfile;
    expect(p.preferences.maxRent).toBe(900);
    // …and within the block it DID name, an omitted field is cleared, which is
    // what makes "delete my bio" expressible at all.
    expect(p.personalInfo.bio).toBeNull();
    expect(p.personalInfo.occupation).toBe('Teacher');
  });

  it('ignores an oxyUserId, id or timestamp in the body', async () => {
    const oxyUserId = owner();
    const attacker = owner();
    const app = buildApp(oxyUserId);
    await request(app).get('/profiles/me');

    const res = await request(app)
      .put('/profiles/me')
      .send({
        oxyUserId: attacker,
        id: 'forged-id',
        createdAt: '1999-01-01T00:00:00.000Z',
        personalProfile: { personalInfo: { bio: 'mine' } },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.oxyUserId).toBe(oxyUserId);
    expect(res.body.data.id).not.toBe('forged-id');
    // The attacker's account gained nothing.
    const rows = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, attacker));
    expect(rows).toHaveLength(0);
  });

  it('drops a value outside a declared vocabulary rather than 500ing on the CHECK', async () => {
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    const res = await request(app)
      .put('/profiles/me')
      .send({
        personalProfile: {
          personalInfo: { employmentStatus: 'freelance-ish', leaseDuration: 'forever' },
          preferences: { propertyTypes: ['apartment', 'spaceship'] },
        },
      });

    expect(res.status).toBe(200);
    const p = res.body.data.personalProfile;
    expect(p.personalInfo.employmentStatus).toBeNull();
    expect(p.personalInfo.leaseDuration).toBeNull();
    expect(p.preferences.propertyTypes).toEqual(['apartment']);
  });

  it('drops a rental-history entry whose end date precedes its start', async () => {
    // `profile_rental_history_order_check` would answer `23514`, i.e. a 500 on a
    // form the user can see and fix.
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    const res = await request(app)
      .put('/profiles/me')
      .send({
        personalProfile: {
          settings: { privacy: { showRentalHistory: true } },
          rentalHistory: [
            {
              address: 'Backwards',
              startDate: '2025-01-01T00:00:00.000Z',
              endDate: '2024-01-01T00:00:00.000Z',
            },
            { address: 'Fine', startDate: '2024-01-01T00:00:00.000Z' },
          ],
        },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.personalProfile.rentalHistory).toHaveLength(1);
    expect(res.body.data.personalProfile.rentalHistory[0].address).toBe('Fine');
  });

  it('creates the row when the first request is a PUT', async () => {
    const oxyUserId = owner();
    const res = await request(buildApp(oxyUserId))
      .put('/profiles/me')
      .send({ personalProfile: { personalInfo: { bio: 'straight to edit' } } });
    expect(res.status).toBe(200);
    expect(res.body.data.personalProfile.personalInfo.bio).toBe('straight to edit');
  });
});

describe('the public read — what a stranger gets', () => {
  async function seed(oxyUserId: string, privacy: Record<string, unknown>) {
    await request(buildApp(oxyUserId))
      .put('/profiles/me')
      .send({
        personalProfile: {
          personalInfo: { bio: 'Public bio', annualIncome: 48000 },
          settings: { privacy },
          references: [{ name: 'Ana', relationship: 'landlord', phone: '+34600000000' }],
          rentalHistory: [
            {
              address: 'Carrer Gran 1',
              startDate: '2023-01-01T00:00:00.000Z',
              monthlyRent: 950,
              landlordContact: { name: 'Ana', phone: '+34600000000', email: 'ANA@Example.com' },
            },
          ],
        },
      });
  }

  it('never carries the annual income to a STRANGER', async () => {
    const oxyUserId = owner();
    await seed(oxyUserId, { showIncome: true, showContactInfo: true, showRentalHistory: true });

    // `profiles.personal_info_annual_income` is a PROTECTED COLUMN: excluded at
    // the TYPE level by `publicColumns(profiles)`, so the public path has no
    // field to leak by accident — not even with `showIncome` deliberately on,
    // which is a per-viewer decision the application has not been built to make.
    const stored = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
    expect(stored[0].personalInfoAnnualIncome).toBe(48000);

    const publicRead = await request(buildApp(null)).get(`/public/profiles/oxy/${oxyUserId}`);
    expect(JSON.stringify(publicRead.body)).not.toContain('48000');
    expect(publicRead.body.data.personalProfile.personalInfo).not.toHaveProperty('annualIncome');
  });

  it('DOES return the income to its owner, or the next save would erase it', async () => {
    // The owner read names the protected column explicitly — the escape hatch
    // `protectedColumns.ts` sanctions. Withholding it from the owner is not a
    // privacy win: the edit form round-trips the whole `personalInfo` block, and
    // a block that comes back without a key it never received writes NULL over
    // the stored value. Excluding it here would silently delete people's income.
    const oxyUserId = owner();
    await seed(oxyUserId, { showContactInfo: true });

    const ownerRead = await request(buildApp(oxyUserId)).get('/profiles/me');
    expect(ownerRead.body.data.personalProfile.personalInfo.annualIncome).toBe(48000);
  });

  it('survives the edit form round trip rather than being blanked', async () => {
    // The regression this exists to catch, end to end: read the profile, send
    // the `personalInfo` block straight back the way the edit form does, and
    // assert the income is still there.
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    await seed(oxyUserId, { showContactInfo: true });

    const read = await request(app).get('/profiles/me');
    const personalInfo = read.body.data.personalProfile.personalInfo;
    await request(app).put('/profiles/me').send({ personalProfile: { personalInfo } });

    const after = await request(app).get('/profiles/me');
    expect(after.body.data.personalProfile.personalInfo.annualIncome).toBe(48000);
    const stored = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
    expect(stored[0].personalInfoAnnualIncome).toBe(48000);
  });

  it('still lets the owner clear their income deliberately', async () => {
    // The other direction: an explicit null must not be ignored, or "remove my
    // income" becomes impossible.
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    await seed(oxyUserId, { showContactInfo: true });

    await request(app)
      .put('/profiles/me')
      .send({ personalProfile: { personalInfo: { bio: 'kept', annualIncome: null } } });

    const stored = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
    expect(stored[0].personalInfoAnnualIncome).toBeNull();
  });

  it('withholds references and the tenancy from a stranger by default', async () => {
    const oxyUserId = owner();
    // Both flags default to FALSE in the product; here they are explicit so the
    // case states what it is testing rather than relying on absence.
    await seed(oxyUserId, { showReferences: false, showRentalHistory: false, showContactInfo: false });

    const res = await request(buildApp(null)).get(`/public/profiles/oxy/${oxyUserId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.personalProfile.references).toEqual([]);
    expect(res.body.data.personalProfile.rentalHistory).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain('+34600000000');
    expect(JSON.stringify(res.body)).not.toContain('ana@example.com');
  });

  it('discloses the landlord contact when showContactInfo is on, and nothing else', async () => {
    // This is the "call the owner" path: `app/properties/[id]` reads a PUBLIC
    // profile's `rentalHistory[0].landlordContact.phone` and gates on
    // `showContactInfo`. Gating the contact on `showRentalHistory` (default
    // FALSE) would silently kill that feature for every user.
    const oxyUserId = owner();
    await seed(oxyUserId, { showContactInfo: true, showRentalHistory: false });

    const res = await request(buildApp(null)).get(`/public/profiles/oxy/${oxyUserId}`);
    const [entry] = res.body.data.personalProfile.rentalHistory;
    expect(entry.landlordContact.phone).toBe('+34600000000');
    // The tenancy itself is ABSENT rather than null: absent means "not
    // disclosed", null would mean "never recorded".
    expect(entry).not.toHaveProperty('address');
    expect(entry).not.toHaveProperty('monthlyRent');
  });

  it('gives the owner everything the two flags withhold from a stranger', async () => {
    const oxyUserId = owner();
    await seed(oxyUserId, { showReferences: false, showRentalHistory: false, showContactInfo: false });

    const res = await request(buildApp(oxyUserId)).get('/profiles/me');
    expect(res.body.data.personalProfile.references).toHaveLength(1);
    expect(res.body.data.personalProfile.rentalHistory[0].address).toBe('Carrer Gran 1');
  });

  it('404s a profile that does not exist rather than creating one', async () => {
    const stranger = owner();
    const res = await request(buildApp(null)).get(`/public/profiles/oxy/${stranger}`);
    expect(res.status).toBe(404);
    expect(await getDb().select().from(profiles).where(eq(profiles.oxyUserId, stranger))).toHaveLength(0);
  });
});

describe('/ai/history — the transcript that never persisted', () => {
  it('stores a turn and reads it back newest-first', async () => {
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);

    const post = await request(app)
      .post('/ai/history')
      .send({ userMessage: 'What is a fianza?', assistantMessage: 'A deposit.' });
    expect(post.status).toBe(200);

    const get = await request(app).get('/ai/history');
    expect(get.status).toBe(200);
    // Newest first, matching the Mongo handler's `[...].reverse()`.
    expect(get.body.history.map((m: { content: string }) => m.content)).toEqual([
      'A deposit.',
      'What is a fianza?',
    ]);
    expect(get.body.history.map((m: { role: string }) => m.role)).toEqual(['assistant', 'user']);
  });

  it('keeps the pair in order across appends, on position and not on timestamp', async () => {
    // Both turns of one call share a timestamp, exactly as the Mongo handler's
    // single `new Date()` did — so `position` is the only thing that can order
    // them.
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    await request(app).post('/ai/history').send({ userMessage: 'q1', assistantMessage: 'a1' });
    await request(app).post('/ai/history').send({ userMessage: 'q2', assistantMessage: 'a2' });

    const get = await request(app).get('/ai/history');
    expect(get.body.history.map((m: { content: string }) => m.content)).toEqual([
      'a2',
      'q2',
      'a1',
      'q1',
    ]);
  });

  it('trims to the cap, keeping the NEWEST turns', async () => {
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    const pairs = PROFILE_CHAT_HISTORY_LIMIT / 2 + 3;
    for (let i = 0; i < pairs; i += 1) {
      await request(app).post('/ai/history').send({ userMessage: `q${i}`, assistantMessage: `a${i}` });
    }

    const [profile] = await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId));
    const stored = await getDb()
      .select()
      .from(profileChatMessages)
      .where(eq(profileChatMessages.profileId, profile.id));
    expect(stored).toHaveLength(PROFILE_CHAT_HISTORY_LIMIT);

    const get = await request(app).get('/ai/history');
    expect(get.body.history[0].content).toBe(`a${pairs - 1}`);
    expect(get.body.history).toHaveLength(PROFILE_CHAT_HISTORY_LIMIT);
    // The oldest turns really went, rather than the newest being refused.
    expect(get.body.history.map((m: { content: string }) => m.content)).not.toContain('q0');
  });

  it('clears the transcript and leaves the profile', async () => {
    const oxyUserId = owner();
    const app = buildApp(oxyUserId);
    await request(app).post('/ai/history').send({ userMessage: 'q', assistantMessage: 'a' });

    const del = await request(app).delete('/ai/history');
    expect(del.status).toBe(200);
    expect(del.body.cleared).toBe(2);

    expect((await request(app).get('/ai/history')).body.history).toEqual([]);
    expect(await getDb().select().from(profiles).where(eq(profiles.oxyUserId, oxyUserId))).toHaveLength(1);
  });

  it('never mixes two people\'s transcripts', async () => {
    const a = owner();
    const b = owner();
    await request(buildApp(a)).post('/ai/history').send({ userMessage: 'a-q', assistantMessage: 'a-a' });
    await request(buildApp(b)).post('/ai/history').send({ userMessage: 'b-q', assistantMessage: 'b-a' });

    const read = await request(buildApp(a)).get('/ai/history');
    expect(read.body.history.map((m: { content: string }) => m.content)).toEqual(['a-a', 'a-q']);
  });

  it('400s a call missing either half of the turn', async () => {
    const app = buildApp(owner());
    expect((await request(app).post('/ai/history').send({ userMessage: 'q' })).status).toBe(400);
    expect((await request(app).post('/ai/history').send({ assistantMessage: 'a' })).status).toBe(400);
  });

  it('refuses an unauthenticated caller on all three verbs', async () => {
    const app = buildApp(null);
    expect((await request(app).get('/ai/history')).status).toBe(401);
    expect((await request(app).delete('/ai/history')).status).toBe(401);
    expect((await request(app).post('/ai/history').send({ userMessage: 'q', assistantMessage: 'a' })).status).toBe(401);
  });
});
