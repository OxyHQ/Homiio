/**
 * Middleware Index
 * Central export for all middleware components
 */

const auth = require('./auth');
const validation = require('./validation');
const errorHandler = require('./errorHandler');
const logging = require('./logging');

module.exports = {
  auth,
  validation,
  errorHandler,
  logging
};
