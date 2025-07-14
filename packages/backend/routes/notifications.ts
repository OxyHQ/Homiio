/**
 * Notification Routes
 * API routes for notification management
 */

import controllers from '../controllers';
import express from 'express';
const { notificationController } = controllers;
const { validation, asyncHandler } = require('../middlewares');

module.exports = function() {
  const router = express.Router();

  // Notification management
  router.get('/', asyncHandler(notificationController.getNotifications));
  router.get('/:notificationId', 
    validation.validateId('notificationId'),
    asyncHandler(notificationController.getNotificationById)
  );
  router.patch('/:notificationId/read', 
    validation.validateId('notificationId'),
    asyncHandler(notificationController.markAsRead)
  );
  router.delete('/:notificationId', 
    validation.validateId('notificationId'),
    asyncHandler(notificationController.deleteNotification)
  );

  // Bulk operations
  router.patch('/read-all', asyncHandler(notificationController.markAllAsRead));
  router.delete('/clear-all', asyncHandler(notificationController.clearAllNotifications));

  // Notification preferences
  router.get('/preferences/settings', asyncHandler(notificationController.getNotificationSettings));
  router.put('/preferences/settings', asyncHandler(notificationController.updateNotificationSettings));

  return router;
};