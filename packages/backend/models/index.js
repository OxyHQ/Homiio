/**
 * Models Index
 * Central export for all Homio models
 */

// Original class-based models (for backward compatibility)
const Property = require('./Property');
const Room = require('./Room');
const Lease = require('./Lease');
const Payment = require('./Payment');
const EnergyData = require('./EnergyData');
const Device = require('./Device');

// Mongoose schemas (new database models)
const PropertyModel = require('./schemas/PropertySchema');
const RoomModel = require('./schemas/RoomSchema');
const LeaseModel = require('./schemas/LeaseSchema');
const EnergyDataModel = require('./schemas/EnergyDataSchema');
const RecentlyViewedModel = require('./schemas/RecentlyViewedSchema');
const SavedPropertyModel = require('./schemas/SavedPropertySchema');
const SavedSearchModel = require('./schemas/SavedSearchSchema');
const Profile = require('./schemas/ProfileSchema');

module.exports = {
  // Class-based models (legacy)
  Property,
  Room,
  Lease,
  Payment,
  EnergyData,
  Device,
  
  // Mongoose models (new)
  PropertyModel,
  RoomModel,
  LeaseModel,
  EnergyDataModel,
  RecentlyViewedModel,
  SavedPropertyModel,
  SavedSearchModel,
  Profile
};
