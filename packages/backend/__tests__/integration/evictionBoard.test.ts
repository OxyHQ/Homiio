/**
 * Eviction solidarity board — ownership, local scope, RSVP, timeline, comments,
 * reports and public browse behaviour.
 *
 * Uses the real eviction controllers against a real PostgreSQL server, mounted
 * behind a fake-auth middleware (mirrors leaseOwnership / notificationOwnership
 * tests). `buildApp()` with no id models an anonymous public viewer.
 *
 * Privacy — the public/private location split, the approximation, the access
 * grants and the role matrix — lives in `evictionPrivacy.test.ts`. The timeline's
 * ordering, immutability and state transitions live in `evictionTimeline.test.ts`.
 * This file is the board's ordinary behaviour, and its assertions read the
 * TABLES wherever a controller could otherwise be marking its own homework.
 *
 * ## Two things changed shape with #358, and the tests changed with them
 *
 * **The board refuses a request that names no place.** Every list assertion here
 * therefore passes a scope, and one test asserts the refusal itself — a board
 * that quietly answered with the world would still return plausible results,
 * which is why the negative case is the load-bearing one.
 *
 * **An RSVP no longer unlocks the organiser's contact.** ADR 0003 §7.3.1 needs a
 * second factor, so the contact tests now build a supporter who satisfies one
 * (Homiio tenure, or a vouch from somebody who does) and a supporter who does
 * not. The previous suite pinned the one-tap unlock deliberately; it is replaced
 * deliberately.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import { sendEvictionOutcomeReminders } from '../../services/evictionOutcomeReminderService';

import * as eviction from '../../controllers/eviction';
import { getDb } from '../../db/postgres';
import {
  evictionCaseAttendees,
  evictionCaseFollowers,
  evictionCaseUpdates,
  evictionCases,
  evictionComments,
  evictionReports,
  notifications,
  profiles,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { assertFound } from '../helpers/assertFound';

/** The comment row with this id, if it is still there. */
async function commentsWithId(commentId: string) {
  return getDb().select().from(evictionComments).where(eq(evictionComments.id, commentId));
}

async function notificationsOfType(type: string) {
  return getDb().select().from(notifications).where(eq(notifications.type, type));
}

/**
 * Give an Oxy id a Homiio profile old enough to satisfy a case's tenure bar.
 *
 * The tenure signal is the profile's own `created_at`, so a test that wants a
 * CONFIRMED supporter has to create one — which is the point: a caller with no
 * profile, or a new one, is exactly the shape the second factor exists to slow
 * down, and a fixture that skipped this would test the unlocked path only.
 */
async function giveProfileAgedDays(oxyUserId: string, days: number): Promise<void> {
  await getDb()
    .insert(profiles)
    .values({
      oxyUserId,
      createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    });
}

/**
 * The whole domain is Postgres, notifications included.
 *
 * Clearing `eviction_cases` is NOT optional and its absence was a real defect
 * while this domain was half-ported: leftover cases from earlier tests leaked
 * into the public-browse assertions and into the outcome-reminder sweep, so two
 * tests passed or failed depending on what ran before them. Every child table
 * CASCADEs from it. `profiles` is cleared too now that tenure is a real signal.
 */
beforeEach(async () => {
  await getDb().delete(notifications);
  await getDb().delete(evictionCases);
  await getDb().delete(profiles);
});

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });

  // Public reads (statics before `/:id`).
  app.get('/evictions', (req, res, next) => eviction.listEvictions(req, res, next));
  app.get('/evictions/resources', (req, res, next) => eviction.listResources(req, res, next));
  app.get('/evictions/me/list', (req, res, next) => eviction.listMyEvictions(req, res, next));
  app.get('/evictions/me/attending', (req, res, next) =>
    eviction.listAttendingEvictions(req, res, next),
  );
  app.get('/evictions/me/following', (req, res, next) =>
    eviction.listFollowedEvictions(req, res, next),
  );
  app.get('/evictions/:id/comments', (req, res, next) => eviction.listComments(req, res, next));
  app.get('/evictions/:id', (req, res, next) => eviction.getEvictionById(req, res, next));

  // Writes.
  app.post('/evictions', (req, res, next) => eviction.createEviction(req, res, next));
  app.put('/evictions/:id', (req, res, next) => eviction.updateEviction(req, res, next));
  app.delete('/evictions/:id/comments/:commentId', (req, res, next) =>
    eviction.deleteComment(req, res, next),
  );
  app.delete('/evictions/:id', (req, res, next) => eviction.deleteEviction(req, res, next));
  app.post('/evictions/:id/attend', (req, res, next) => eviction.toggleAttend(req, res, next));
  app.post('/evictions/:id/follow', (req, res, next) =>
    eviction.toggleFollowEviction(req, res, next),
  );
  app.post('/evictions/:id/vouch/:oxyUserId', (req, res, next) =>
    eviction.vouchForSupporter(req, res, next),
  );
  app.post('/evictions/:id/supporters/:oxyUserId/revoke', (req, res, next) =>
    eviction.revokeAttendee(req, res, next),
  );
  app.post('/evictions/:id/updates', (req, res, next) => eviction.createUpdate(req, res, next));
  app.post('/evictions/:id/comments', (req, res, next) => eviction.createComment(req, res, next));
  app.post('/evictions/:id/report', (req, res, next) =>
    eviction.createEvictionReport(req, res, next),
  );
  app.post('/evictions/:id/hold/clear', (req, res, next) => eviction.clearHold(req, res, next));

  app.use(errorHandler);
  return app;
}

export function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function caseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Desahucio en Carrer de Sants',
    description: 'Familia con menores. Necesitamos presencia para pararlo.',
    location: {
      label: 'Carrer de Sants, Barcelona',
      coordinates: [2.132456, 41.375678],
      city: 'Barcelona',
      countryCode: 'ES',
    },
    scheduledAt: inDays(7),
    ...overrides,
  };
}

export async function createCase(
  owner: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(buildApp(owner)).post('/evictions').send(caseBody(overrides));
  expect(res.status).toBe(201);
  return res.body.data.eviction.id;
}

describe('createEviction — mass-assignment / ownership', () => {
  it('ignores forged owner, count, status, timeline, roster and published coordinates', async () => {
    const res = await request(buildApp('oxy-owner'))
      .post('/evictions')
      .send({
        ...caseBody(),
        oxyUserId: 'attacker',
        attendeeCount: 999,
        status: 'stopped',
        updates: [{ message: 'forged timeline' }],
        attendees: [{ oxyUserId: 'ghost' }],
        // The published pair is DERIVED. Accepting it from a body would let a
        // client publish the true point, which is the whole design defeated in
        // one field.
        locationLongitude: 2.132456,
        locationLatitude: 41.375678,
        locationRadiusMeters: 1,
        precautionaryHoldAt: null,
        archivedAt: null,
      });
    expect(res.status).toBe(201);

    const createdId = String(res.body.data.eviction.id);
    const [persisted] = await getDb()
      .select()
      .from(evictionCases)
      .where(eq(evictionCases.id, createdId));
    assertFound(persisted, 'persisted');
    expect(persisted.oxyUserId).toBe('oxy-owner');
    expect(persisted.status).toBe('upcoming');
    expect(persisted.locationRadiusMeters).toBeGreaterThan(1);
    // The published point is not the reported one.
    expect(persisted.locationLongitude).not.toBe(2.132456);
    expect(persisted.locationLatitude).not.toBe(41.375678);

    // The forged roster reached no table at all, and the only timeline entry is
    // the one the controller writes itself.
    const timeline = await getDb()
      .select()
      .from(evictionCaseUpdates)
      .where(eq(evictionCaseUpdates.caseId, createdId));
    expect(timeline).toHaveLength(1);
    expect(timeline[0].eventType).toBe('case_created');
    expect(
      await getDb()
        .select()
        .from(evictionCaseAttendees)
        .where(eq(evictionCaseAttendees.caseId, createdId)),
    ).toHaveLength(0);
  });

  it('requires a title, description, location and scheduledAt', async () => {
    const res = await request(buildApp('oxy-owner')).post('/evictions').send({ title: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('toggleAttend — RSVP', () => {
  it('toggles attendance and keeps the count consistent', async () => {
    const id = await createCase('oxy-owner');

    const first = await request(buildApp('oxy-friend')).post(`/evictions/${id}/attend`);
    expect(first.status).toBe(200);
    expect(first.body.data.attending).toBe(true);
    expect(first.body.data.attendeeCount).toBe(1);

    const second = await request(buildApp('oxy-friend')).post(`/evictions/${id}/attend`);
    expect(second.status).toBe(200);
    expect(second.body.data.attending).toBe(false);
    expect(second.body.data.attendeeCount).toBe(0);
  });
});

describe('following a case', () => {
  it('is separate from attending, and both receive an update exactly once', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-watcher')).post(`/evictions/${id}/follow`);
    await request(buildApp('oxy-attendee')).post(`/evictions/${id}/attend`);

    // The follower is NOT on the roster — the two facts are separate tables.
    expect(
      await getDb()
        .select()
        .from(evictionCaseAttendees)
        .where(eq(evictionCaseAttendees.oxyUserId, 'oxy-watcher')),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(evictionCaseFollowers)
        .where(eq(evictionCaseFollowers.oxyUserId, 'oxy-attendee')),
    ).toHaveLength(0);

    const rescheduled = inDays(14);
    const res = await request(buildApp('oxy-owner'))
      .put(`/evictions/${id}`)
      .send({ scheduledAt: rescheduled });
    expect(res.status).toBe(200);

    const notes = await notificationsOfType('eviction_update');
    const recipients = notes.map((n) => n.recipientOxyUserId).sort();
    // Both, and never the owner who made the change.
    expect(recipients).toEqual(['oxy-attendee', 'oxy-watcher']);
  });
});

describe('updateEviction — ownership', () => {
  it('rejects a non-owner PUT with 404', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-stranger'))
      .put(`/evictions/${id}`)
      .send({ title: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it('rejects a non-owner timeline update with 404', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-stranger'))
      .post(`/evictions/${id}/updates`)
      .send({ message: 'fake' });
    expect(res.status).toBe(404);
  });

  it('appends a timeline entry when the owner reschedules', async () => {
    const id = await createCase('oxy-owner');
    const rescheduled = inDays(14);
    const res = await request(buildApp('oxy-owner'))
      .put(`/evictions/${id}`)
      .send({ scheduledAt: rescheduled });
    expect(res.status).toBe(200);

    const timeline = res.body.data.eviction.timeline;
    expect(timeline).toHaveLength(2);
    expect(timeline[0].eventType).toBe('case_created');
    expect(timeline[1].eventType).toBe('date_changed');
    expect(timeline[1].newScheduledAt).toBe(rescheduled);
  });
});

describe('comments', () => {
  it('notifies the case owner on a new comment (not the commenter)', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-commenter'))
      .post(`/evictions/${id}/comments`)
      .send({ body: 'Me apunto' });
    expect(res.status).toBe(201);

    const notes = await notificationsOfType('eviction_comment');
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientOxyUserId).toBe('oxy-owner');
  });

  it('lets the comment author delete their own comment', async () => {
    const id = await createCase('oxy-owner');
    const created = await request(buildApp('oxy-author'))
      .post(`/evictions/${id}/comments`)
      .send({ body: 'aquí estaré' });
    const commentId = created.body.data.id;

    const del = await request(buildApp('oxy-author')).delete(`/evictions/${id}/comments/${commentId}`);
    expect(del.status).toBe(200);
    expect(await commentsWithId(commentId)).toHaveLength(0);
  });

  it('lets the case owner moderate a comment but blocks strangers with 404', async () => {
    const id = await createCase('oxy-owner');
    const created = await request(buildApp('oxy-commenter'))
      .post(`/evictions/${id}/comments`)
      .send({ body: 'solidaridad' });
    const commentId = created.body.data.id;

    const stranger = await request(buildApp('oxy-stranger')).delete(
      `/evictions/${id}/comments/${commentId}`,
    );
    expect(stranger.status).toBe(404);
    expect(await commentsWithId(commentId)).toHaveLength(1);

    const owner = await request(buildApp('oxy-owner')).delete(`/evictions/${id}/comments/${commentId}`);
    expect(owner.status).toBe(200);
    expect(await commentsWithId(commentId)).toHaveLength(0);
  });

  it('cascade-deletes comments when the case is deleted', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-x')).post(`/evictions/${id}/comments`).send({ body: 'one' });
    await request(buildApp('oxy-y')).post(`/evictions/${id}/comments`).send({ body: 'two' });

    const del = await request(buildApp('oxy-owner')).delete(`/evictions/${id}`);
    expect(del.status).toBe(200);
    expect(
      await getDb().select().from(evictionComments).where(eq(evictionComments.caseId, id)),
    ).toHaveLength(0);
  });
});

describe('reports', () => {
  it('records one report and treats a re-file while open as a no-op', async () => {
    const id = await createCase('oxy-owner');

    const first = await request(buildApp('oxy-reporter'))
      .post(`/evictions/${id}/report`)
      .send({ reason: 'harassment' });
    expect(first.status).toBe(201);

    const second = await request(buildApp('oxy-reporter'))
      .post(`/evictions/${id}/report`)
      .send({ reason: 'harassment' });
    expect(second.status).toBe(200);

    expect(
      await getDb().select().from(evictionReports).where(eq(evictionReports.caseId, id)),
    ).toHaveLength(1);
  });

  it('refuses a reason from the old listing vocabulary', async () => {
    const id = await createCase('oxy-owner');
    // `inappropriate` was a valid reason before #358 and is not one now. The
    // vocabularies are separate BECAUSE two of the new reasons carry a
    // consequence, and silently accepting a listing reason would route a
    // data-exposure report to a counter.
    const res = await request(buildApp('oxy-reporter'))
      .post(`/evictions/${id}/report`)
      .send({ reason: 'inappropriate' });
    expect(res.status).toBe(400);
  });
});

describe('public browse — the board is LOCAL', () => {
  it('refuses a request that names no scope', async () => {
    await createCase('oxy-owner');
    const res = await request(buildApp()).get('/evictions');
    // The load-bearing assertion in this file: a board that answered here would
    // have returned a plausible-looking page of the wrong cases.
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('LOCATION_SCOPE_REQUIRED');
  });

  it('refuses a bounding box that is present and malformed rather than ignoring it', async () => {
    await createCase('oxy-owner');
    const res = await request(buildApp()).get('/evictions?swLat=41.3&swLng=2.1&neLat=41.4');
    expect(res.status).toBe(400);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_LOCATION_SCOPE');
  });

  it('answers an explicit global request, and echoes the scope back', async () => {
    await createCase('oxy-owner', { title: 'anywhere' });
    const res = await request(buildApp()).get('/evictions?global=true&status=upcoming');
    expect(res.status).toBe(200);
    expect(res.body.data.scope).toEqual({ kind: 'global' });
    expect(res.body.data.evictions.map((row: { title: string }) => row.title)).toContain('anywhere');
  });

  it('sorts an upcoming board by soonest first and excludes other statuses', async () => {
    await createCase('oxy-owner', { title: 'later', scheduledAt: inDays(9) });
    await createCase('oxy-owner', { title: 'soon', scheduledAt: inDays(2) });
    const stoppedId = await createCase('oxy-owner', {
      title: 'stopped-one',
      scheduledAt: inDays(4),
    });
    await request(buildApp('oxy-owner')).put(`/evictions/${stoppedId}`).send({ status: 'stopped' });

    const res = await request(buildApp()).get('/evictions?global=true&status=upcoming');
    expect(res.status).toBe(200);
    const titles = res.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toEqual(['soon', 'later']);
    expect(titles).not.toContain('stopped-one');
  });

  it('scopes to a city, and the TOTAL comes from the same predicate as the page', async () => {
    await createCase('oxy-owner', {
      title: 'bcn',
      location: {
        label: 'Carrer de Sants',
        coordinates: [2.132, 41.375],
        city: 'Barcelona',
        countryCode: 'ES',
      },
    });
    await createCase('oxy-owner', {
      title: 'mad',
      location: {
        label: 'Calle de Alcala',
        coordinates: [-3.7, 40.41],
        city: 'Madrid',
        countryCode: 'ES',
      },
    });

    const res = await request(buildApp()).get('/evictions?city=Barcelona&status=upcoming');
    expect(res.status).toBe(200);
    expect(res.body.data.evictions.map((row: { title: string }) => row.title)).toEqual(['bcn']);
    // List, map and count share one query — a filter applied to the page and not
    // the count is the failure this asserts against.
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('drops upcoming cases whose date is more than 24h past from the default feed', async () => {
    await createCase('oxy-owner', { title: 'future', scheduledAt: inDays(3) });
    await createCase('oxy-owner', { title: 'recent-past', scheduledAt: inHours(-6) });
    await createCase('oxy-owner', { title: 'stale-past', scheduledAt: inDays(-2) });

    const res = await request(buildApp()).get('/evictions?global=true&status=upcoming');
    expect(res.status).toBe(200);
    const titles = res.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toContain('future');
    expect(titles).toContain('recent-past');
    expect(titles).not.toContain('stale-past');
  });

  it('keeps a >24h-past case reachable by direct link and in the owner list', async () => {
    const id = await createCase('oxy-owner', { title: 'stale-direct', scheduledAt: inDays(-2) });

    const direct = await request(buildApp()).get(`/evictions/${id}`);
    expect(direct.status).toBe(200);
    expect(direct.body.data.title).toBe('stale-direct');

    const mine = await request(buildApp('oxy-owner')).get('/evictions/me/list');
    const titles = mine.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toContain('stale-direct');
  });

  it('never exposes the roster and reflects the viewer flags on detail', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-viewer')).post(`/evictions/${id}/attend`);

    const viewer = await request(buildApp('oxy-viewer')).get(`/evictions/${id}`);
    expect(viewer.status).toBe(200);
    expect(viewer.body.data.isAttending).toBe(true);
    expect(viewer.body.data.attendeeCount).toBe(1);
    expect(viewer.body.data.attendees).toBeUndefined();

    // Not even the organiser gets the roster (ADR 0003 §7.4).
    const owner = await request(buildApp('oxy-owner')).get(`/evictions/${id}`);
    expect(owner.body.data.attendees).toBeUndefined();
    expect(owner.body.data.attendeeCount).toBe(1);

    const anon = await request(buildApp()).get(`/evictions/${id}`);
    expect(anon.body.data.isAttending).toBeUndefined();
    expect(anon.body.data.attendees).toBeUndefined();
  });
});

describe('detail — contact needs a CONFIRMED supporter, not just an RSVP', () => {
  const contact = { phone: '+34600000000', instructions: 'Nos vemos a las 7h' };

  it('locks contact for an anonymous viewer', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    const res = await request(buildApp()).get(`/evictions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.contactInfo).toBeUndefined();
    expect(res.body.data.contactLocked).toBe(true);
    expect(res.body.data.contactLockReason).toBe('not_attending');
  });

  it('locks contact for a signed-in non-attendee', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    const res = await request(buildApp('oxy-stranger')).get(`/evictions/${id}`);
    expect(res.body.data.contactInfo).toBeUndefined();
    expect(res.body.data.contactLocked).toBe(true);
    expect(res.body.data.contactLockReason).toBe('not_attending');
  });

  it('STILL locks contact for a brand-new account that RSVPs (the F8 fix)', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    // A profile one day old, against the default seven-day bar.
    await giveProfileAgedDays('oxy-fresh', 1);
    await request(buildApp('oxy-fresh')).post(`/evictions/${id}/attend`);

    const res = await request(buildApp('oxy-fresh')).get(`/evictions/${id}`);
    expect(res.body.data.isAttending).toBe(true);
    expect(res.body.data.contactInfo).toBeUndefined();
    expect(res.body.data.contactLocked).toBe(true);
    expect(res.body.data.contactLockReason).toBe('not_confirmed');
  });

  it('unlocks contact for an RSVP from an account with enough tenure', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    await giveProfileAgedDays('oxy-veteran', 30);

    const attend = await request(buildApp('oxy-veteran')).post(`/evictions/${id}/attend`);
    expect(attend.body.data.confirmationBasis).toBe('account_tenure');

    const res = await request(buildApp('oxy-veteran')).get(`/evictions/${id}`);
    expect(res.body.data.contactLocked).toBeUndefined();
    expect(res.body.data.contactInfo.phone).toBe(contact.phone);
    expect(res.body.data.contactInfo.instructions).toBe(contact.instructions);
  });

  it('unlocks contact for a newcomer VOUCHED for by a confirmed supporter', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    await giveProfileAgedDays('oxy-veteran', 30);
    await request(buildApp('oxy-veteran')).post(`/evictions/${id}/attend`);

    await giveProfileAgedDays('oxy-newcomer', 0);
    await request(buildApp('oxy-newcomer')).post(`/evictions/${id}/attend`);

    const locked = await request(buildApp('oxy-newcomer')).get(`/evictions/${id}`);
    expect(locked.body.data.contactLocked).toBe(true);

    const vouch = await request(buildApp('oxy-veteran')).post(`/evictions/${id}/vouch/oxy-newcomer`);
    expect(vouch.status).toBe(200);
    expect(vouch.body.data.confirmed).toBe(true);

    const unlocked = await request(buildApp('oxy-newcomer')).get(`/evictions/${id}`);
    expect(unlocked.body.data.contactLocked).toBeUndefined();
    expect(unlocked.body.data.contactInfo.phone).toBe(contact.phone);
  });

  it('refuses a vouch from somebody who is not themselves confirmed', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    await giveProfileAgedDays('oxy-newcomer-a', 0);
    await giveProfileAgedDays('oxy-newcomer-b', 0);
    await request(buildApp('oxy-newcomer-a')).post(`/evictions/${id}/attend`);

    const vouch = await request(buildApp('oxy-newcomer-a')).post(
      `/evictions/${id}/vouch/oxy-newcomer-b`,
    );
    // Otherwise the second factor issues itself: two new accounts vouching for
    // each other is not a second factor.
    expect(vouch.status).toBe(403);
  });

  it('lets the organiser revoke a confirmed supporter, and the contact re-locks', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    await giveProfileAgedDays('oxy-veteran', 30);
    await request(buildApp('oxy-veteran')).post(`/evictions/${id}/attend`);
    expect((await request(buildApp('oxy-veteran')).get(`/evictions/${id}`)).body.data.contactInfo)
      .toBeDefined();

    const revoke = await request(buildApp('oxy-owner')).post(
      `/evictions/${id}/supporters/oxy-veteran/revoke`,
    );
    expect(revoke.status).toBe(200);
    expect(revoke.body.data.revoked).toBe(true);

    const after = await request(buildApp('oxy-veteran')).get(`/evictions/${id}`);
    expect(after.body.data.contactInfo).toBeUndefined();
    expect(after.body.data.contactLockReason).toBe('revoked');
  });

  it('refuses a revocation from anybody but the organiser', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    await giveProfileAgedDays('oxy-veteran', 30);
    await request(buildApp('oxy-veteran')).post(`/evictions/${id}/attend`);

    const res = await request(buildApp('oxy-stranger')).post(
      `/evictions/${id}/supporters/oxy-veteran/revoke`,
    );
    expect(res.status).toBe(404);
  });

  it('always shows contact to the owner', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    const res = await request(buildApp('oxy-owner')).get(`/evictions/${id}`);
    expect(res.body.data.contactLocked).toBeUndefined();
    expect(res.body.data.contactInfo.phone).toBe(contact.phone);
  });

  it('never sets contactLocked when the case has no contact to reveal', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp()).get(`/evictions/${id}`);
    expect(res.body.data.contactInfo).toBeUndefined();
    expect(res.body.data.contactLocked).toBeUndefined();
  });

  it('never leaks contact into list responses, even for the owner', async () => {
    await createCase('oxy-owner', { contactInfo: contact });
    const mine = await request(buildApp('oxy-owner')).get('/evictions/me/list');
    expect(mine.status).toBe(200);
    expect(mine.body.data.evictions.length).toBeGreaterThan(0);
    for (const row of mine.body.data.evictions) {
      expect(row.contactInfo).toBeUndefined();
      expect(row.contactLocked).toBeUndefined();
    }
  });
});

describe('help needs', () => {
  it('stores a structured need list and filters the board by it', async () => {
    await createCase('oxy-owner', {
      title: 'needs-legal',
      helpNeeds: [{ type: 'legal_support', note: 'Necesitamos abogada' }, { type: 'presence' }],
    });
    await createCase('oxy-owner', { title: 'needs-nothing' });

    const res = await request(buildApp()).get(
      '/evictions?global=true&status=upcoming&helpNeed=legal_support',
    );
    expect(res.status).toBe(200);
    expect(res.body.data.evictions.map((row: { title: string }) => row.title)).toEqual([
      'needs-legal',
    ]);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.evictions[0].helpNeeds).toHaveLength(2);
  });

  it('refuses an unknown help-need filter rather than ignoring it', async () => {
    const res = await request(buildApp()).get('/evictions?global=true&helpNeed=donations');
    // `donations` is deliberately not a member — #358 puts money behind a
    // financial and anti-fraud review it has not had.
    expect(res.status).toBe(400);
  });
});

describe('sendEvictionOutcomeReminders — honest stale-case handling', () => {
  it('reminds the owner of a stale upcoming case exactly once', async () => {
    const id = await createCase('oxy-owner', { title: 'stale', scheduledAt: inDays(-2) });

    const first = await sendEvictionOutcomeReminders();
    expect(first.processed).toBe(1);

    const notes = await notificationsOfType('eviction_outcome_reminder');
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientOxyUserId).toBe('oxy-owner');
    expect(String((notes[0].data as { evictionId?: unknown }).evictionId)).toBe(String(id));

    const [claimed] = await getDb()
      .select({ outcomeReminderSentAt: evictionCases.outcomeReminderSentAt })
      .from(evictionCases)
      .where(eq(evictionCases.id, id));
    assertFound(claimed, 'claimed');
    expect(claimed.outcomeReminderSentAt).not.toBeNull();

    const second = await sendEvictionOutcomeReminders();
    expect(second.processed).toBe(0);
    expect(await notificationsOfType('eviction_outcome_reminder')).toHaveLength(1);
  });

  it('never reminds future or already-resolved cases', async () => {
    await createCase('oxy-owner', { title: 'future', scheduledAt: inDays(3) });
    await createCase('oxy-owner', { title: 'recent', scheduledAt: inHours(-6) });
    const stoppedId = await createCase('oxy-owner', { title: 'stopped', scheduledAt: inDays(-2) });
    await request(buildApp('oxy-owner')).put(`/evictions/${stoppedId}`).send({ status: 'stopped' });

    const result = await sendEvictionOutcomeReminders();
    expect(result.processed).toBe(0);
    expect(await notificationsOfType('eviction_outcome_reminder')).toHaveLength(0);
  });
});
