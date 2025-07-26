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

  router.get('/status', asyncHandler(telegramController.getStatus));
  router.post('/webhook', asyncHandler(telegramController.handleWebhook));
  router.get('/properties', asyncHandler(telegramController.getProperties));

  return router;
}; 