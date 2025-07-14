const express = require('express');
const { asyncHandler } = require('../middlewares');
const { analyticsController } = require('../controllers');

module.exports = function() {
  const router = express.Router();

  router.get('/', asyncHandler(analyticsController.getAnalytics));

  return router;
};
