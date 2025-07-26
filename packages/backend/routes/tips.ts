/**
 * Tips Routes
 * API endpoints for tips and articles
 */

import express from 'express';
const { asyncHandler } = require('../middlewares');
const tipsController = require('../controllers/tipsController');

export default function() {
  const router = express.Router();

  // Get all tips
  router.get('/', asyncHandler(tipsController.getAllTips));

  // Get featured tips
  router.get('/featured', asyncHandler(tipsController.getFeaturedTips));

  // Get tips by category
  router.get('/category/:category', asyncHandler(tipsController.getTipsByCategory));

  // Search tips
  router.get('/search', asyncHandler(tipsController.searchTips));

  // Get tip by ID or slug
  router.get('/:id', asyncHandler(tipsController.getTipById));

  return router;
} 