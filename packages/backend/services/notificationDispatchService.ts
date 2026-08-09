/**
 * Notification Dispatch Service
 *
 * The single chokepoint for *producing* in-app notifications from domain
 * events (lease signed, viewing approved, roommate request received, …).
 * Controllers never insert into `notifications` directly for event-driven
 * notifications — they call `createForUser` here so that recipient
 * resolution, defaults and failure handling live in one place.
 *
 * ## A failed dispatch is swallowed, and that is the contract
 *
 * Every caller is a domain action that has already succeeded — a lease was
 * signed, an RSVP was recorded. Rethrowing here would roll back or 500 a write
 * the user completed because a mailbox row could not be inserted, which is a
 * worse outcome than a missing notification. The failure is logged rather than
 * hidden, and `null` is the answer.
 *
 * That is also why this function does NOT take a caller's transaction. It is
 * called AFTER the domain write commits, deliberately: joining the caller's
 * transaction would make a mailbox failure abort the domain write, which is the
 * exact coupling the swallow exists to prevent.
 */

import { getDb } from '../db/postgres';
import {
  createNotification,
  isNotificationPriority,
  type NotificationRow,
} from '../db/notifications/notificationRepository';
import { logger } from '../middlewares/logging';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface DispatchPayload {
  type: string;
  title: string;
  message: string;
  priority?: NotificationPriority;
  data?: Record<string, unknown>;
  app?: string;
}

class NotificationDispatchService {
  async createForUser(
    recipientOxyUserId: string | undefined | null,
    payload: DispatchPayload,
  ): Promise<NotificationRow | null> {
    if (!recipientOxyUserId) {
      return null;
    }
    try {
      const notification = await createNotification(getDb(), {
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
        title: payload.title,
        message: payload.message,
        // Narrowed rather than passed through: an undeclared priority is
        // refused by `notifications_priority_check` as a `23514`, which would
        // turn a best-effort mailbox write into a logged error for a caller
        // that merely mistyped a constant.
        priority: isNotificationPriority(payload.priority) ? payload.priority : undefined,
        data: payload.data ?? {},
        app: payload.app,
      });

      logger.info('Notification dispatched', {
        notificationId: notification.id,
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
      });

      return notification;
    } catch (error) {
      logger.error('Notification dispatch failed', {
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export const notificationDispatchService = new NotificationDispatchService();

export default notificationDispatchService;
