/**
 * Middleware Index
 * Central export for all middleware components
 */

import * as validation from './validation';
import * as errorHandler from './errorHandler';
import * as logging from './logging';
import performanceMonitor from './performance';

export {
  validation,
  errorHandler,
  logging,
  performanceMonitor,
};

export const { asyncHandler } = errorHandler;
