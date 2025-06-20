/**
 * Controllers Index
 * Central export for all controller components
 */

const propertyController = require('./propertyController');
const roomController = require('./roomController');
const analyticsController = require('./analyticsController');

module.exports = {
  propertyController,
  roomController,
  analyticsController
};
