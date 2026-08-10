/**
 * The eviction timeline: ordering, immutability, state transitions and
 * once-only notification.
 *
 * ## Two traps this file exists to catch, and both need TWO of something
 *
 * **`position` is `bigint`, which postgres.js decodes as a STRING.** `max + 1`
 * on a string is concatenation that type-checks clean, so the second appended
 * entry lands at position `11` instead of `2`. A test that appends ONCE gives
 * the same answer under both readings — `coalesce(max, 0) + 1` on an empty table
 * is `1` either way — so every ordering assertion here appends at least twice.
 *
 * **A transition guard needs the INVALID case as well as the valid one.** A
 * suite that only drives legal transitions passes identically against a guard
 * that permits everything, which is what makes "cancelled must not reappear as
 * upcoming" a test rather than a comment.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq, sql } from 'drizzle-orm';

import * as eviction from '../../controllers/eviction';
import { getDb } from '../../db/postgres';
import { evictionCaseUpdates, evictionCases, notifications, profiles } from '../../db/schema';
import { EVICTION_STATUS_TRANSITIONS } from '@homiio/shared-types';
import { notifyTimelineEvent } from '../../controllers/eviction/shared';
import { errorHandler } from '../../middlewares/errorHandler';
import { assertFound } from '../helpers/assertFound';

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

  app.get('/evictions', (req, res, next) => eviction.listEvictions(req, res, next));
  app.get('/evictions/:id', (req, res, next) => eviction.getEvictionById(req, res, next));
  app.post('/evictions', (req, res, next) => eviction.createEviction(req, res, next));
  app.put('/evictions/:id', (req, res, next) => eviction.updateEviction(req, res, next));
  app.post('/evictions/:id/updates', (req, res, next) => eviction.createUpdate(req, res, next));
  app.post('/evictions/:id/attend', (req, res, next) => eviction.toggleAttend(req, res, next));
  app.post('/evictions/:id/follow', (req, res, next) =>
    eviction.toggleFollowEviction(req, res, next),
  );

  app.use(errorHandler);
  return app;
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function createCase(owner: string, overrides: Record<string, unknown> = {}) {
  const res = await request(buildApp(owner))
    .post('/evictions')
    .send({
      title: 'Desahucio en Carrer de Sants',
      description: 'Necesitamos presencia.',
      location: {
        label: 'Carrer de Sants, Barcelona',
        coordinates: [2.1734, 41.3851],
        city: 'Barcelona',
        countryCode: 'ES',
      },
      scheduledAt: inDays(7),
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data.eviction.id as string;
}

describe('timeline position', () => {
  it('numbers entries 1, 2, 3 — the bigint-as-string trap needs more than one append', async () => {
    const id = await createCase('oxy-owner');
    // Entry 1 is `case_created`, written by the create handler.
    await request(buildApp('oxy-owner')).post(`/evictions/${id}/updates`).send({ message: 'second' });
    await request(buildApp('oxy-owner')).post(`/evictions/${id}/updates`).send({ message: 'third' });

    const rows = await getDb()
      .select()
      .from(evictionCaseUpdates)
      .where(eq(evictionCaseUpdates.caseId, id))
      .orderBy(evictionCaseUpdates.position);

    // 1, 2, 3 — not 1, 11, 111, which is what `String(max) + 1` produces.
    expect(rows.map((row) => Number(row.position))).toEqual([1, 2, 3]);
    for (const row of rows) {
      expect(Number.isInteger(Number(row.position))).toBe(true);
    }

    // And the DTO reports them as numbers, not strings, so a client sorting on
    // `position` sorts numerically.
    const detail = await request(buildApp()).get(`/evictions/${id}`);
    const positions = detail.body.data.timeline.map((entry: { position: unknown }) => entry.position);
    expect(positions).toEqual([1, 2, 3]);
    for (const position of positions) expect(typeof position).toBe('number');
  });

  it('refuses a duplicate position at the database level', async () => {
    const id = await createCase('oxy-owner');
    await expect(
      getDb().execute(
        sql`insert into eviction_case_updates (case_id, position, message)
            values (${id}, 1, 'duplicate')`,
      ),
    ).rejects.toThrow();
  });
});

describe('timeline immutability', () => {
  it('refuses an UPDATE on a timeline entry, in the database', async () => {
    const id = await createCase('oxy-owner');
    const [entry] = await getDb()
      .select()
      .from(evictionCaseUpdates)
      .where(eq(evictionCaseUpdates.caseId, id));
    assertFound(entry, 'entry');

    // The trigger, not a controller. No route edits an entry today, and "no
    // route" is a property of this week's controllers — this is a property of
    // the table.
    //
    // Asserted on `cause`, NOT on the thrown error's own message: drizzle wraps
    // the driver failure, so the outer message is only "Failed query: …" and a
    // regex against it would pass for ANY rejection — including a typo in the
    // SQL, which is the reading that makes this test prove nothing.
    const thrown = await getDb()
      .execute(sql`update eviction_case_updates set message = 'rewritten' where id = ${entry.id}`)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(thrown).toBeDefined();
    const cause = (thrown as { cause?: { message?: string; code?: string } }).cause;
    expect(cause?.message).toContain('append-only');
    // `restrict_violation`, the SQLSTATE the trigger raises with.
    expect(cause?.code).toBe('23001');

    const [after] = await getDb()
      .select()
      .from(evictionCaseUpdates)
      .where(eq(evictionCaseUpdates.id, entry.id));
    assertFound(after, 'after');
    expect(after.message).toBe(entry.message);
  });

  it('still lets the case cascade delete its timeline', async () => {
    const id = await createCase('oxy-owner');
    await getDb().delete(evictionCases).where(eq(evictionCases.id, id));
    expect(
      await getDb().select().from(evictionCaseUpdates).where(eq(evictionCaseUpdates.caseId, id)),
    ).toHaveLength(0);
  });
});

describe('status transitions', () => {
  it('accepts every transition the shared table declares legal', async () => {
    // Driven from `EVICTION_STATUS_TRANSITIONS` rather than a list written here,
    // so the frontend's disabled controls and this guard cannot disagree.
    const legal = EVICTION_STATUS_TRANSITIONS.upcoming;
    expect(legal.length).toBeGreaterThan(0);

    for (const target of legal) {
      const id = await createCase('oxy-owner');
      const res = await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: target });
      expect(res.status).toBe(200);
      expect(res.body.data.eviction.status).toBe(target);
    }
  });

  it('refuses a transition out of a TERMINAL status with 409, and does not mutate the row', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: 'cancelled' });

    const res = await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: 'upcoming' });
    expect(res.status).toBe(409);
    expect(res.body.error?.code ?? res.body.code).toBe('INVALID_STATUS_TRANSITION');

    // A 409 with a mutated row is the failure that matters.
    const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(row, 'row');
    expect(row.status).toBe('cancelled');
  });

  it('refuses the same transition through the timeline endpoint too', async () => {
    // Two write paths reach `status`, and a guard on one of them is a guard on
    // neither.
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: 'executed' });

    const res = await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/updates`)
      .send({ message: 'actually it was stopped', newStatus: 'stopped' });
    expect(res.status).toBe(409);

    const [row] = await getDb().select().from(evictionCases).where(eq(evictionCases.id, id));
    assertFound(row, 'row');
    expect(row.status).toBe('executed');
  });

  it('keeps a cancelled case off the upcoming board', async () => {
    const id = await createCase('oxy-owner', { title: 'cancelled-one' });
    await createCase('oxy-owner', { title: 'live-one' });
    await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: 'cancelled' });

    const upcoming = await request(buildApp()).get('/evictions?global=true&status=upcoming');
    const titles = upcoming.body.data.evictions.map((row: { title: string }) => row.title);
    expect(titles).toContain('live-one');
    expect(titles).not.toContain('cancelled-one');

    // And it IS still findable under its own status, so "off the board" is not
    // "deleted".
    const cancelled = await request(buildApp()).get('/evictions?global=true&status=cancelled');
    expect(
      cancelled.body.data.evictions.map((row: { title: string }) => row.title),
    ).toContain('cancelled-one');
  });

  it('records the status change as its OWN event type, not as a note', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-owner'))
      .post(`/evictions/${id}/updates`)
      .send({ message: 'lo hemos parado', eventType: 'note', newStatus: 'stopped' });

    const detail = await request(buildApp()).get(`/evictions/${id}`);
    const last = detail.body.data.timeline[detail.body.data.timeline.length - 1];
    // A lifecycle change filed under `note` would be a status change hidden in
    // the audit that exists to surface it.
    expect(last.eventType).toBe('stopped');
    expect(last.newStatus).toBe('stopped');
  });
});

describe('notification idempotency', () => {
  it('notifies a date change exactly once per recipient, even across retries', async () => {
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-watcher')).post(`/evictions/${id}/follow`);

    await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ scheduledAt: inDays(10) });

    const first = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.type, 'eviction_update'));
    expect(first).toHaveLength(1);
    expect(first[0].recipientOxyUserId).toBe('oxy-watcher');

    // Re-running the fan-out for the SAME timeline entry claims nothing, because
    // the claim is a unique index rather than a flag the caller remembers.
    const [entry] = await getDb()
      .select()
      .from(evictionCaseUpdates)
      .where(eq(evictionCaseUpdates.caseId, id))
      .orderBy(sql`${evictionCaseUpdates.position} desc`)
      .limit(1);
    assertFound(entry, 'entry');

    const claimed = await notifyTimelineEvent({
      caseId: id,
      updateId: entry.id,
      excludeOxyUserId: 'oxy-owner',
      payload: {
        type: 'eviction_update',
        title: 'Eviction case updated',
        message: entry.message,
        data: { evictionId: id },
      },
    });
    expect(claimed).toEqual([]);
    expect(
      await getDb().select().from(notifications).where(eq(notifications.type, 'eviction_update')),
    ).toHaveLength(1);
  });

  it('notifies a SECOND, different change again', async () => {
    // The vacuity floor for the test above: an idempotency mechanism that
    // suppressed everything would pass it, and fails here.
    const id = await createCase('oxy-owner');
    await request(buildApp('oxy-watcher')).post(`/evictions/${id}/follow`);

    await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ scheduledAt: inDays(10) });
    await request(buildApp('oxy-owner')).put(`/evictions/${id}`).send({ status: 'postponed' });

    expect(
      await getDb().select().from(notifications).where(eq(notifications.type, 'eviction_update')),
    ).toHaveLength(2);
  });
});
