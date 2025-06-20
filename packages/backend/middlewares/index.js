/**
 * Middleware Index
 * Central export for all middleware components
 */

const validation = require('./validation');
const errorHandler = require('./errorHandler');
const logging = require('./logging');

module.exports = {
  validation,
  errorHandler,
  logging
};
