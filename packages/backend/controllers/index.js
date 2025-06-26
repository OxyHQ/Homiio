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

module.exports = {
  propertyController,
  roomController,
  analyticsController,
  deviceController,
  notificationController,
  leaseController,
  profileController,
  telegramController,
};
