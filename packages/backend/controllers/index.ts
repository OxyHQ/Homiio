/**
 * Controllers Index
 * Central export for all controller components
 */

const propertyController = require('./propertyController');
const roomController = require('./roomController');
const analyticsController = require('./analyticsController');
const deviceController = require('./deviceController');
const notificationController = require('./notificationController');
const leaseController = require('./leaseController');
const profileController = require('./profileController');
const telegramController = require('./telegramController');
const cityController = require('./cityController');
const tipsController = require('./tipsController');
const imageController = require('./imageController');
const billingController = require('./billingController');

module.exports = {
  propertyController,
  roomController,
  analyticsController,
  deviceController,
  notificationController,
  leaseController,
  profileController,
  telegramController,
  cityController,
  tipsController,
  imageController,
  billingController,
};
