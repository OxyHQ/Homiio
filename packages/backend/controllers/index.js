/**
 * Controllers Index
 * Central export for all controller components
 */

const propertyController = require('./propertyController');
const roomController = require('./roomController');
const analyticsController = require('./analyticsController');
const authController = require('./authController');
const userController = require('./userController');
const deviceController = require('./deviceController');
const notificationController = require('./notificationController');
const leaseController = require('./leaseController');

module.exports = {
  propertyController,
  roomController,
  analyticsController,
  authController,
  userController,
  deviceController,
  notificationController,
  leaseController
};
