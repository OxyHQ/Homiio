/**
 * Notification Controller
 * Handles notification management operations.
 *
 * Notifications are persisted in PostgreSQL (`db/schema/notifications.ts`, read
 * and written through `db/notifications/notificationRepository.ts`) and scoped
 * to the authenticated Oxy user. The mailbox screen
 * (packages/frontend/app/mailbox.tsx, via context/NotificationContext +
 * services/notificationService) lists, reads, updates and deletes them through
 * these handlers.
 *
 * ## What the Mongo port changed, and what it deliberately did not
 *
 * The `CastError` branches are GONE, not widened. A `text` primary key takes any
 * string, so a malformed id is simply a lookup that matches nothing and the
 * handler answers the same 404 it always answered for an id that did not exist.
 * `db/ids.ts` is explicit that these guards are deleted rather than ported, and
 * that using `isLiveEntityId` as a query precondition would re-introduce the
 * fail-open bug in a new costume.
 *
 * The `ValidationError` branch is gone for the same class of reason: the two
 * things Mongoose validated here are `type`/`title`/`message` presence, which
 * this handler checks itself and answers 400 for, and `priority`, which the
 * handler narrows against the declared tuple before the insert can see it. What
 * remains — a `NOT NULL` or a CHECK — is a programming error rather than a
 * caller's, and it belongs in the error handler as a 500 rather than being
 * relabelled a 400 the client cannot act on.
 */

import type { Request, Response, NextFunction } from 'express';

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
import { AppError, successResponse } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

/**
 * Resolve the mailbox owner from the session, in the shape the auth layer sets.
 *
 * `req.userId` is declared `string | null`, so the `||` chain widens to include
 * `null` — coalesced away here rather than at each of the eight call sites,
 * every one of which only ever asks "is there an owner?".
 */
function recipientOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || req.userId || undefined;
}

/** The `?priority` filter, or `undefined` when absent or not a declared value. */
function priorityFilter(value: unknown): NotificationPriority | undefined {
  return isNotificationPriority(value) ? value : undefined;
}

class NotificationController {
  /**
   * Get the authenticated user's notifications.
   *
   * Supports pagination (`page`, `limit`) and filtering by `unreadOnly`, `type`
   * and `priority`. Returns a flat body shaped for the frontend
   * notificationService, which reads `notifications` and `total` directly off
   * the response body.
   */
  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const {
        page = 1,
        limit = 20,
        unreadOnly = false,
        type,
        priority,
      } = req.query;

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

      res.json({
        success: true,
        message: 'Notifications retrieved successfully',
        notifications: rows.map(toNotificationDTO),
        unreadCount,
        total,
        page: pageNumber,
        limit: limitNumber,
        totalPages,
        hasNext: pageNumber < totalPages,
        hasPrev: pageNumber > 1,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a notification for the authenticated user.
   */
  async createNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const { type, title, message, app, priority, data } = req.body;

      if (!type || !title || !message) {
        return next(
          new AppError('type, title and message are required', 400, 'VALIDATION_ERROR')
        );
      }

      const notification = await createNotification(getDb(), {
        recipientOxyUserId: oxyUserId,
        type: String(type),
        title: String(title),
        message: String(message),
        // `undefined` rather than `null`: the column is `NOT NULL DEFAULT`, so
        // omitting the key is what lets the default apply. See the repository
        // header — this is the one place drizzle and mongoose disagree.
        app: app === undefined ? undefined : String(app),
        priority: priorityFilter(priority),
        data: data ?? {},
      });

      logger.info('Notification created', { notificationId: notification.id, oxyUserId, type });

      res.status(201).json(
        successResponse(toNotificationDTO(notification), 'Notification created successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a single notification owned by the authenticated user.
   */
  async getNotificationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;

      const notification = await findNotificationForRecipient(getDb(), notificationId, oxyUserId);
      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      res.json(
        successResponse(toNotificationDTO(notification), 'Notification retrieved successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a notification owned by the authenticated user. Used primarily to
   * toggle read state, but also allows editing presentational fields.
   */
  async updateNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;
      const { read, title, message, priority, data } = req.body;

      const notification = await updateNotification(getDb(), notificationId, oxyUserId, {
        read: read === undefined ? undefined : Boolean(read),
        title: title === undefined ? undefined : String(title),
        message: message === undefined ? undefined : String(message),
        priority: priorityFilter(priority),
        data,
      });

      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      logger.info('Notification updated', { notificationId, oxyUserId });

      res.json(
        successResponse(toNotificationDTO(notification), 'Notification updated successfully')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark a notification as read.
   */
  async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;

      const notification = await markRead(getDb(), notificationId, oxyUserId);
      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      logger.info('Notification marked as read', { notificationId, oxyUserId });

      res.json(successResponse(toNotificationDTO(notification), 'Notification marked as read'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a notification owned by the authenticated user.
   */
  async deleteNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;

      const deleted = await deleteNotification(getDb(), notificationId, oxyUserId);
      if (!deleted) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      logger.info('Notification deleted', { notificationId, oxyUserId });

      res.json(successResponse(null, 'Notification deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark all of the authenticated user's notifications as read.
   */
  async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const modifiedCount = await markAllRead(getDb(), oxyUserId);

      logger.info('All notifications marked as read', { oxyUserId, modifiedCount });

      res.json(
        successResponse({ modifiedCount }, 'All notifications marked as read')
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Permanently delete all of the authenticated user's notifications.
   */
  async clearAllNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const deletedCount = await deleteAllNotifications(getDb(), oxyUserId);

      logger.info('All notifications cleared', { oxyUserId, deletedCount });

      res.json(
        successResponse({ deletedCount }, 'All notifications cleared successfully')
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new NotificationController();
