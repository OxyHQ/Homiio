/**
 * Models Index
 * Central export for all Homio models
 */

// Original class-based models (for backward compatibility)
const User = require('./User');
const Property = require('./Property');
const Room = require('./Room');
const Lease = require('./Lease');
const Payment = require('./Payment');
const EnergyData = require('./EnergyData');
const Device = require('./Device');

// Mongoose schemas (new database models)
const PropertyModel = require('./schemas/PropertySchema');
const RoomModel = require('./schemas/RoomSchema');
const UserModel = require('./schemas/UserSchema');
const LeaseModel = require('./schemas/LeaseSchema');
const EnergyDataModel = require('./schemas/EnergyDataSchema');
const RecentlyViewedModel = require('./schemas/RecentlyViewedSchema');

module.exports = {
  // Class-based models (legacy)
  User,
  Property,
  Room,
  Lease,
  Payment,
  EnergyData,
  Device,
  
  // Mongoose models (new)
  PropertyModel,
  RoomModel,
  UserModel,
  LeaseModel,
  EnergyDataModel,
  RecentlyViewedModel
};
