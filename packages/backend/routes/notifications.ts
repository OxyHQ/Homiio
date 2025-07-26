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
  router.get('/:id', asyncHandler(notificationController.getNotificationById));
  router.put('/:id', asyncHandler(notificationController.updateNotification));
  router.delete('/:id', asyncHandler(notificationController.deleteNotification));

  return router;
};