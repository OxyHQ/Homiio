// Mongoose schemas (database models) - using existing schema files
const PropertyModel = require('./schemas/PropertySchema');
const AddressModel = require('./Address').default; // Use new TypeScript Address model
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
const ReservationModel = require('./schemas/ReservationSchema');
const TenantApplicationModel = require('./schemas/TenantApplicationSchema');

// Import the Review model as TypeScript model
const ReviewModel = require('./Review').Review;

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
  Billing: BillingModel,
  Reservation: ReservationModel,
  TenantApplication: TenantApplicationModel
};
