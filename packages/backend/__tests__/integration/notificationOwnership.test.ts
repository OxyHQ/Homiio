/**
 * Notification ownership (IDOR) enforcement.
 *
 * Uses the real NotificationController instance and Notification model on the
 * in-memory Mongo, mounted behind a fake-auth middleware. Every read/write is
 * scoped to `recipientOxyUserId`, so user A must never be able to read, mark,
 * or delete user B's notifications, and the bulk routes (`read-all`,
 * `clear-all`) must only affect the caller's own mailbox.
 */

import express, { type Express } from 'express';
import request from 'supertest';

const notificationController = require('../../controllers/notificationController');
const { Notification } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

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

async function createNotificationFor(recipientOxyUserId: string, overrides: Record<string, unknown> = {}) {
  return Notification.create({
    recipientOxyUserId,
    type: 'system',
    title: 'Hello',
    message: 'A message',
    read: false,
    ...overrides,
  });
}

describe('notificationController — mark as read (IDOR)', () => {
  it('lets the owner mark their own notification as read', async () => {
    const n = await createNotificationFor('oxy-a');
    const res = await request(buildApp('oxy-a')).patch(`/notifications/${n._id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.read).toBe(true);

    const persisted = await Notification.findById(n._id);
    expect(persisted.read).toBe(true);
    expect(persisted.readAt).toBeTruthy();
  });

  it("does not let user A mark user B's notification as read (404, stays unread)", async () => {
    const n = await createNotificationFor('oxy-b');
    const res = await request(buildApp('oxy-a')).patch(`/notifications/${n._id}/read`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const persisted = await Notification.findById(n._id);
    expect(persisted.read).toBe(false);
  });
});

describe('notificationController — get / delete (IDOR)', () => {
  it("does not let user A read user B's notification (404)", async () => {
    const n = await createNotificationFor('oxy-b');
    const res = await request(buildApp('oxy-a')).get(`/notifications/${n._id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it("does not let user A delete user B's notification (404, still exists)", async () => {
    const n = await createNotificationFor('oxy-b');
    const res = await request(buildApp('oxy-a')).delete(`/notifications/${n._id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const persisted = await Notification.findById(n._id);
    expect(persisted).not.toBeNull();
  });

  it('lets the owner delete their own notification', async () => {
    const n = await createNotificationFor('oxy-a');
    const res = await request(buildApp('oxy-a')).delete(`/notifications/${n._id}`);
    expect(res.status).toBe(200);

    const persisted = await Notification.findById(n._id);
    expect(persisted).toBeNull();
  });
});

describe('notificationController — bulk routes are per-user', () => {
  it('read-all only marks the caller\'s own notifications as read', async () => {
    const a1 = await createNotificationFor('oxy-a');
    const a2 = await createNotificationFor('oxy-a');
    const b1 = await createNotificationFor('oxy-b');

    const res = await request(buildApp('oxy-a')).patch('/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.modifiedCount).toBe(2);

    expect((await Notification.findById(a1._id)).read).toBe(true);
    expect((await Notification.findById(a2._id)).read).toBe(true);
    // B's notification is untouched.
    expect((await Notification.findById(b1._id)).read).toBe(false);
  });

  it("clear-all only deletes the caller's own notifications", async () => {
    await createNotificationFor('oxy-a');
    await createNotificationFor('oxy-a');
    const b1 = await createNotificationFor('oxy-b');

    const res = await request(buildApp('oxy-a')).delete('/notifications/clear-all');
    expect(res.status).toBe(200);
    expect(res.body.data.deletedCount).toBe(2);

    expect(await Notification.countDocuments({ recipientOxyUserId: 'oxy-a' })).toBe(0);
    // B's mailbox is untouched.
    expect(await Notification.findById(b1._id)).not.toBeNull();
  });
});
