/**
 * Notification Dispatch Service
 *
 * The single chokepoint for *producing* in-app notifications from domain
 * events (lease signed, viewing approved, roommate request received, …).
 * Controllers never call `Notification.create` directly for event-driven
 * notifications — they call `createForUser` here so that recipient
 * resolution, defaults and failure handling live in one place.
 */

import { Notification } from '../models';
import type { INotification } from '../models';
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
  ): Promise<INotification | null> {
    if (!recipientOxyUserId) {
      return null;
    }
    try {
      const notification = await Notification.create({
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
        title: payload.title,
        message: payload.message,
        priority: payload.priority,
        data: payload.data ?? {},
        app: payload.app,
      });

      logger.info('Notification dispatched', {
        notificationId: notification._id?.toString(),
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
