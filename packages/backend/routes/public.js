/**
 * Public Routes (No Authentication Required)
 * These routes can be accessed without authentication
 */

const express = require('express');
const propertyController = require('../controllers/propertyController');
const telegramController = require('../controllers/telegramController');
const { asyncHandler } = require('../middlewares');
const performanceMonitor = require('../middlewares/performance');

module.exports = function () {
  const router = express.Router();

  // Performance monitoring for all routes
  router.use(performanceMonitor);

  // Public property routes
  router.get('/properties', asyncHandler(propertyController.getProperties));
  router.get('/properties/search', asyncHandler(propertyController.searchProperties));
  router.get('/properties/:propertyId', asyncHandler(propertyController.getPropertyById));
  router.get('/properties/:propertyId/stats', asyncHandler(propertyController.getPropertyStats));

  // Public Telegram routes (for testing and bot management)
  router.get('/telegram/status', asyncHandler(telegramController.getBotStatus));
  router.get('/telegram/groups/:city', asyncHandler(telegramController.getGroupMapping));
  router.get('/telegram/webhook', asyncHandler(telegramController.getWebhookInfo));
  router.post('/telegram/test', asyncHandler(telegramController.sendTestMessage));

  return router;
}; 