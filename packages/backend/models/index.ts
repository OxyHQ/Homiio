/**
 * Model registry.
 *
 * Source files under `models/schemas/*` are still CJS (`module.exports =
 * mongoose.model(...)`) — they remain untouched so existing tests keep working
 * via `require('../../models')`. This file gives the rest of the codebase
 * typed, named ES imports while still emitting a CJS `module.exports` for those
 * legacy callers.
 *
 * Document interfaces live in `./documentTypes` (lightweight) or beside the
 * TS-native model files (`./Property`, `./Address`, `./Review`).
 */

import type { Model } from 'mongoose';

import type { IProperty, IPropertyModel } from './Property';
import type { IAddress, IAddressModel } from './Address';
import type { IReview, IReviewModel } from './Review';
import type {
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
  IListingReport,
  IPartner,
  ICommission,
  IImage,
  IPlacePoi,
  IRoommateRequest,
  IRoommateRelationship,
  IEvictionCase,
  IEvictionComment,
  IEvictionReport,
} from './documentTypes';

// Schemas are CJS — `require` them and cast to typed Mongoose Models.

const PropertyModel = require('./schemas/PropertySchema') as IPropertyModel;
const AddressModel = (require('./Address').default) as IAddressModel;
const ReviewModel = (require('./Review').Review) as IReviewModel;
const LeaseModel = require('./schemas/LeaseSchema') as ILeaseModel;
const RecentlyViewedModel = require('./schemas/RecentlyViewedSchema') as Model<IRecentlyViewed>;
const ViewingRequestModel = require('./schemas/ViewingRequestSchema') as Model<IViewingRequest>;
const SavedPropertyFolderModel = require('./schemas/SavedPropertyFolderSchema') as Model<ISavedPropertyFolder>;
const SavedSearchModel = require('./schemas/SavedSearchSchema') as Model<ISavedSearch>;
const ProfileModel = require('./schemas/ProfileSchema') as IProfileModel;
const ConversationModel = require('./schemas/ConversationSchema') as IConversationModel;
const CountryModel = require('./schemas/CountrySchema') as Model<ICountry>;
const RegionModel = require('./schemas/RegionSchema') as Model<IRegion>;
const CityModel = require('./schemas/CitySchema') as ICityModel;
const NeighborhoodModel = require('./schemas/NeighborhoodSchema') as Model<INeighborhood>;
const SavedModel = require('./schemas/SavedSchema') as Model<ISaved>;
const BillingModel = require('./schemas/BillingSchema') as IBillingModel;
const ReservationModel = require('./schemas/ReservationSchema') as Model<IReservation>;
const TenantApplicationModel = require('./schemas/TenantApplicationSchema') as Model<ITenantApplication>;
const NotificationModel = require('./schemas/NotificationSchema') as Model<INotification>;
const ExchangeRequestModel = require('./schemas/ExchangeRequestSchema') as Model<IExchangeRequest>;
const ExchangeReviewModel = require('./schemas/ExchangeReviewSchema') as Model<IExchangeReview>;
const ListingReportModel = require('./schemas/ListingReportSchema') as Model<IListingReport>;
const PartnerModel = require('./schemas/PartnerSchema') as Model<IPartner>;
const CommissionModel = require('./schemas/CommissionSchema') as Model<ICommission>;
const ImageModel = require('./schemas/ImageSchema') as Model<IImage>;
const PlacePoiModel = require('./schemas/PlacePoiSchema') as Model<IPlacePoi>;
const RoommateRequestModel = require('./schemas/RoommateRequestSchema') as Model<IRoommateRequest>;
const RoommateRelationshipModel = require('./schemas/RoommateRelationshipSchema') as Model<IRoommateRelationship>;
const EvictionCaseModel = require('./schemas/EvictionCaseSchema') as Model<IEvictionCase>;
const EvictionCommentModel = require('./schemas/EvictionCommentSchema') as Model<IEvictionComment>;
const EvictionReportModel = require('./schemas/EvictionReportSchema') as Model<IEvictionReport>;

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
export const ListingReport = ListingReportModel;
export const Partner = PartnerModel;
export const Commission = CommissionModel;
export const Image = ImageModel;
export const PlacePoi = PlacePoiModel;
export const RoommateRequest = RoommateRequestModel;
export const RoommateRelationship = RoommateRelationshipModel;
export const EvictionCase = EvictionCaseModel;
export const EvictionComment = EvictionCommentModel;
export const EvictionReport = EvictionReportModel;

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
  IListingReport,
  IPartner,
  ICommission,
  IImage,
  IPlacePoi,
  IRoommateRequest,
  IRoommateRelationship,
  IEvictionCase,
  IEvictionComment,
  IEvictionReport,
};

// Legacy CJS callers (`const models = require('../../models')` — used by the
// Jest helpers and integration tests) need this aggregate as `module.exports`.
// We assign it last so it overrides whatever the TS-emitted `exports.X = ...`
// markers would have provided to require() consumers; named ES imports inside
// this codebase still resolve to the same singletons because they read the
// same keys off `module.exports`.
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
  ListingReport: ListingReportModel,
  Partner: PartnerModel,
  Commission: CommissionModel,
  Image: ImageModel,
  PlacePoi: PlacePoiModel,
  RoommateRequest: RoommateRequestModel,
  RoommateRelationship: RoommateRelationshipModel,
  EvictionCase: EvictionCaseModel,
  EvictionComment: EvictionCommentModel,
  EvictionReport: EvictionReportModel,
};
