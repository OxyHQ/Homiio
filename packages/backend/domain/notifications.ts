/**
 * A person's notification mailbox, as use cases.
 *
 * Every read and write is scoped to the `oxyUserId` given IN THE REPOSITORY
 * QUERY (`recipient_oxy_user_id`), so somebody else's notification is a
 * not-found, never a 403. Nothing here CREATES a notification for anyone:
 * notifications have one write chokepoint, `services/notificationDispatchService.ts`,
 * driven by domain actions (AGENTS.md).
 */

import { getDb } from '../db/postgres';
import {
  createNotification,
  deleteAllNotifications,
  deleteNotification,
  findNotificationForRecipient,
  isNotificationPriority,
  listNotifications,
  markAllRead,
  markRead,
  toNotificationDTO,
  updateNotification,
  type NotificationPriority,
} from '../db/notifications/notificationRepository';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

/** The `priority` filter, or `undefined` when absent or not a declared value. */
function priorityFilter(value: unknown): NotificationPriority | undefined {
  return isNotificationPriority(value) ? value : undefined;
}

function notFound(): AppError {
  return new AppError('Notification not found', 404, 'NOT_FOUND');
}

export interface ListNotificationsInput {
  page?: unknown;
  limit?: unknown;
  unreadOnly?: unknown;
  type?: unknown;
  priority?: unknown;
}

/** The person's notifications, newest first, with the route's flat paging body. */
export async function listMyNotifications(oxyUserId: string, input: ListNotificationsInput = {}) {
  const { page = 1, limit = 20, unreadOnly = false, type, priority } = input;
  const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
  const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));

  const { rows, total, unreadCount } = await listNotifications(
    getDb(),
    {
      recipientOxyUserId: oxyUserId,
      unreadOnly: String(unreadOnly) === 'true',
      type: type === undefined ? undefined : String(type),
      priority: priorityFilter(priority === undefined ? undefined : String(priority)),
    },
    { limit: limitNumber, offset: (pageNumber - 1) * limitNumber },
  );
  const totalPages = Math.ceil(total / limitNumber);
  return {
    notifications: rows.map(toNotificationDTO),
    unreadCount,
    total,
    page: pageNumber,
    limit: limitNumber,
    totalPages,
    hasNext: pageNumber < totalPages,
    hasPrev: pageNumber > 1,
  };
}

/**
 * `POST /api/notifications` — a notification the person writes into THEIR OWN
 * mailbox. Kept for the route only; it is not a catalogue tool (it is a write
 * outside the dispatch chokepoint, see `capabilities/routeCoverage/notifications.ts`).
 */
export async function createOwnNotification(
  oxyUserId: string,
  body: {
    type?: unknown;
    title?: unknown;
    message?: unknown;
    app?: unknown;
    priority?: unknown;
    data?: unknown;
  },
) {
  const { type, title, message, app, priority, data } = body;
  if (!type || !title || !message) {
    throw new AppError('type, title and message are required', 400, 'VALIDATION_ERROR');
  }
  const notification = await createNotification(getDb(), {
    recipientOxyUserId: oxyUserId,
    type: String(type),
    title: String(title),
    message: String(message),
    // `undefined` rather than `null`: the column is `NOT NULL DEFAULT`, so
    // omitting the key is what lets the default apply.
    app: app === undefined ? undefined : String(app),
    priority: priorityFilter(priority),
    data: (data as Record<string, unknown> | undefined) ?? {},
  });
  logger.info('Notification created', { notificationId: notification.id, oxyUserId, type });
  return toNotificationDTO(notification);
}

export async function getNotification(oxyUserId: string, notificationId: string) {
  const notification = await findNotificationForRecipient(getDb(), notificationId, oxyUserId);
  if (!notification) throw notFound();
  return toNotificationDTO(notification);
}

/** `PUT /api/notifications/:id` — read state and presentational fields of one's own notification. */
export async function updateOwnNotification(
  oxyUserId: string,
  notificationId: string,
  body: { read?: unknown; title?: unknown; message?: unknown; priority?: unknown; data?: unknown },
) {
  const { read, title, message, priority, data } = body;
  const notification = await updateNotification(getDb(), notificationId, oxyUserId, {
    read: read === undefined ? undefined : Boolean(read),
    title: title === undefined ? undefined : String(title),
    message: message === undefined ? undefined : String(message),
    priority: priorityFilter(priority),
    data: data as Parameters<typeof updateNotification>[3]['data'],
  });
  if (!notification) throw notFound();
  logger.info('Notification updated', { notificationId, oxyUserId });
  return toNotificationDTO(notification);
}

export async function markNotificationRead(oxyUserId: string, notificationId: string) {
  const notification = await markRead(getDb(), notificationId, oxyUserId);
  if (!notification) throw notFound();
  logger.info('Notification marked as read', { notificationId, oxyUserId });
  return toNotificationDTO(notification);
}

export async function removeNotification(oxyUserId: string, notificationId: string): Promise<void> {
  const deleted = await deleteNotification(getDb(), notificationId, oxyUserId);
  if (!deleted) throw notFound();
  logger.info('Notification deleted', { notificationId, oxyUserId });
}

export async function markAllNotificationsRead(oxyUserId: string) {
  const modifiedCount = await markAllRead(getDb(), oxyUserId);
  logger.info('All notifications marked as read', { oxyUserId, modifiedCount });
  return { modifiedCount };
}

export async function clearAllNotifications(oxyUserId: string) {
  const deletedCount = await deleteAllNotifications(getDb(), oxyUserId);
  logger.info('All notifications cleared', { oxyUserId, deletedCount });
  return { deletedCount };
}
