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
 * ## Ids and validation
 *
 * There is no id-shape branch. A `text` primary key takes any
 * string, so a malformed id is simply a lookup that matches nothing and the
 * handler answers the same 404 it always answered for an id that did not exist.
 * `db/ids.ts` is explicit that these guards are deleted rather than ported, and
 * that using `isLiveEntityId` as a query precondition would re-introduce the
 * fail-open bug in a new costume.
 *
 * There is no generic validation-error branch either: the two things worth
 * validating here are `type`/`title`/`message` presence, which this handler
 * checks itself and answers 400 for, and `priority`, which the
 * handler narrows against the declared tuple before the insert can see it. What
 * remains — a `NOT NULL` or a CHECK — is a programming error rather than a
 * caller's, and it belongs in the error handler as a 500 rather than being
 * relabelled a 400 the client cannot act on.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  clearAllNotifications,
  createOwnNotification,
  getNotification,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  removeNotification,
  updateOwnNotification,
} from '../domain/notifications';
import { AppError, successResponse } from '../middlewares/errorHandler';

/**
 * Resolve the mailbox owner from the session, in the shape the auth layer sets.
 *
 * `req.userId` is declared `string | null`, so the `||` chain widens to include
 * `null` — coalesced away here rather than at each call site, every one of
 * which only ever asks "is there an owner?".
 */
function recipientOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || req.userId || undefined;
}

function unauthenticated(): AppError {
  return new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
}

function notificationIdOf(req: Request): string {
  return req.params.id || req.params.notificationId;
}

/**
 * The HTTP edge of the mailbox. Every use case lives in
 * `domain/notifications.ts`, which the capability catalogue calls too.
 */
class NotificationController {
  /**
   * The authenticated user's notifications, with pagination (`page`, `limit`)
   * and `unreadOnly` / `type` / `priority` filters. A flat body shaped for the
   * frontend notificationService, which reads `notifications` and `total`
   * directly off the response body.
   */
  async getNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      const page = await listMyNotifications(oxyUserId, req.query);
      res.json({ success: true, message: 'Notifications retrieved successfully', ...page });
    } catch (error) {
      next(error);
    }
  }

  /** Create a notification in the authenticated user's own mailbox. */
  async createNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      const notification = await createOwnNotification(oxyUserId, req.body ?? {});
      res.status(201).json(successResponse(notification, 'Notification created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** A single notification owned by the authenticated user. */
  async getNotificationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      const notification = await getNotification(oxyUserId, notificationIdOf(req));
      res.json(successResponse(notification, 'Notification retrieved successfully'));
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
      if (!oxyUserId) return next(unauthenticated());
      const notification = await updateOwnNotification(
        oxyUserId,
        notificationIdOf(req),
        req.body ?? {},
      );
      res.json(successResponse(notification, 'Notification updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Mark a notification as read. */
  async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      const notification = await markNotificationRead(oxyUserId, notificationIdOf(req));
      res.json(successResponse(notification, 'Notification marked as read'));
    } catch (error) {
      next(error);
    }
  }

  /** Delete a notification owned by the authenticated user. */
  async deleteNotification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      await removeNotification(oxyUserId, notificationIdOf(req));
      res.json(successResponse(null, 'Notification deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Mark all of the authenticated user's notifications as read. */
  async markAllAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      res.json(
        successResponse(
          await markAllNotificationsRead(oxyUserId),
          'All notifications marked as read',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Permanently delete all of the authenticated user's notifications. */
  async clearAllNotifications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = recipientOf(req);
      if (!oxyUserId) return next(unauthenticated());
      res.json(
        successResponse(
          await clearAllNotifications(oxyUserId),
          'All notifications cleared successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new NotificationController();
