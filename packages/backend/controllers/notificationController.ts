/**
 * Notification Controller
 * Handles notification management operations.
 *
 * Notifications are persisted in MongoDB (see models/schemas/NotificationSchema)
 * and scoped to the authenticated Oxy user. The mailbox screen
 * (packages/frontend/app/mailbox.tsx, via context/NotificationContext +
 * services/notificationService) lists, reads, updates and deletes them through
 * these handlers.
 */

const { Notification } = require('../models');
const { AppError, successResponse } = require('../middlewares/errorHandler');
const { logger } = require('../middlewares/logging');

const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];

class NotificationController {
  /**
   * Get the authenticated user's notifications.
   *
   * Supports pagination (`page`, `limit`) and filtering by `unreadOnly`, `type`
   * and `priority`. Returns a flat body shaped for the frontend
   * notificationService, which reads `notifications` and `total` directly off
   * the response body.
   */
  async getNotifications(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
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
      const skip = (pageNumber - 1) * limitNumber;

      const query: Record<string, unknown> = { recipientOxyUserId: oxyUserId };
      if (String(unreadOnly) === 'true') {
        query.read = false;
      }
      if (type) {
        query.type = String(type);
      }
      if (priority && VALID_PRIORITIES.includes(String(priority))) {
        query.priority = String(priority);
      }

      const [notifications, total, unreadCount] = await Promise.all([
        Notification.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limitNumber)
          .lean({ virtuals: true }),
        Notification.countDocuments(query),
        Notification.countDocuments({ recipientOxyUserId: oxyUserId, read: false }),
      ]);

      const totalPages = Math.ceil(total / limitNumber);

      res.json({
        success: true,
        message: 'Notifications retrieved successfully',
        notifications,
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
  async createNotification(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const { type, title, message, app, priority, data } = req.body;

      if (!type || !title || !message) {
        return next(
          new AppError('type, title and message are required', 400, 'VALIDATION_ERROR')
        );
      }

      const notification = await Notification.create({
        recipientOxyUserId: oxyUserId,
        type: String(type),
        title: String(title),
        message: String(message),
        app: app ? String(app) : undefined,
        priority: priority && VALID_PRIORITIES.includes(String(priority))
          ? String(priority)
          : undefined,
        data: data ?? {},
      });

      logger.info('Notification created', { notificationId: notification._id, oxyUserId, type });

      res.status(201).json(
        successResponse(notification.toJSON(), 'Notification created successfully')
      );
    } catch (error) {
      if (error.name === 'ValidationError') {
        return next(new AppError('Validation failed', 400, 'VALIDATION_ERROR'));
      }
      next(error);
    }
  }

  /**
   * Get a single notification owned by the authenticated user.
   */
  async getNotificationById(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;

      const notification = await Notification.findOne({
        _id: notificationId,
        recipientOxyUserId: oxyUserId,
      });

      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      res.json(successResponse(notification.toJSON(), 'Notification retrieved successfully'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid notification ID', 400, 'VALIDATION_ERROR'));
      }
      next(error);
    }
  }

  /**
   * Update a notification owned by the authenticated user. Used primarily to
   * toggle read state, but also allows editing presentational fields.
   */
  async updateNotification(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;
      const { read, title, message, priority, data } = req.body;

      const update: Record<string, unknown> = {};
      if (read !== undefined) {
        update.read = Boolean(read);
        update.readAt = read ? new Date() : null;
      }
      if (title !== undefined) update.title = String(title);
      if (message !== undefined) update.message = String(message);
      if (priority !== undefined && VALID_PRIORITIES.includes(String(priority))) {
        update.priority = String(priority);
      }
      if (data !== undefined) update.data = data;

      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipientOxyUserId: oxyUserId },
        { $set: update },
        { new: true, runValidators: true }
      );

      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      logger.info('Notification updated', { notificationId, oxyUserId });

      res.json(successResponse(notification.toJSON(), 'Notification updated successfully'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid notification ID', 400, 'VALIDATION_ERROR'));
      }
      if (error.name === 'ValidationError') {
        return next(new AppError('Validation failed', 400, 'VALIDATION_ERROR'));
      }
      next(error);
    }
  }

  /**
   * Mark a notification as read.
   */
  async markAsRead(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;

      const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, recipientOxyUserId: oxyUserId },
        { $set: { read: true, readAt: new Date() } },
        { new: true }
      );

      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      logger.info('Notification marked as read', { notificationId, oxyUserId });

      res.json(successResponse(notification.toJSON(), 'Notification marked as read'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid notification ID', 400, 'VALIDATION_ERROR'));
      }
      next(error);
    }
  }

  /**
   * Delete a notification owned by the authenticated user.
   */
  async deleteNotification(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const notificationId = req.params.id || req.params.notificationId;

      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        recipientOxyUserId: oxyUserId,
      });

      if (!notification) {
        return next(new AppError('Notification not found', 404, 'NOT_FOUND'));
      }

      logger.info('Notification deleted', { notificationId, oxyUserId });

      res.json(successResponse(null, 'Notification deleted successfully'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid notification ID', 400, 'VALIDATION_ERROR'));
      }
      next(error);
    }
  }

  /**
   * Mark all of the authenticated user's notifications as read.
   */
  async markAllAsRead(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const result = await Notification.updateMany(
        { recipientOxyUserId: oxyUserId, read: false },
        { $set: { read: true, readAt: new Date() } }
      );

      logger.info('All notifications marked as read', {
        oxyUserId,
        modifiedCount: result.modifiedCount,
      });

      res.json(
        successResponse(
          { modifiedCount: result.modifiedCount ?? 0 },
          'All notifications marked as read'
        )
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Permanently delete all of the authenticated user's notifications.
   */
  async clearAllNotifications(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const result = await Notification.deleteMany({ recipientOxyUserId: oxyUserId });

      logger.info('All notifications cleared', {
        oxyUserId,
        deletedCount: result.deletedCount,
      });

      res.json(
        successResponse(
          { deletedCount: result.deletedCount ?? 0 },
          'All notifications cleared successfully'
        )
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();
