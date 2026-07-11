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
  
  // Basic Information
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
  depositReturned: boolean;
  
  // Neighbors / Community
  staircaseNeighbors: NeighborRating;
  touristApartments: boolean;
  neighborRelations: NeighborRelations;
  cleaning: CleaningRating;
  
  // Area (300m radius)
  areaTourists: TouristLevel;
  areaSecurity: SecurityLevel;
  
  // Metadata
  oxyUserId: string;
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
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
        return /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i.test(url);
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
    type: Boolean,
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

// Pre-save middleware to calculate lived duration
ReviewSchema.pre('save', function(this: IReview, next) {
  if (this.livedFrom && this.livedTo) {
    const diffTime = Math.abs(this.livedTo.getTime() - this.livedFrom.getTime());
    const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44)); // Average month length
    this.livedForMonths = diffMonths;
  }
  next();
});

// Static methods
ReviewSchema.static('findByStreetLevel', function findByStreetLevel(
  this: IReviewModel,
  streetLevelId: string | Types.ObjectId
): Promise<IReview[]> {
  return this.find({ streetLevelId })
    .sort({ createdAt: -1 })
    .exec();
});

ReviewSchema.static('findByBuildingLevel', function findByBuildingLevel(
  this: IReviewModel,
  buildingLevelId: string | Types.ObjectId
): Promise<IReview[]> {
  return this.find({ buildingLevelId })
    .sort({ createdAt: -1 })
    .exec();
});

ReviewSchema.static('findByUnitLevel', function findByUnitLevel(
  this: IReviewModel,
  unitLevelId: string | Types.ObjectId
): Promise<IReview[]> {
  return this.find({ unitLevelId })
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
  const sampleReview = await this.findOne({ unitLevelId }).exec();
  if (!sampleReview?.buildingLevelId) {
    return {
      unitReviews,
      buildingSummary: createEmptyReviewSummary()
    };
  }
  
  const buildingSummaries = await this.aggregate<ReviewSummaryStats>([
    { $match: { buildingLevelId: sampleReview.buildingLevelId, addressLevel: 'BUILDING' } },
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
    addressLevel: 'BUILDING' 
  }).sort({ createdAt: -1 }).exec();

  const unitReviews = await this.find({
    buildingLevelId,
    addressLevel: 'UNIT',
  }).sort({ createdAt: -1 }).exec();
  
  const aggregateResults = await this.aggregate<ReviewSummaryStats>([
    { $match: { buildingLevelId: new Types.ObjectId(buildingLevelId.toString()) } },
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
    { $match: { streetLevelId: new Types.ObjectId(streetLevelId.toString()) } },
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
    streetLevelId: new Types.ObjectId(streetLevelId.toString()) 
  }).then((buildings: Types.ObjectId[]) => buildings.length);
  
  return { aggregatedStats, buildingCount };
});

// Create and export the model
export const Review = model<IReview, IReviewModel>('Review', ReviewSchema);
export default Review;
