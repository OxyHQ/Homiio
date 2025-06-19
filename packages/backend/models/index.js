/**
 * Models Index
 * Central export for all Homio models
 */

const User = require('./User');
const Property = require('./Property');
const Room = require('./Room');
const Lease = require('./Lease');
const Payment = require('./Payment');
const EnergyData = require('./EnergyData');
const Device = require('./Device');

module.exports = {
  User,
  Property,
  Room,
  Lease,
  Payment,
  EnergyData,
  Device
};
