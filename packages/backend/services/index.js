/**
 * Services Index
 * Central export for all service components
 */

const energyService = require('./energyService');
const telegramService = require('./telegramService');

module.exports = {
  energyService,
  telegramService,
};
