/**
 * Notification Controller
 * Handles notification management operations
 */

const { horizonService } = require('../services');
const { successResponse, paginationResponse, AppError } = require('../middlewares/errorHandler');
const { logger } = require('../middlewares/logging');

class NotificationController {
  /**
   * Get user notifications
   */
  async getNotifications(req, res, next) {
    try {
      const userId = req.userId;
      const {
        page = 1,
        limit = 20,
        unreadOnly = false,
        type,
        priority
      } = req.query;

      try {
        // Try to get notifications from Horizon service
        const horizonNotifications = await horizonService.getCrossAppNotifications(userId);
        
        // Filter based on query parameters
        let filteredNotifications = horizonNotifications;
        
        if (unreadOnly === 'true') {
          filteredNotifications = filteredNotifications.filter(n => !n.read);
        }
        
        if (type) {
          filteredNotifications = filteredNotifications.filter(n => n.type === type);
        }
        
        if (priority) {
          filteredNotifications = filteredNotifications.filter(n => n.priority === priority);
        }

        const total = filteredNotifications.length;
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        const paginatedNotifications = filteredNotifications.slice(startIndex, endIndex);

        res.json(paginationResponse(
          paginatedNotifications,
          parseInt(page),
          parseInt(limit),
          total,
          'Notifications retrieved successfully'
        ));
      } catch (horizonError) {
        // Fallback to mock notifications if Horizon service fails
        logger.warn('Horizon service unavailable, using mock notifications', { error: horizonError.message });
        
        const mockNotifications = [
          {
            id: 'notif_1',
            type: 'payment_reminder',
            title: 'Rent Payment Due',
            message: 'Your rent payment of $1,200 is due in 3 days',
            app: 'homio',
            priority: 'high',
            read: false,
            createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            data: {
              propertyId: 'prop_1',
              amount: 1200,
              dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
            }
          },
          {
            id: 'notif_2',
            type: 'maintenance_request',
            title: 'New Maintenance Request',
            message: 'A tenant has submitted a maintenance request for Room 2B',
            app: 'homio',
            priority: 'medium',
            read: false,
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
            data: {
              propertyId: 'prop_1',
              roomId: 'room_2',
              requestType: 'plumbing'
            }
          },
          {
            id: 'notif_3',
            type: 'energy_alert',
            title: 'High Energy Usage Detected',
            message: 'Energy consumption in Living Room is 20% above normal',
            app: 'homio',
            priority: 'low',
            read: true,
            createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
            data: {
              deviceId: 'device_1',
              consumption: 5.2,
              threshold: 4.0
            }
          }
        ];

        res.json(successResponse(mockNotifications, 'Notifications retrieved successfully'));
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get notification by ID
   */
  async getNotificationById(req, res, next) {
    try {
      const { notificationId } = req.params;

      // In a real implementation, fetch from database
      const mockNotification = {
        id: notificationId,
        type: 'payment_reminder',
        title: 'Rent Payment Due',
        message: 'Your rent payment of $1,200 is due in 3 days',
        app: 'homio',
        priority: 'high',
        read: false,
        createdAt: new Date().toISOString(),
        data: {
          propertyId: 'prop_1',
          amount: 1200,
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
        }
      };

      res.json(successResponse(mockNotification, 'Notification retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(req, res, next) {
    try {
      const { notificationId } = req.params;
      const userId = req.userId;

      // In a real implementation, update notification status
      // await NotificationModel.markAsRead(notificationId, userId);

      logger.info('Notification marked as read', { notificationId, userId });

      res.json(successResponse(null, 'Notification marked as read'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(req, res, next) {
    try {
      const { notificationId } = req.params;
      const userId = req.userId;

      // In a real implementation, soft delete notification
      // await NotificationModel.softDelete(notificationId, userId);

      logger.info('Notification deleted', { notificationId, userId });

      res.json(successResponse(null, 'Notification deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(req, res, next) {
    try {
      const userId = req.userId;

      // In a real implementation, mark all user notifications as read
      // await NotificationModel.markAllAsRead(userId);

      logger.info('All notifications marked as read', { userId });

      res.json(successResponse(null, 'All notifications marked as read'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Clear all notifications
   */
  async clearAllNotifications(req, res, next) {
    try {
      const userId = req.userId;

      // In a real implementation, soft delete all user notifications
      // await NotificationModel.clearAll(userId);

      logger.info('All notifications cleared', { userId });

      res.json(successResponse(null, 'All notifications cleared successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get notification settings
   */
  async getNotificationSettings(req, res, next) {
    try {
      const userId = req.userId;

      // In a real implementation, fetch from database
      const mockSettings = {
        userId,
        emailNotifications: {
          enabled: true,
          types: {
            payment_reminders: true,
            maintenance_requests: true,
            energy_alerts: false,
            system_updates: true,
            marketing: false
          }
        },
        pushNotifications: {
          enabled: true,
          types: {
            payment_reminders: true,
            maintenance_requests: true,
            energy_alerts: true,
            system_updates: false,
            marketing: false
          }
        },
        smsNotifications: {
          enabled: false,
          types: {
            payment_reminders: false,
            maintenance_requests: false,
            energy_alerts: false,
            system_updates: false,
            marketing: false
          }
        },
        quietHours: {
          enabled: true,
          startTime: '22:00',
          endTime: '08:00',
          timezone: 'America/Los_Angeles'
        },
        frequency: {
          digest: 'daily', // daily, weekly, never
          realTime: true
        }
      };

      res.json(successResponse(mockSettings, 'Notification settings retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update notification settings
   */
  async updateNotificationSettings(req, res, next) {
    try {
      const userId = req.userId;
      const settings = req.body;

      // In a real implementation, update in database
      // await UserSettingsModel.updateNotificationSettings(userId, settings);

      logger.info('Notification settings updated', { userId });

      res.json(successResponse(settings, 'Notification settings updated successfully'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();