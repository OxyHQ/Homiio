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

import propertyController from './propertyController';
import roomController from './roomController';
import analyticsController from './analyticsController';
import notificationController from './notificationController';
import leaseController from './leaseController';
import profileController from './profileController';
import telegramController from './telegramController';
const cityController = resolveExport(require('./cityController'));
const imageController = resolveExport(require('./imageController'));
import billingController from './billingController';

export {
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
