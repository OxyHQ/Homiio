/**
 * Controllers Index
 * Central export for all controller components
 */

const propertyController = require('./propertyController');
const roomController = require('./roomController');

module.exports = {
  propertyController,
  roomController
};
