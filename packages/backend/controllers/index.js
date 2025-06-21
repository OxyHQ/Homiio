/**
 * Controllers Index
 * Central export for all controller components
 */

const propertyController = require('./propertyController');
const roomController = require('./roomController');
const analyticsController = require('./analyticsController');
const userController = require('./userController');
const deviceController = require('./deviceController');
const notificationController = require('./notificationController');
const leaseController = require('./leaseController');
const profileController = require('./profileController');

module.exports = {
  propertyController,
  roomController,
  analyticsController,
  userController,
  deviceController,
  notificationController,
  leaseController,
  profileController
};
