/**
 * Review Model
 * Comprehensive address review schema with all required fields
 */

import { Schema, model, Document, Types, Model } from 'mongoose';
import {
  TemperatureRating,
  NoiseLevel,
  LightLevel,
  ConditionRating,
  LandlordTreatment,
  ResponseRating,
  NeighborRating,
  NeighborRelations,
  CleaningRating,
  TouristLevel,
  SecurityLevel,
  ServiceType,
  DepositReturn,
  ReviewModerationStatus,
  ReviewReportReason,
} from '@homiio/shared-types';
import type {
  AgencyStats,
  ExploreCitySummary,
  ExploreNeighborhoodSummary,
  ExploreBuildingSummary,
} from '@homiio/shared-types';

// Define the Review interface
export interface IReview extends Document {
  // Address Hierarchy
  addressId: Types.ObjectId; // Reference to the specific address level (building or unit)
  addressLevel: 'BUILDING' | 'UNIT'; // Level at which review is attached
  
  // Hierarchical address references for aggregation
  streetLevelId: Types.ObjectId; // Reference to street-level address
  buildingLevelId: Types.ObjectId; // Reference to building-level address
  unitLevelId?: Types.ObjectId; // Reference to unit-level address (only for UNIT level reviews)

  // Denormalized geo references for the review-explore aggregations. Set
  // server-side at create time from the resolved canonical Address.
  cityId?: Types.ObjectId;
  neighborhoodId?: Types.ObjectId;

  // Relational link to the managing Agency (resolved from the submitted agency
  // name via `Agency.findOrCreateByName`). Never set from the raw request body.
  agencyId?: Types.ObjectId;

  // Basic Information
  title?: string;
  greenHouse: string;
  price: number;
  currency: string;

  // Date Information
  livedFrom: Date;
  livedTo: Date;
  livedForMonths: number;

  // Overall Review
  recommendation: boolean;
  opinion: string;
  prosItems: string[];
  consItems: string[];
  adviceToAgency?: string;
  adviceToLandlord?: string;
  // Legacy free-text pros/cons (superseded by prosItems/consItems).
  positiveComment: string;
  negativeComment: string;
  images: string[];
  rating: number; // 1-5 stars

  // Environmental Conditions
  summerTemperature: TemperatureRating;
  winterTemperature: TemperatureRating;
  noise: NoiseLevel;
  light: LightLevel;
  conditionAndMaintenance: ConditionRating;
  services: ServiceType[];

  // Management
  landlordTreatment: LandlordTreatment;
  problemResponse: ResponseRating;
  depositReturned?: DepositReturn;

  // Neighbors / Community
  staircaseNeighbors: NeighborRating;
  touristApartments: boolean;
  neighborRelations: NeighborRelations;
  cleaning: CleaningRating;

  // Area (300m radius)
  areaTourists: TouristLevel;
  areaSecurity: SecurityLevel;
  areaNoise?: NoiseLevel;
  areaCleanliness?: CleaningRating;

  // Community interaction — distinct oxyUserIds who marked the review helpful.
  helpfulVoters: string[];
  // Trust & safety reports filed against this review.
  reports: IReviewReport[];
  // Moderation lifecycle. 'removed' hides the review from every public read.
  moderationStatus: ReviewModerationStatus;

  // Metadata
  oxyUserId: string;
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
}

/** A single trust & safety report embedded on a {@link IReview}. */
export interface IReviewReport {
  oxyUserId: string;
  reason: ReviewReportReason;
  details?: string;
  createdAt: Date;
}

interface ReviewSummaryStats {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
}

interface UnitViewData {
  unitReviews: IReview[];
  buildingSummary: ReviewSummaryStats;
}

interface BuildingViewData {
  buildingReviews: IReview[];
  unitReviews: IReview[];
  aggregatedStats: ReviewSummaryStats;
}

interface StreetViewData {
  aggregatedStats: ReviewSummaryStats;
  buildingCount: number;
}

function createEmptyReviewSummary(): ReviewSummaryStats {
  return {
    averageRating: 0,
    totalReviews: 0,
    recommendationPercentage: 0
  };
}

/** Round a rating/average to one decimal place. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Round a percentage (0-100) to the nearest whole number. */
function roundPct(value: number): number {
  return Math.round(value);
}

/** Paginated building-summary result for the neighborhood explore view. */
export interface BuildingSummariesResult {
  buildings: ExploreBuildingSummary[];
  total: number;
}

// Define static methods interface
export interface IReviewModel extends Model<IReview> {
  // Hierarchical finder methods
  findByStreetLevel(streetLevelId: string | Types.ObjectId): Promise<IReview[]>;
  findByBuildingLevel(buildingLevelId: string | Types.ObjectId): Promise<IReview[]>;
  findByUnitLevel(unitLevelId: string | Types.ObjectId): Promise<IReview[]>;

  // Aggregation methods for hierarchical views
  getUnitViewData(unitLevelId: string | Types.ObjectId): Promise<UnitViewData>;

  getBuildingViewData(buildingLevelId: string | Types.ObjectId): Promise<BuildingViewData>;

  getStreetViewData(streetLevelId: string | Types.ObjectId): Promise<StreetViewData>;

  // Agency + explore aggregations (reviucasa parity).
  getAgencyStats(agencyId: string | Types.ObjectId): Promise<AgencyStats>;
  getCitiesWithReviews(): Promise<ExploreCitySummary[]>;
  getNeighborhoodSummaries(cityId: string | Types.ObjectId): Promise<ExploreNeighborhoodSummary[]>;
  getBuildingSummaries(
    neighborhoodId: string | Types.ObjectId,
    page: number,
    limit: number,
  ): Promise<BuildingSummariesResult>;
}

const ReviewSchema = new Schema<IReview, IReviewModel>({
  // Address Hierarchy
  addressId: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    required: [true, 'Address ID is required'],
    index: true
  },
  addressLevel: {
    type: String,
    enum: ['BUILDING', 'UNIT'],
    required: [true, 'Address level is required'],
    index: true,
    validate: {
      validator: function(this: IReview, level: string) {
        // Reviews can only be created at BUILDING or UNIT level
        return ['BUILDING', 'UNIT'].includes(level);
      },
      message: 'Reviews can only be created at BUILDING or UNIT level'
    }
  },
  
  // Hierarchical address references for aggregation
  streetLevelId: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    required: [true, 'Street level address is required'],
    index: true
  },
  buildingLevelId: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    required: [true, 'Building level address is required'],
    index: true
  },
  unitLevelId: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    index: true,
    validate: {
      validator: function(this: IReview, value: Types.ObjectId) {
        // unitLevelId is required only for UNIT level reviews
        if (this.addressLevel === 'UNIT') {
          return value != null;
        }
        // For BUILDING level reviews, unitLevelId should be null
        return value == null;
      },
      message: 'Unit level address is required for UNIT level reviews and should be null for BUILDING level reviews'
    }
  },

  // Denormalized geo references (set server-side from the canonical Address).
  cityId: {
    type: Schema.Types.ObjectId,
    ref: 'City',
    index: true
  },
  neighborhoodId: {
    type: Schema.Types.ObjectId,
    ref: 'Neighborhood',
    index: true
  },
  // Relational Agency link (resolved from the submitted agency name).
  agencyId: {
    type: Schema.Types.ObjectId,
    ref: 'Agency',
    index: true
  },

  // Review headline. Optional at the schema level (legacy reviews predate it);
  // the create controller requires it for new submissions.
  title: {
    type: String,
    trim: true,
    minlength: [5, 'Title must be at least 5 characters'],
    maxlength: [120, 'Title cannot exceed 120 characters']
  },
  greenHouse: {
    type: String,
    trim: true,
    maxlength: [200, 'Green house description cannot exceed 200 characters']
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price must be positive']
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: ['EUR', 'USD', 'GBP', 'CAD'],
    default: 'EUR'
  },
  
  // Date Information
  livedFrom: {
    type: Date,
    required: [true, 'Start date is required']
  },
  livedTo: {
    type: Date,
    required: [true, 'End date is required'],
    validate: {
      validator: function(this: IReview, value: Date) {
        return value > this.livedFrom;
      },
      message: 'End date must be after start date'
    }
  },
  livedForMonths: {
    type: Number,
    required: [true, 'Duration in months is required'],
    min: [0, 'Duration must be positive']
  },
  
  // Overall Review
  recommendation: {
    type: Boolean,
    required: [true, 'Recommendation is required']
  },
  opinion: {
    type: String,
    required: [true, 'Opinion is required'],
    trim: true,
    minlength: [10, 'Opinion must be at least 10 characters'],
    maxlength: [2000, 'Opinion cannot exceed 2000 characters']
  },
  // Structured pros/cons (reviucasa parity) — each item capped, list capped.
  prosItems: {
    type: [{ type: String, trim: true, maxlength: [140, 'Each pro cannot exceed 140 characters'] }],
    default: [],
    validate: {
      validator: (items: string[]) => !Array.isArray(items) || items.length <= 10,
      message: 'A review can list at most 10 pros'
    }
  },
  consItems: {
    type: [{ type: String, trim: true, maxlength: [140, 'Each con cannot exceed 140 characters'] }],
    default: [],
    validate: {
      validator: (items: string[]) => !Array.isArray(items) || items.length <= 10,
      message: 'A review can list at most 10 cons'
    }
  },
  adviceToAgency: {
    type: String,
    trim: true,
    maxlength: [1000, 'Advice to agency cannot exceed 1000 characters']
  },
  adviceToLandlord: {
    type: String,
    trim: true,
    maxlength: [1000, 'Advice to landlord cannot exceed 1000 characters']
  },
  // Legacy free-text pros/cons (read-only; superseded by prosItems/consItems).
  positiveComment: {
    type: String,
    trim: true,
    maxlength: [1000, 'Positive comment cannot exceed 1000 characters']
  },
  negativeComment: {
    type: String,
    trim: true,
    maxlength: [1000, 'Negative comment cannot exceed 1000 characters']
  },
  images: [{
    type: String,
    validate: {
      validator: function(url: string) {
        // Allow an optional query string (portal/CDN variant params).
        return /^https?:\/\/.+\.(jpg|jpeg|png|webp)(\?.*)?$/i.test(url);
      },
      message: 'Invalid image URL format'
    }
  }],
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating cannot exceed 5'],
    validate: {
      validator: Number.isInteger,
      message: 'Rating must be an integer'
    }
  },
  
  // Environmental Conditions (optional - can be added later)
  summerTemperature: {
    type: String,
    enum: Object.values(TemperatureRating),
    required: false
  },
  winterTemperature: {
    type: String,
    enum: Object.values(TemperatureRating),
    required: false
  },
  noise: {
    type: String,
    enum: Object.values(NoiseLevel),
    required: false
  },
  light: {
    type: String,
    enum: Object.values(LightLevel),
    required: false
  },
  conditionAndMaintenance: {
    type: String,
    enum: Object.values(ConditionRating),
    required: false
  },
  services: [{
    type: String,
    enum: Object.values(ServiceType)
  }],
  
  // Management (optional - can be added later)
  landlordTreatment: {
    type: String,
    enum: Object.values(LandlordTreatment),
    required: false
  },
  problemResponse: {
    type: String,
    enum: Object.values(ResponseRating),
    required: false
  },
  depositReturned: {
    type: String,
    enum: Object.values(DepositReturn),
    required: false
  },
  
  // Neighbors / Community (optional - can be added later)
  staircaseNeighbors: {
    type: String,
    enum: Object.values(NeighborRating),
    required: false
  },
  touristApartments: {
    type: Boolean,
    required: false
  },
  neighborRelations: {
    type: String,
    enum: Object.values(NeighborRelations),
    required: false
  },
  cleaning: {
    type: String,
    enum: Object.values(CleaningRating),
    required: false
  },
  
  // Area (300m radius) (optional - can be added later)
  areaTourists: {
    type: String,
    enum: Object.values(TouristLevel),
    required: false
  },
  areaSecurity: {
    type: String,
    enum: Object.values(SecurityLevel),
    required: false
  },
  areaNoise: {
    type: String,
    enum: Object.values(NoiseLevel),
    required: false
  },
  areaCleanliness: {
    type: String,
    enum: Object.values(CleaningRating),
    required: false
  },

  // ---- Community interaction & moderation ----
  // Distinct oxyUserIds who marked the review helpful. Length = helpful count;
  // never exposed raw (the DTO derives helpfulCount + viewerHasVotedHelpful).
  helpfulVoters: {
    type: [String],
    default: []
  },
  // Trust & safety reports. Stripped from every public DTO.
  reports: {
    type: [new Schema({
      oxyUserId: { type: String, required: true },
      reason: {
        type: String,
        enum: Object.values(ReviewReportReason),
        required: true
      },
      details: { type: String, trim: true, maxlength: [500, 'Report details cannot exceed 500 characters'] },
      createdAt: { type: Date, default: Date.now }
    }, { _id: false })],
    default: []
  },
  // Moderation lifecycle: 'active' (default), 'under_review' (>=3 reports),
  // 'removed' (hidden from every public read).
  moderationStatus: {
    type: String,
    enum: Object.values(ReviewModerationStatus),
    default: ReviewModerationStatus.ACTIVE,
    index: true
  },

  // Metadata
  oxyUserId: {
    type: String,
    required: [true, 'Oxy user id is required'],
    index: true,
  },
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying
ReviewSchema.index({ addressId: 1, createdAt: -1 });
ReviewSchema.index({ oxyUserId: 1, createdAt: -1 });
ReviewSchema.index({ rating: -1 });
ReviewSchema.index({ recommendation: 1 });
ReviewSchema.index({ verified: 1 });

// Hierarchical indexes for efficient address-level queries
ReviewSchema.index({ streetLevelId: 1, addressLevel: 1, createdAt: -1 });
ReviewSchema.index({ buildingLevelId: 1, addressLevel: 1, createdAt: -1 });
ReviewSchema.index({ unitLevelId: 1, addressLevel: 1, createdAt: -1 });
ReviewSchema.index({ addressLevel: 1, createdAt: -1 });

// Agency profile + review-explore aggregations (newest-first per geo/agency).
ReviewSchema.index({ agencyId: 1, createdAt: -1 });
ReviewSchema.index({ cityId: 1, createdAt: -1 });
ReviewSchema.index({ neighborhoodId: 1, createdAt: -1 });

// Virtual for calculating lived duration
ReviewSchema.virtual('livedDurationText').get(function(this: IReview) {
  const months = this.livedForMonths;
  if (months < 12) {
    return `${months} month${months !== 1 ? 's' : ''}`;
  }
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }
  return `${years} year${years !== 1 ? 's' : ''} ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
});

// Derive the tenancy duration BEFORE validation. `livedForMonths` is a required
// field that is ALWAYS server-computed from livedFrom/livedTo (the create
// payload never supplies it), so this must run on `validate` — a `save` hook
// would fire after the required-field check and reject every create.
ReviewSchema.pre('validate', function(this: IReview, next) {
  if (this.livedFrom && this.livedTo) {
    const diffTime = Math.abs(this.livedTo.getTime() - this.livedFrom.getTime());
    const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44)); // Average month length
    this.livedForMonths = diffMonths;
  }
  next();
});

// Moderation filter shared by every public read/aggregation. 'removed' reviews
// are hidden everywhere; 'under_review' stays visible.
const VISIBLE_MODERATION = { $ne: ReviewModerationStatus.REMOVED } as const;

// Static methods
ReviewSchema.static('findByStreetLevel', function findByStreetLevel(
  this: IReviewModel,
  streetLevelId: string | Types.ObjectId
): Promise<IReview[]> {
  return this.find({ streetLevelId, moderationStatus: VISIBLE_MODERATION })
    .sort({ createdAt: -1 })
    .exec();
});

ReviewSchema.static('findByBuildingLevel', function findByBuildingLevel(
  this: IReviewModel,
  buildingLevelId: string | Types.ObjectId
): Promise<IReview[]> {
  return this.find({ buildingLevelId, moderationStatus: VISIBLE_MODERATION })
    .sort({ createdAt: -1 })
    .exec();
});

ReviewSchema.static('findByUnitLevel', function findByUnitLevel(
  this: IReviewModel,
  unitLevelId: string | Types.ObjectId
): Promise<IReview[]> {
  return this.find({ unitLevelId, moderationStatus: VISIBLE_MODERATION })
    .sort({ createdAt: -1 })
    .exec();
});

// UNIT view: own reviews + building summary
ReviewSchema.static('getUnitViewData', async function getUnitViewData(
  this: IReviewModel,
  unitLevelId: string | Types.ObjectId
): Promise<UnitViewData> {
  const unitReviews = await this.findByUnitLevel(unitLevelId);

  // Get the building level from one of the unit reviews
  const sampleReview = await this.findOne({ unitLevelId, moderationStatus: VISIBLE_MODERATION }).exec();
  if (!sampleReview?.buildingLevelId) {
    return {
      unitReviews,
      buildingSummary: createEmptyReviewSummary()
    };
  }

  const buildingSummaries = await this.aggregate<ReviewSummaryStats>([
    { $match: { buildingLevelId: sampleReview.buildingLevelId, addressLevel: 'BUILDING', moderationStatus: VISIBLE_MODERATION } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        recommendationPercentage: { 
          $avg: { $cond: [{ $eq: ['$recommendation', true] }, 100, 0] }
        }
      }
    }
  ]).exec();
  const buildingSummary = buildingSummaries[0] ?? createEmptyReviewSummary();
  
  return { unitReviews, buildingSummary };
});

// BUILDING view: building reviews + all unit reviews
ReviewSchema.static('getBuildingViewData', async function getBuildingViewData(
  this: IReviewModel,
  buildingLevelId: string | Types.ObjectId
): Promise<BuildingViewData> {
  const buildingReviews = await this.find({
    buildingLevelId,
    addressLevel: 'BUILDING',
    moderationStatus: VISIBLE_MODERATION
  }).sort({ createdAt: -1 }).exec();

  const unitReviews = await this.find({
    buildingLevelId,
    addressLevel: 'UNIT',
    moderationStatus: VISIBLE_MODERATION
  }).sort({ createdAt: -1 }).exec();

  const aggregateResults = await this.aggregate<ReviewSummaryStats>([
    { $match: { buildingLevelId: new Types.ObjectId(buildingLevelId.toString()), moderationStatus: VISIBLE_MODERATION } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        recommendationPercentage: { 
          $avg: { $cond: [{ $eq: ['$recommendation', true] }, 100, 0] }
        }
      }
    }
  ]).exec();
  const aggregatedStats = aggregateResults[0] ?? createEmptyReviewSummary();
  
  return { buildingReviews, unitReviews, aggregatedStats };
});

// STREET view: aggregates all building reviews
ReviewSchema.static('getStreetViewData', async function getStreetViewData(
  this: IReviewModel,
  streetLevelId: string | Types.ObjectId
): Promise<StreetViewData> {
  const aggregateResults = await this.aggregate<ReviewSummaryStats>([
    { $match: { streetLevelId: new Types.ObjectId(streetLevelId.toString()), moderationStatus: VISIBLE_MODERATION } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        recommendationPercentage: {
          $avg: { $cond: [{ $eq: ['$recommendation', true] }, 100, 0] }
        }
      }
    }
  ]).exec();
  const aggregatedStats = aggregateResults[0] ?? createEmptyReviewSummary();

  const buildingCount = await this.distinct('buildingLevelId', {
    streetLevelId: new Types.ObjectId(streetLevelId.toString()),
    moderationStatus: VISIBLE_MODERATION
  }).then((buildings: Types.ObjectId[]) => buildings.length);

  return { aggregatedStats, buildingCount };
});

// ---------------------------------------------------------------------------
// Agency + explore aggregations (reviucasa parity). Every pipeline excludes
// 'removed' reviews via `VISIBLE_MODERATION`.
// ---------------------------------------------------------------------------

interface AgencyStatsRow {
  averageRating: number;
  totalReviews: number;
  recommendCount: number;
  depositFullCount: number;
  depositKnownCount: number;
}

// AGENCY: average rating, total, recommendation %, deposit-full %.
ReviewSchema.static('getAgencyStats', async function getAgencyStats(
  this: IReviewModel,
  agencyId: string | Types.ObjectId
): Promise<AgencyStats> {
  const rows = await this.aggregate<AgencyStatsRow>([
    { $match: { agencyId: new Types.ObjectId(agencyId.toString()), moderationStatus: VISIBLE_MODERATION } },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
        recommendCount: { $sum: { $cond: [{ $eq: ['$recommendation', true] }, 1, 0] } },
        depositFullCount: { $sum: { $cond: [{ $eq: ['$depositReturned', DepositReturn.FULL] }, 1, 0] } },
        depositKnownCount: { $sum: { $cond: [{ $in: ['$depositReturned', Object.values(DepositReturn)] }, 1, 0] } }
      }
    }
  ]).exec();

  const row = rows[0];
  if (!row || !row.totalReviews) {
    return { averageRating: 0, totalReviews: 0, recommendationPercentage: 0, depositFullPct: 0 };
  }
  return {
    averageRating: round1(row.averageRating),
    totalReviews: row.totalReviews,
    recommendationPercentage: roundPct((row.recommendCount / row.totalReviews) * 100),
    depositFullPct: row.depositKnownCount > 0
      ? roundPct((row.depositFullCount / row.depositKnownCount) * 100)
      : 0
  };
});

interface CityRow {
  _id: Types.ObjectId;
  reviewCount: number;
  averageRating: number;
  city: { name: string };
}

// EXPLORE (cities): coverage per city, newest coverage first by review count.
ReviewSchema.static('getCitiesWithReviews', async function getCitiesWithReviews(
  this: IReviewModel
): Promise<ExploreCitySummary[]> {
  const cityCollection = this.db.model('City').collection.collectionName;
  const rows = await this.aggregate<CityRow>([
    { $match: { cityId: { $ne: null }, moderationStatus: VISIBLE_MODERATION } },
    { $group: { _id: '$cityId', reviewCount: { $sum: 1 }, averageRating: { $avg: '$rating' } } },
    { $lookup: { from: cityCollection, localField: '_id', foreignField: '_id', as: 'city' } },
    { $unwind: '$city' },
    { $sort: { reviewCount: -1 } }
  ]).exec();

  return rows.map((row) => ({
    cityId: String(row._id),
    name: row.city.name,
    reviewCount: row.reviewCount,
    averageRating: round1(row.averageRating)
  }));
});

interface NeighborhoodRow {
  _id: Types.ObjectId;
  reviewCount: number;
  averageRating: number;
  neighborhood: { name: string };
}

// EXPLORE (neighborhoods in a city): coverage per neighborhood.
ReviewSchema.static('getNeighborhoodSummaries', async function getNeighborhoodSummaries(
  this: IReviewModel,
  cityId: string | Types.ObjectId
): Promise<ExploreNeighborhoodSummary[]> {
  const neighborhoodCollection = this.db.model('Neighborhood').collection.collectionName;
  const rows = await this.aggregate<NeighborhoodRow>([
    {
      $match: {
        cityId: new Types.ObjectId(cityId.toString()),
        neighborhoodId: { $ne: null },
        moderationStatus: VISIBLE_MODERATION
      }
    },
    { $group: { _id: '$neighborhoodId', reviewCount: { $sum: 1 }, averageRating: { $avg: '$rating' } } },
    { $lookup: { from: neighborhoodCollection, localField: '_id', foreignField: '_id', as: 'neighborhood' } },
    { $unwind: '$neighborhood' },
    { $sort: { reviewCount: -1 } }
  ]).exec();

  return rows.map((row) => ({
    neighborhoodId: String(row._id),
    name: row.neighborhood.name,
    reviewCount: row.reviewCount,
    averageRating: round1(row.averageRating)
  }));
});

interface BuildingSummaryFacet {
  buildings: Array<{
    _id: Types.ObjectId;
    reviewCount: number;
    averageRating: number;
    recommendCount: number;
    address?: { street?: string; number?: string };
  }>;
  totalCount: Array<{ count: number }>;
}

// EXPLORE (buildings in a neighborhood): paginated building cards; street +
// number come from the building-level Address doc.
ReviewSchema.static('getBuildingSummaries', async function getBuildingSummaries(
  this: IReviewModel,
  neighborhoodId: string | Types.ObjectId,
  page: number,
  limit: number
): Promise<BuildingSummariesResult> {
  const addressCollection = this.db.model('Address').collection.collectionName;
  const safePage = Math.max(1, page);
  const safeLimit = Math.max(1, limit);
  const skip = (safePage - 1) * safeLimit;

  const facets = await this.aggregate<BuildingSummaryFacet>([
    {
      $match: {
        neighborhoodId: new Types.ObjectId(neighborhoodId.toString()),
        moderationStatus: VISIBLE_MODERATION
      }
    },
    {
      $group: {
        _id: '$buildingLevelId',
        reviewCount: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        recommendCount: { $sum: { $cond: [{ $eq: ['$recommendation', true] }, 1, 0] } }
      }
    },
    { $sort: { reviewCount: -1, _id: 1 } },
    {
      $facet: {
        buildings: [
          { $skip: skip },
          { $limit: safeLimit },
          { $lookup: { from: addressCollection, localField: '_id', foreignField: '_id', as: 'address' } },
          { $unwind: { path: '$address', preserveNullAndEmptyArrays: true } }
        ],
        totalCount: [{ $count: 'count' }]
      }
    }
  ]).exec();

  const facet = facets[0];
  const total = facet?.totalCount?.[0]?.count ?? 0;
  const buildings: ExploreBuildingSummary[] = (facet?.buildings ?? []).map((row) => ({
    buildingLevelId: String(row._id),
    street: row.address?.street ?? '',
    number: row.address?.number,
    reviewCount: row.reviewCount,
    averageRating: round1(row.averageRating),
    recommendationPercentage: row.reviewCount > 0
      ? roundPct((row.recommendCount / row.reviewCount) * 100)
      : 0
  }));

  return { buildings, total };
});

// Create and export the model
export const Review = model<IReview, IReviewModel>('Review', ReviewSchema);
export default Review;
