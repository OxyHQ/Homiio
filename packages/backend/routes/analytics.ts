import * as controllers from '../controllers';
import express from 'express';
import { asyncHandler } from '../middlewares';
const { analyticsController } = controllers;

export default function() {
  const router = express.Router();

  router.get('/', asyncHandler(analyticsController.getAnalytics));
  router.get('/stats', asyncHandler(analyticsController.getAppStats));

  return router;
};
