/**
 * Telegram Routes
 * Telegram bot management and testing endpoints
 */

const express = require('express');
const { telegramController } = require('../controllers');

module.exports = function() {
  const router = express.Router();

  /**
   * GET /api/telegram/status
   * Get bot status and configuration
   */
  router.get('/status', telegramController.getBotStatus);

  /**
   * POST /api/telegram/test
   * Send test message to a group
   * Body: { groupId: string, message?: string }
   */
  router.post('/test', telegramController.sendTestMessage);

  /**
   * POST /api/telegram/notify/:propertyId
   * Send property notification manually
   */
  router.post('/notify/:propertyId', telegramController.sendPropertyNotification);

  /**
   * POST /api/telegram/bulk-notify
   * Send bulk notifications
   * Body: { propertyIds?: string[], filters?: object }
   */
  router.post('/bulk-notify', telegramController.sendBulkNotifications);

  /**
   * GET /api/telegram/groups/:city
   * Get group mapping for a city
   */
  router.get('/groups/:city', telegramController.getGroupMapping);

  /**
   * GET /api/telegram/test-recent
   * Test notifications with recent properties
   * Query: ?limit=5&hours=24
   */
  router.get('/test-recent', telegramController.testRecentProperties);

  /**
   * GET /api/telegram/webhook
   * Get webhook information (for debugging)
   */
  router.get('/webhook', telegramController.getWebhookInfo);

  return router;
}; 