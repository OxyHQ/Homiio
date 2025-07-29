/**
 * Telegram Routes
 * Telegram bot management and testing endpoints
 */

const controllers = require('../controllers');
import express from 'express';
import { asyncHandler } from '../middlewares';
const { telegramController } = controllers;

module.exports = function() {
  const router = express.Router();

  // Status and configuration
  router.get('/status', asyncHandler(telegramController.getBotStatus));
  
  // Testing endpoints
  router.post('/test-message', asyncHandler(telegramController.sendTestMessage));
  router.post('/test-location-support', asyncHandler(telegramController.testLocationSupport));
  router.get('/check-location-support', asyncHandler(telegramController.checkLocationSupport));
  
  // Property notifications
  router.post('/notify/:propertyId', asyncHandler(telegramController.sendPropertyNotification));
  router.post('/bulk-notify', asyncHandler(telegramController.sendBulkNotifications));
  
  // Group mapping
  router.get('/group-mapping/:city', asyncHandler(telegramController.getGroupMapping));
  
  // Test recent properties
  router.get('/test-recent-properties', asyncHandler(telegramController.testRecentProperties));
  
  // Webhook (for future use)
  router.post('/webhook', asyncHandler(telegramController.handleWebhook));

  return router;
}; 