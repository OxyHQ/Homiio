const express = require('express');
const { auth } = require('../middlewares');
const { analyticsController } = require('../controllers');

const router = express.Router();

router.get('/', (req, res, next) =>
  analyticsController.getAnalytics(req, res, next)
);

module.exports = router;
