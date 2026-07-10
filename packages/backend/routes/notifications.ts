/**
 * Notification Routes
 * API routes for notification management
 */

const controllers = require('../controllers');
import express from 'express';
import { asyncHandler } from '../middlewares';
const { notificationController } = controllers;

module.exports = function() {
  const router = express.Router();

  router.get('/', asyncHandler(notificationController.getNotifications));
  router.post('/', asyncHandler(notificationController.createNotification));

  // Static bulk routes MUST be registered before the parameterised `/:id`
  // routes so Express does not treat `read-all` / `clear-all` as an `:id`.
  router.patch('/read-all', asyncHandler(notificationController.markAllAsRead));
  router.delete('/clear-all', asyncHandler(notificationController.clearAllNotifications));

  router.get('/:id', asyncHandler(notificationController.getNotificationById));
  router.put('/:id', asyncHandler(notificationController.updateNotification));
  router.patch('/:id/read', asyncHandler(notificationController.markAsRead));
  router.delete('/:id', asyncHandler(notificationController.deleteNotification));

  return router;
};