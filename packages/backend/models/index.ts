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
const CountryModel = require('./schemas/CountrySchema');
const RegionModel = require('./schemas/RegionSchema');
const CityModel = require('./schemas/CitySchema');
const NeighborhoodModel = require('./schemas/NeighborhoodSchema');
const SavedModel = require('./schemas/SavedSchema');
const BillingModel = require('./schemas/BillingSchema');
const ReservationModel = require('./schemas/ReservationSchema');
const TenantApplicationModel = require('./schemas/TenantApplicationSchema');
const NotificationModel = require('./schemas/NotificationSchema');
const ExchangeRequestModel = require('./schemas/ExchangeRequestSchema');
const ExchangeReviewModel = require('./schemas/ExchangeReviewSchema');
const ListingReportModel = require('./schemas/ListingReportSchema');
const PartnerModel = require('./schemas/PartnerSchema');
const CommissionModel = require('./schemas/CommissionSchema');
const ImageModel = require('./schemas/ImageSchema');
const PlacePoiModel = require('./schemas/PlacePoiSchema');

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
  Country: CountryModel,
  Region: RegionModel,
  City: CityModel,
  Neighborhood: NeighborhoodModel,
  Saved: SavedModel,
  Billing: BillingModel,
  Reservation: ReservationModel,
  TenantApplication: TenantApplicationModel,
  Notification: NotificationModel,
  ExchangeRequest: ExchangeRequestModel,
  ExchangeReview: ExchangeReviewModel,
  ListingReport: ListingReportModel,
  Partner: PartnerModel,
  Commission: CommissionModel,
  Image: ImageModel,
  PlacePoi: PlacePoiModel
};
