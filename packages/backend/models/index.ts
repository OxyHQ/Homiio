/**
 * Model registry — the one place a Mongoose model is resolved.
 *
 * Every schema under `models/schemas/*` exports its model as a default export,
 * and this file imports them and attaches the document interface that
 * `mongoose.model()` cannot infer from a schema literal.
 *
 * Document interfaces live in `./documentTypes` (lightweight) or beside the
 * TS-native model files (`./Address`, `./Review`).
 *
 * The `module.exports` aggregate at the bottom is a bridge for the ~30 files
 * that still do `require('../models')`; it goes when they do.
 */

import type { IAddress, IAddressModel } from './Address';
import type { IReview, IReviewModel } from './Review';
import type {
  IProperty,
  IPropertyModel,
  IBilling,
  IBillingModel,
  ILease,
  ILeaseModel,
  IProfile,
  IProfileModel,
  IReservation,
  ITenantApplication,
  IViewingRequest,
  ISaved,
  ISavedSearch,
  ISavedPropertyFolder,
  IRecentlyViewed,
  INotification,
  IConversation,
  IConversationModel,
  ICountry,
  IRegion,
  ICity,
  ICityModel,
  INeighborhood,
  IExchangeRequest,
  IExchangeReview,
  IAgency,
  IAgencyModel,
  IPartner,
  ICommission,
  IImage,
  IPlacePoi,
  IRoommateRequest,
  IRoommateRelationship,
} from './documentTypes';

import PropertyModelDefault from './schemas/PropertySchema';
import AddressModelDefault from './Address';
import { Review as ReviewSource } from './Review';
import LeaseModelDefault from './schemas/LeaseSchema';
import RecentlyViewedModelDefault from './schemas/RecentlyViewedSchema';
import ViewingRequestModelDefault from './schemas/ViewingRequestSchema';
import SavedPropertyFolderModelDefault from './schemas/SavedPropertyFolderSchema';
import SavedSearchModelDefault from './schemas/SavedSearchSchema';
import ProfileModelDefault from './schemas/ProfileSchema';
import ConversationModelDefault from './schemas/ConversationSchema';
import CountryModelDefault from './schemas/CountrySchema';
import RegionModelDefault from './schemas/RegionSchema';
import CityModelDefault from './schemas/CitySchema';
import NeighborhoodModelDefault from './schemas/NeighborhoodSchema';
import SavedModelDefault from './schemas/SavedSchema';
import BillingModelDefault from './schemas/BillingSchema';
import ReservationModelDefault from './schemas/ReservationSchema';
import TenantApplicationModelDefault from './schemas/TenantApplicationSchema';
import NotificationModelDefault from './schemas/NotificationSchema';
import ExchangeRequestModelDefault from './schemas/ExchangeRequestSchema';
import ExchangeReviewModelDefault from './schemas/ExchangeReviewSchema';
import AgencyModelDefault from './schemas/AgencySchema';
import PartnerModelDefault from './schemas/PartnerSchema';
import CommissionModelDefault from './schemas/CommissionSchema';
import ImageModelDefault from './schemas/ImageSchema';
import PlacePoiModelDefault from './schemas/PlacePoiSchema';
import RoommateRequestModelDefault from './schemas/RoommateRequestSchema';
import RoommateRelationshipModelDefault from './schemas/RoommateRelationshipSchema';

// The casts attach each document interface, which `mongoose.model()` cannot
// infer from the schema literal on its own.

const PropertyModel = PropertyModelDefault;
const AddressModel = AddressModelDefault;
const ReviewModel = ReviewSource;
const LeaseModel = LeaseModelDefault;
const RecentlyViewedModel = RecentlyViewedModelDefault;
const ViewingRequestModel = ViewingRequestModelDefault;
const SavedPropertyFolderModel = SavedPropertyFolderModelDefault;
const SavedSearchModel = SavedSearchModelDefault;
const ProfileModel = ProfileModelDefault;
const ConversationModel = ConversationModelDefault;
const CountryModel = CountryModelDefault;
const RegionModel = RegionModelDefault;
const CityModel = CityModelDefault;
const NeighborhoodModel = NeighborhoodModelDefault;
const SavedModel = SavedModelDefault;
const BillingModel = BillingModelDefault;
const ReservationModel = ReservationModelDefault;
const TenantApplicationModel = TenantApplicationModelDefault;
const NotificationModel = NotificationModelDefault;
const ExchangeRequestModel = ExchangeRequestModelDefault;
const ExchangeReviewModel = ExchangeReviewModelDefault;
const AgencyModel = AgencyModelDefault;
const PartnerModel = PartnerModelDefault;
const CommissionModel = CommissionModelDefault;
const ImageModel = ImageModelDefault;
const PlacePoiModel = PlacePoiModelDefault;
const RoommateRequestModel = RoommateRequestModelDefault;
const RoommateRelationshipModel = RoommateRelationshipModelDefault;

// CrowdSource moderation. TS-native models, required the same way as the rest so
// they land on the aggregate `module.exports` below alongside them.

// Named ES exports — preferred for new code.
export const Property = PropertyModel;
export const Address = AddressModel;
export const Review = ReviewModel;
export const Lease = LeaseModel;
export const RecentlyViewed = RecentlyViewedModel;
export const ViewingRequest = ViewingRequestModel;
export const SavedPropertyFolder = SavedPropertyFolderModel;
export const SavedSearch = SavedSearchModel;
export const Profile = ProfileModel;
export const Conversation = ConversationModel;
export const Country = CountryModel;
export const Region = RegionModel;
export const City = CityModel;
export const Neighborhood = NeighborhoodModel;
export const Saved = SavedModel;
export const Billing = BillingModel;
export const Reservation = ReservationModel;
export const TenantApplication = TenantApplicationModel;
export const Notification = NotificationModel;
export const ExchangeRequest = ExchangeRequestModel;
export const ExchangeReview = ExchangeReviewModel;
export const Agency = AgencyModel;
export const Partner = PartnerModel;
export const Commission = CommissionModel;
export const Image = ImageModel;
export const PlacePoi = PlacePoiModel;
export const RoommateRequest = RoommateRequestModel;
export const RoommateRelationship = RoommateRelationshipModel;

// Re-export the document interfaces so callers can `import type { ILease } from '../models'`.
export type {
  IProperty,
  IPropertyModel,
  IAddress,
  IAddressModel,
  IReview,
  IReviewModel,
  IBilling,
  IBillingModel,
  ILease,
  ILeaseModel,
  IProfile,
  IProfileModel,
  IReservation,
  ITenantApplication,
  IViewingRequest,
  ISaved,
  ISavedSearch,
  ISavedPropertyFolder,
  IRecentlyViewed,
  INotification,
  IConversation,
  IConversationModel,
  ICountry,
  IRegion,
  ICity,
  ICityModel,
  INeighborhood,
  IExchangeRequest,
  IExchangeReview,
  IAgency,
  IAgencyModel,
  IPartner,
  ICommission,
  IImage,
  IPlacePoi,
  IRoommateRequest,
  IRoommateRelationship,
};

// The remaining `require('../models')` callers (Jest helpers, integration
// tests, a handful of controllers) need this aggregate as `module.exports`. It
// is assigned last so it overrides the TS-emitted `exports.X = ...` markers;
// named ES imports inside this codebase still resolve to the same singletons
// because they read the same keys off it. Delete this block once the last
// `require('../models')` is gone.
module.exports = {
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
  Agency: AgencyModel,
  Partner: PartnerModel,
  Commission: CommissionModel,
  Image: ImageModel,
  PlacePoi: PlacePoiModel,
  RoommateRequest: RoommateRequestModel,
  RoommateRelationship: RoommateRelationshipModel,
};
