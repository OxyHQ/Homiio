/**
 * Notification Routes
 * API routes for notification management
 */

const express = require('express');
const { notificationController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router();

// Protected routes (authentication required)
router.use(auth.verifyToken);

// Notification management
router.get('/', notificationController.getNotifications);
router.get('/:notificationId', 
  validation.validateId('notificationId'),
  notificationController.getNotificationById
);
router.patch('/:notificationId/read', 
  validation.validateId('notificationId'),
  notificationController.markAsRead
);
router.delete('/:notificationId', 
  validation.validateId('notificationId'),
  notificationController.deleteNotification
);

// Bulk operations
router.patch('/read-all', notificationController.markAllAsRead);
router.delete('/clear-all', notificationController.clearAllNotifications);

// Notification preferences
router.get('/preferences/settings', notificationController.getNotificationSettings);
router.put('/preferences/settings', notificationController.updateNotificationSettings);

module.exports = router;