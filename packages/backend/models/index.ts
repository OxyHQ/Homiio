// Mongoose schemas (database models) - using existing schema files
const PropertyModel = require('./schemas/PropertySchema');
const AddressModel = require('./schemas/AddressSchema');
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

// Import the Review model as Mongoose schema
const ReviewModel = require('./schemas/ReviewSchema');

module.exports = {
  // Mongoose models
  Property: PropertyModel,
  Address: AddressModel,
  Review: ReviewModel,
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
