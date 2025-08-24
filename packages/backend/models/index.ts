/**
 * Models Index
 * Central export for all Homiio Mongoose models
 */

// Mongoose schemas (database models) - using existing schema files
const PropertyModel = require('./schemas/PropertySchema');
const AddressModel = require('./schemas/AddressSchema');
const RoomModel = require('./schemas/RoomSchema');
const LeaseModel = require('./schemas/LeaseSchema');
const RecentlyViewedModel = require('./schemas/RecentlyViewedSchema');
const ViewingRequestModel = require('./schemas/ViewingRequestSchema');
const SavedPropertyFolderModel = require('./schemas/SavedPropertyFolderSchema');
const SavedSearchModel = require('./schemas/SavedSearchSchema');
const ProfileModel = require('./schemas/ProfileSchema');
const ConversationModel = require('./schemas/ConversationSchema');
const CityModel = require('./schemas/CitySchema');
const SavedModel = require('./schemas/SavedSchema');
const BillingModel = require('./schemas/BillingSchema');

module.exports = {
  // Mongoose models
  Property: PropertyModel,
  Address: AddressModel,
  Room: RoomModel,
  Lease: LeaseModel,
  RecentlyViewed: RecentlyViewedModel,
  ViewingRequest: ViewingRequestModel,
  SavedPropertyFolder: SavedPropertyFolderModel,
  SavedSearch: SavedSearchModel,
  Profile: ProfileModel,
  Conversation: ConversationModel,
  City: CityModel,
  Saved: SavedModel,
  Billing: BillingModel
};
