/**
 * Controllers Index
 * Central export for all controller components
 */

function resolveExport<T>(mod: T | { default: T }): T {
  if (mod && typeof mod === 'object' && 'default' in mod && (mod as { default: T }).default) {
    return (mod as { default: T }).default;
  }
  return mod as T;
}

const propertyController = require('./propertyController');
const roomController = require('./roomController');
const analyticsController = require('./analyticsController');
const notificationController = require('./notificationController');
const leaseController = require('./leaseController');
const profileController = require('./profileController');
const telegramController = require('./telegramController');
const cityController = resolveExport(require('./cityController'));
const imageController = resolveExport(require('./imageController'));
const billingController = require('./billingController');

module.exports = {
  propertyController,
  roomController,
  analyticsController,
  notificationController,
  leaseController,
  profileController,
  telegramController,
  cityController,
  imageController,
  billingController,
};
