/**
 * Models Index
 * Central export for all Homio Mongoose models
 */

// Mongoose schemas (database models)
const PropertyModel = require('./schemas/PropertySchema');
const RoomModel = require('./schemas/RoomSchema');
const LeaseModel = require('./schemas/LeaseSchema');
const EnergyDataModel = require('./schemas/EnergyDataSchema');
const RecentlyViewedModel = require('./schemas/RecentlyViewedSchema');
const SavedPropertyFolderModel = require('./schemas/SavedPropertyFolderSchema');
const SavedSearchModel = require('./schemas/SavedSearchSchema');
const ProfileModel = require('./schemas/ProfileSchema');
const ConversationModel = require('./schemas/ConversationSchema');
const CityModel = require('./schemas/CitySchema');

module.exports = {
  // Mongoose models
  Property: PropertyModel,
  Room: RoomModel,
  Lease: LeaseModel,
  EnergyData: EnergyDataModel,
  RecentlyViewed: RecentlyViewedModel,
  SavedPropertyFolder: SavedPropertyFolderModel,
  SavedSearch: SavedSearchModel,
  Profile: ProfileModel,
  Conversation: ConversationModel,
  City: CityModel
};
