/**
 * Notification ownership (IDOR) enforcement.
 *
 * Uses the real NotificationController instance against the REAL Postgres this
 * worker owns, mounted behind a fake-auth middleware. Every read/write is
 * scoped to `recipient_oxy_user_id`, so user A must never be able to read, mark,
 * or delete user B's notifications, and the bulk routes (`read-all`,
 * `clear-all`) must only affect the caller's own mailbox.
 *
 * ## Why the persistence assertions read the TABLE and not the response
 *
 * A handler that answered 404 while still performing the write would pass every
 * assertion made on its response body — the 404 is the thing being tested, so
 * trusting it to also prove the row is untouched is a check that cannot tell
 * success from failure. Each IDOR case therefore re-reads the row afterwards and
 * asserts it did NOT move.
 *
 * `resetNotifications` runs in `beforeEach` because the Postgres side of the
 * harness has no per-test cleanup: `__tests__/jest.setup.ts` clears the Mongo
 * collections after every test and deliberately leaves Postgres alone, so a file
 * that writes rows owns emptying them.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import notificationController from '../../controllers/notificationController';
import { getDb } from '../../db/postgres';
import { notifications } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { objectIdHex } from '../helpers/postgresGeoFixtures';

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
  app.get('/notifications/:id', (req, res, next) => notificationController.getNotificationById(req, res, next));
  app.patch('/notifications/read-all', (req, res, next) => notificationController.markAllAsRead(req, res, next));
  app.delete('/notifications/clear-all', (req, res, next) => notificationController.clearAllNotifications(req, res, next));
  app.patch('/notifications/:id/read', (req, res, next) => notificationController.markAsRead(req, res, next));
  app.delete('/notifications/:id', (req, res, next) => notificationController.deleteNotification(req, res, next));
  app.use(errorHandler);
  return app;
}

type NotificationRow = typeof notifications.$inferSelect;

async function createNotificationFor(
  recipientOxyUserId: string,
  overrides: Partial<typeof notifications.$inferInsert> = {},
): Promise<NotificationRow> {
  const [row] = await getDb()
    .insert(notifications)
    .values({
      recipientOxyUserId,
      type: 'system',
      title: 'Hello',
      message: 'A message',
      read: false,
      ...overrides,
    })
    .returning();
  return row;
}

async function findById(id: string): Promise<NotificationRow | undefined> {
  const [row] = await getDb().select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return row;
}

beforeEach(async () => {
  await getDb().delete(notifications);
});

describe('notificationController — mark as read (IDOR)', () => {
  it('lets the owner mark their own notification as read', async () => {
    const n = await createNotificationFor('oxy-a');
    const res = await request(buildApp('oxy-a')).patch(`/notifications/${n.id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);

    const persisted = await findById(n.id);
    expect(persisted?.read).toBe(true);
    expect(persisted?.readAt).toBeTruthy();
  });

  it("does not let user A mark user B's notification as read (404, stays unread)", async () => {
    const n = await createNotificationFor('oxy-b');
    const res = await request(buildApp('oxy-a')).patch(`/notifications/${n.id}/read`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const persisted = await findById(n.id);
    expect(persisted?.read).toBe(false);
    // The pair moves together, so a stray `read_at` on an unread row would be a
    // half-applied write the `read` assertion alone cannot see.
    expect(persisted?.readAt).toBeNull();
  });
});

describe('notificationController — get / delete (IDOR)', () => {
  it("does not let user A read user B's notification (404)", async () => {
    const n = await createNotificationFor('oxy-b');
    const res = await request(buildApp('oxy-a')).get(`/notifications/${n.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("does not let user A delete user B's notification (404, still exists)", async () => {
    const n = await createNotificationFor('oxy-b');
    const res = await request(buildApp('oxy-a')).delete(`/notifications/${n.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    expect(await findById(n.id)).toBeDefined();
  });

  it('lets the owner delete their own notification', async () => {
    const n = await createNotificationFor('oxy-a');
    const res = await request(buildApp('oxy-a')).delete(`/notifications/${n.id}`);
    expect(res.status).toBe(200);

    expect(await findById(n.id)).toBeUndefined();
  });
});

describe('notificationController — bulk routes are per-user', () => {
  it("read-all only marks the caller's own notifications as read", async () => {
    const a1 = await createNotificationFor('oxy-a');
    const a2 = await createNotificationFor('oxy-a');
    const b1 = await createNotificationFor('oxy-b');

    const res = await request(buildApp('oxy-a')).patch('/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.modifiedCount).toBe(2);

    expect((await findById(a1.id))?.read).toBe(true);
    expect((await findById(a2.id))?.read).toBe(true);
    // B's notification is untouched.
    expect((await findById(b1.id))?.read).toBe(false);
  });

  it('read-all counts only the rows that MOVED, and leaves an already-read row alone', async () => {
    // The Mongo handler counted `modifiedCount`, which excludes rows the update
    // matched but did not change. The Postgres predicate has to carry the same
    // exclusion explicitly — without `read = false` every already-read row would
    // be rewritten with a fresh `read_at`, restamping when the user read
    // something days ago, and the count would silently include it.
    const alreadyRead = await createNotificationFor('oxy-a', {
      read: true,
      readAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const unread = await createNotificationFor('oxy-a');

    const res = await request(buildApp('oxy-a')).patch('/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.modifiedCount).toBe(1);

    expect((await findById(unread.id))?.read).toBe(true);
    expect((await findById(alreadyRead.id))?.readAt).toEqual(
      new Date('2020-01-01T00:00:00.000Z'),
    );
  });

  it("clear-all only deletes the caller's own notifications", async () => {
    await createNotificationFor('oxy-a');
    await createNotificationFor('oxy-a');
    const b1 = await createNotificationFor('oxy-b');

    const res = await request(buildApp('oxy-a')).delete('/notifications/clear-all');
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(2);

    const remaining = await getDb()
      .select({ id: notifications.id })
      .from(notifications)
      .where(eq(notifications.recipientOxyUserId, 'oxy-a'));
    expect(remaining).toHaveLength(0);
    // B's mailbox is untouched.
    expect(await findById(b1.id)).toBeDefined();
  });
});

describe('notificationController — ids that are not ObjectId-shaped', () => {
  /**
   * The `CastError` branches are deleted rather than widened (`db/ids.ts`).
   * Post-cutover every id minted by the application is a uuid v7, so a handler
   * that still recognised only a 24-hex id would answer 400 for a perfectly
   * valid one. Both shapes have to reach the query and both have to 404 when the
   * row is not the caller's.
   */
  it('answers 404 for a uuid-shaped id that does not exist', async () => {
    const res = await request(buildApp('oxy-a')).get(
      '/notifications/0198f0a1-0000-7000-8000-000000000000',
    );
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for an ObjectId-shaped id that does not exist', async () => {
    const res = await request(buildApp('oxy-a')).get(`/notifications/${objectIdHex()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a plainly malformed id rather than 400 or 500', async () => {
    const res = await request(buildApp('oxy-a')).get('/notifications/not-an-id');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
