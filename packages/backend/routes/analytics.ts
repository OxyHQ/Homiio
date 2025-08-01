const controllers = require('../controllers');
import express from 'express';
import { asyncHandler } from '../middlewares';
const { analyticsController } = controllers;

module.exports = function() {
  const router = express.Router();

  router.get('/', asyncHandler(analyticsController.getAnalytics));

  return router;
};
