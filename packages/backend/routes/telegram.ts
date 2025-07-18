/**
 * Telegram Routes
 * Telegram bot management and testing endpoints
 */

import controllers from '../controllers';
import express from 'express';
import { asyncHandler } from '../middlewares/errorHandler';
const { telegramController } = controllers;

export default function() {
  const router = express.Router();

  /**
   * GET /api/telegram/status
   * Get bot status and configuration
   */
  router.get('/status', asyncHandler(telegramController.getBotStatus.bind(telegramController)));

  /**
   * POST /api/telegram/test
   * Send test message to a group
   * Body: { groupId: string, message?: string }
   */
  router.post('/test', asyncHandler(telegramController.sendTestMessage.bind(telegramController)));

  /**
   * POST /api/telegram/notify/:propertyId
   * Send property notification manually
   */
  router.post('/notify/:propertyId', asyncHandler(telegramController.sendPropertyNotification.bind(telegramController)));

  /**
   * POST /api/telegram/bulk-notify
   * Send bulk notifications
   * Body: { propertyIds?: string[], filters?: object }
   */
  router.post('/bulk-notify', asyncHandler(telegramController.sendBulkNotifications.bind(telegramController)));

  /**
   * GET /api/telegram/groups/:city
   * Get group mapping for a city
   */
  router.get('/groups/:city', asyncHandler(telegramController.getGroupMapping.bind(telegramController)));

  /**
   * GET /api/telegram/test-recent
   * Test notifications with recent properties
   * Query: ?limit=5&hours=24
   */
  router.get('/test-recent', asyncHandler(telegramController.testRecentProperties.bind(telegramController)));

  /**
   * GET /api/telegram/webhook
   * Get webhook information (for debugging)
   */
  router.get('/webhook', asyncHandler(telegramController.getWebhookInfo.bind(telegramController)));

  return router;
}; 