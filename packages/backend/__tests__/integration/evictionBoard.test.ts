/**
 * Eviction solidarity board — ownership, privacy, RSVP, timeline, comments,
 * reports, and public browse behaviour.
 *
 * Uses the real eviction controllers + models on the in-memory Mongo, mounted
 * behind a fake-auth middleware (mirrors leaseOwnership / notificationOwnership
 * tests). `buildApp()` with no id models an anonymous public viewer.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import { sendEvictionOutcomeReminders } from '../../services/evictionOutcomeReminderService';

const eviction = require('../../controllers/eviction');
const { EvictionCase, EvictionComment, EvictionReport, Notification } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

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
  app.get('/evictions/me/list', (req, res, next) => eviction.listMyEvictions(req, res, next));
  app.get('/evictions/me/attending', (req, res, next) => eviction.listAttendingEvictions(req, res, next));
  app.get('/evictions/:id/comments', (req, res, next) => eviction.listComments(req, res, next));
  app.get('/evictions/:id', (req, res, next) => eviction.getEvictionById(req, res, next));

  // Writes.
  app.post('/evictions', (req, res, next) => eviction.createEviction(req, res, next));
  app.put('/evictions/:id', (req, res, next) => eviction.updateEviction(req, res, next));
  app.delete('/evictions/:id/comments/:commentId', (req, res, next) => eviction.deleteComment(req, res, next));
  app.delete('/evictions/:id', (req, res, next) => eviction.deleteEviction(req, res, next));
  app.post('/evictions/:id/attend', (req, res, next) => eviction.toggleAttend(req, res, next));
  app.post('/evictions/:id/updates', (req, res, next) => eviction.createUpdate(req, res, next));
  app.post('/evictions/:id/comments', (req, res, next) => eviction.createComment(req, res, next));
  app.post('/evictions/:id/report', (req, res, next) => eviction.createEvictionReport(req, res, next));

  app.use(errorHandler);
  return app;
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function caseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Desahucio en Carrer de Sants',
    description: 'Familia con menores — necesitamos presencia para pararlo.',
    location: {
      label: 'Carrer de Sants, Barcelona',
      coordinates: { type: 'Point', coordinates: [2.132456, 41.375678] },
      precision: 'approximate',
      city: 'Barcelona',
      countryCode: 'ES',
    },
    scheduledAt: inDays(7),
    ...overrides,
  };
}

async function createCase(owner: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request(buildApp(owner)).post('/evictions').send(caseBody(overrides));
  expect(res.status).toBe(201);
  return res.body.data.id;
}

describe('createEviction — mass-assignment / ownership', () => {
  it('ignores forged owner, count, status, updates and attendees fields', async () => {
    const res = await request(buildApp('oxy-owner'))
      .post('/evictions')
      .send({
        ...caseBody(),
        oxyUserId: 'attacker',
        attendeeCount: 999,
        status: 'stopped',
        updates: [{ message: 'forged timeline' }],
        attendees: [{ oxyUserId: 'ghost' }],
      });
    expect(res.status).toBe(201);

    const persisted = await EvictionCase.findById(res.body.data.id).select('+attendees');
    expect(persisted.oxyUserId).toBe('oxy-owner');
    expect(persisted.attendeeCount).toBe(0);
    expect(persisted.status).toBe('upcoming');
    expect(persisted.updates).toHaveLength(0);
    expect(persisted.attendees).toHaveLength(0);
  });

  it('requires a title, description, location and scheduledAt', async () => {
    const res = await request(buildApp('oxy-owner')).post('/evictions').send({ title: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('createEviction — location privacy', () => {
  it('rounds approximate coordinates to 3 decimals', async () => {
    const res = await request(buildApp('oxy-owner'))
      .post('/evictions')
      .send(
        caseBody({
          location: {
            label: 'Somewhere',
            coordinates: { type: 'Point', coordinates: [2.1324567, 41.3756789] },
            precision: 'approximate',
          },
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.location.coordinates.coordinates).toEqual([2.132, 41.376]);
  });

  it('keeps exact coordinates verbatim', async () => {
    const res = await request(buildApp('oxy-owner'))
      .post('/evictions')
      .send(
        caseBody({
          location: {
            label: 'Exact spot',
            coordinates: { type: 'Point', coordinates: [2.1324567, 41.3756789] },
            precision: 'exact',
          },
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.data.location.coordinates.coordinates).toEqual([2.1324567, 41.3756789]);
  });
});

describe('toggleAttend — RSVP', () => {
  it('toggles attendance and keeps the count consistent', async () => {
    const id = await createCase('oxy-owner');

    const first = await request(buildApp('oxy-friend')).post(`/evictions/${id}/attend`);
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({ attending: true, attendeeCount: 1 });

    const second = await request(buildApp('oxy-friend')).post(`/evictions/${id}/attend`);
    expect(second.status).toBe(200);
    expect(second.body.data).toEqual({ attending: false, attendeeCount: 0 });
  });
});

describe('updateEviction — ownership', () => {
  it('rejects a non-owner PUT with 404', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-stranger')).put(`/evictions/${id}`).send({ title: 'hijacked' });
    expect(res.status).toBe(404);
  });

  it('rejects a non-owner timeline update with 404', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-stranger')).post(`/evictions/${id}/updates`).send({ message: 'fake' });
    expect(res.status).toBe(404);
  });

  it('appends a timeline entry and notifies attendees when the owner reschedules', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-a')).post(`/evictions/${id}/attend`);
    await request(buildApp('oxy-b')).post(`/evictions/${id}/attend`);

    const rescheduled = inDays(14);
    const res = await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ scheduledAt: rescheduled });
    expect(res.status).toBe(200);
    expect(res.body.data.updates).toHaveLength(1);
    expect(res.body.data.updates[0].newScheduledAt).toBe(rescheduled);

    const notes = await Notification.find({ type: 'eviction_update' });
    const recipients = notes.map((n: { recipientOxyUserId: string }) => n.recipientOxyUserId).sort();
    // Fan-out reaches every attendee EXCEPT the owner.
    expect(recipients).toEqual(['oxy-a', 'oxy-b']);
  });

  it('appends a timeline entry and updates status', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: 'stopped' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('stopped');
    expect(res.body.data.updates).toHaveLength(1);
    expect(res.body.data.updates[0].newStatus).toBe('stopped');
  });
});

describe('comments', () => {
  it('notifies the case owner on a new comment (not the commenter)', async () => {
    const id = await createCase('oxy-owner');
    const res = await request(buildApp('oxy-commenter')).post(`/evictions/${id}/comments`).send({ body: 'Me apunto' });
    expect(res.status).toBe(201);

    const notes = await Notification.find({ type: 'eviction_comment' });
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientOxyUserId).toBe('oxy-owner');
  });

  it('lets the comment author delete their own comment', async () => {
    const id = await createCase('oxy-owner');
    const created = await request(buildApp('oxy-author')).post(`/evictions/${id}/comments`).send({ body: 'aquí estaré' });
    const commentId = created.body.data.id;

    const del = await request(buildApp('oxy-author')).delete(`/evictions/${id}/comments/${commentId}`);
    expect(del.status).toBe(200);
    expect(await EvictionComment.findById(commentId)).toBeNull();
  });

  it('lets the case owner moderate a comment but blocks strangers with 404', async () => {
    const id = await createCase('oxy-owner');
    const created = await request(buildApp('oxy-commenter')).post(`/evictions/${id}/comments`).send({ body: 'solidaridad' });
    const commentId = created.body.data.id;

    const stranger = await request(buildApp('oxy-stranger')).delete(`/evictions/${id}/comments/${commentId}`);
    expect(stranger.status).toBe(404);
    expect(await EvictionComment.findById(commentId)).not.toBeNull();

    const owner = await request(buildApp('oxy-owner')).delete(`/evictions/${id}/comments/${commentId}`);
    expect(owner.status).toBe(200);
    expect(await EvictionComment.findById(commentId)).toBeNull();
  });

  it('cascade-deletes comments when the case is deleted', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-x')).post(`/evictions/${id}/comments`).send({ body: 'one' });
    await request(buildApp('oxy-y')).post(`/evictions/${id}/comments`).send({ body: 'two' });

    const del = await request(buildApp('oxy-owner')).delete(`/evictions/${id}`);
    expect(del.status).toBe(200);
    expect(await EvictionComment.countDocuments({ caseId: id })).toBe(0);
  });
});

describe('reports — dedup', () => {
  it('records one report and treats a re-file while open as a no-op', async () => {
    const id = await createCase('oxy-owner');

    const first = await request(buildApp('oxy-reporter')).post(`/evictions/${id}/report`).send({ reason: 'inappropriate' });
    expect(first.status).toBe(201);

    const second = await request(buildApp('oxy-reporter')).post(`/evictions/${id}/report`).send({ reason: 'inappropriate' });
    expect(second.status).toBe(200);

    expect(await EvictionReport.countDocuments({ caseId: id })).toBe(1);
  });
});

describe('public browse', () => {
  it('defaults to upcoming and sorts by soonest first', async () => {
    await createCase('oxy-owner', { title: 'later', scheduledAt: inDays(9) });
    await createCase('oxy-owner', { title: 'soon', scheduledAt: inDays(2) });
    const stoppedId = await createCase('oxy-owner', { title: 'stopped-one', scheduledAt: inDays(4) });
    await request(buildApp('oxy-owner')).put(`/evictions/${stoppedId}`).send({ status: 'stopped' });

    const res = await request(buildApp()).get('/evictions');
    expect(res.status).toBe(200);
    const titles = res.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toEqual(['soon', 'later']);
    expect(titles).not.toContain('stopped-one');
  });

  it('never exposes attendees and reflects the viewer isAttending on detail', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-viewer')).post(`/evictions/${id}/attend`);

    const viewer = await request(buildApp('oxy-viewer')).get(`/evictions/${id}`);
    expect(viewer.status).toBe(200);
    expect(viewer.body.data.isAttending).toBe(true);
    expect(viewer.body.data.attendeeCount).toBe(1);
    expect(viewer.body.data.attendees).toBeUndefined();

    const anon = await request(buildApp()).get(`/evictions/${id}`);
    expect(anon.body.data.isAttending).toBeUndefined();
    expect(anon.body.data.attendees).toBeUndefined();
  });

  it('drops upcoming cases whose date is more than 24h past from the default feed', async () => {
    await createCase('oxy-owner', { title: 'future', scheduledAt: inDays(3) });
    await createCase('oxy-owner', { title: 'recent-past', scheduledAt: inHours(-6) });
    await createCase('oxy-owner', { title: 'stale-past', scheduledAt: inDays(-2) });

    const res = await request(buildApp()).get('/evictions');
    expect(res.status).toBe(200);
    const titles = res.body.data.evictions.map((row: { title: string }) => row.title);
    // >24h-past drops off; <24h-past + future stay (soonest-first).
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
});

describe('detail — RSVP-gated contact ("asiste para ver cómo ayudar")', () => {
  const contact = { phone: '+34600000000', instructions: 'Nos vemos a las 7h' };

  it('locks contact for an anonymous viewer', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    const res = await request(buildApp()).get(`/evictions/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.contactInfo).toBeUndefined();
    expect(res.body.data.contactLocked).toBe(true);
  });

  it('locks contact for a signed-in non-attendee', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    const res = await request(buildApp('oxy-stranger')).get(`/evictions/${id}`);
    expect(res.body.data.contactInfo).toBeUndefined();
    expect(res.body.data.contactLocked).toBe(true);
  });

  it('unlocks contact once the viewer RSVPs', async () => {
    const id = await createCase('oxy-owner', { contactInfo: contact });
    await request(buildApp('oxy-attendee')).post(`/evictions/${id}/attend`);

    const res = await request(buildApp('oxy-attendee')).get(`/evictions/${id}`);
    expect(res.body.data.isAttending).toBe(true);
    expect(res.body.data.contactLocked).toBeUndefined();
    expect(res.body.data.contactInfo.phone).toBe(contact.phone);
    expect(res.body.data.contactInfo.instructions).toBe(contact.instructions);
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
    for (const row of mine.body.data.evictions) {
      expect(row.contactInfo).toBeUndefined();
      expect(row.contactLocked).toBeUndefined();
    }
  });
});

describe('sendEvictionOutcomeReminders — honest stale-case handling', () => {
  it('reminds the owner of a stale upcoming case exactly once', async () => {
    const id = await createCase('oxy-owner', { title: 'stale', scheduledAt: inDays(-2) });

    const first = await sendEvictionOutcomeReminders();
    expect(first.processed).toBe(1);

    const notes = await Notification.find({ type: 'eviction_outcome_reminder' });
    expect(notes).toHaveLength(1);
    expect(notes[0].recipientOxyUserId).toBe('oxy-owner');
    expect(String(notes[0].data.evictionId)).toBe(String(id));

    const claimed = await EvictionCase.findById(id).select('outcomeReminderSentAt');
    expect(claimed.outcomeReminderSentAt).toBeTruthy();

    // A second run is a no-op — no duplicate reminder.
    const second = await sendEvictionOutcomeReminders();
    expect(second.processed).toBe(0);
    expect(await Notification.countDocuments({ type: 'eviction_outcome_reminder' })).toBe(1);
  });

  it('never reminds future or already-resolved cases', async () => {
    await createCase('oxy-owner', { title: 'future', scheduledAt: inDays(3) });
    await createCase('oxy-owner', { title: 'recent', scheduledAt: inHours(-6) });
    const stoppedId = await createCase('oxy-owner', { title: 'stopped', scheduledAt: inDays(-2) });
    await request(buildApp('oxy-owner')).put(`/evictions/${stoppedId}`).send({ status: 'stopped' });

    const result = await sendEvictionOutcomeReminders();
    expect(result.processed).toBe(0);
    expect(await Notification.countDocuments({ type: 'eviction_outcome_reminder' })).toBe(0);
  });
});
