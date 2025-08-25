/**
 * Review Model
 * Comprehensive address review schema with all required fields
 */

import { Schema, model, Document, Types, Model } from 'mongoose';

// Enums for multiple choice fields
export enum TemperatureRating {
  VERY_COLD = 'very_cold',
  COLD = 'cold',
  MODERATE = 'moderate',
  WARM = 'warm',
  VERY_WARM = 'very_warm'
}

export enum NoiseLevel {
  VERY_QUIET = 'very_quiet',
  QUIET = 'quiet',
  MODERATE = 'moderate',
  NOISY = 'noisy',
  VERY_NOISY = 'very_noisy'
}

export enum LightLevel {
  VERY_DARK = 'very_dark',
  DARK = 'dark',
  MODERATE = 'moderate',
  BRIGHT = 'bright',
  VERY_BRIGHT = 'very_bright'
}

export enum ConditionRating {
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  VERY_GOOD = 'very_good',
  EXCELLENT = 'excellent'
}

export enum LandlordTreatment {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum ResponseRating {
  NEVER_RESPONDED = 'never_responded',
  VERY_SLOW = 'very_slow',
  SLOW = 'slow',
  REASONABLE = 'reasonable',
  FAST = 'fast',
  VERY_FAST = 'very_fast'
}

export enum NeighborRating {
  VERY_UNFRIENDLY = 'very_unfriendly',
  UNFRIENDLY = 'unfriendly',
  NEUTRAL = 'neutral',
  FRIENDLY = 'friendly',
  VERY_FRIENDLY = 'very_friendly'
}

export enum NeighborRelations {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum CleaningRating {
  VERY_DIRTY = 'very_dirty',
  DIRTY = 'dirty',
  ACCEPTABLE = 'acceptable',
  CLEAN = 'clean',
  VERY_CLEAN = 'very_clean'
}

export enum TouristLevel {
  NONE = 'none',
  FEW = 'few',
  MODERATE = 'moderate',
  MANY = 'many',
  OVERWHELMING = 'overwhelming'
}

export enum SecurityLevel {
  VERY_UNSAFE = 'very_unsafe',
  UNSAFE = 'unsafe',
  NEUTRAL = 'neutral',
  SAFE = 'safe',
  VERY_SAFE = 'very_safe'
}

export enum ServiceType {
  INTERNET = 'internet',
  CABLE_TV = 'cable_tv',
  PARKING = 'parking',
  LAUNDRY = 'laundry',
  GYM = 'gym',
  POOL = 'pool',
  CONCIERGE = 'concierge',
  SECURITY = 'security',
  MAINTENANCE = 'maintenance',
  CLEANING = 'cleaning'
}

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
  profileId: Types.ObjectId; // User profile reference
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
}

// Define static methods interface
export interface IReviewModel extends Model<IReview> {
  // Hierarchical finder methods
  findByStreetLevel(streetLevelId: string | Types.ObjectId): Promise<IReview[]>;
  findByBuildingLevel(buildingLevelId: string | Types.ObjectId): Promise<IReview[]>;
  findByUnitLevel(unitLevelId: string | Types.ObjectId): Promise<IReview[]>;
  
  // Aggregation methods for hierarchical views
  getUnitViewData(unitLevelId: string | Types.ObjectId): Promise<{
    unitReviews: IReview[];
    buildingSummary: {
      averageRating: number;
      totalReviews: number;
      recommendationPercentage: number;
    };
  }>;
  
  getBuildingViewData(buildingLevelId: string | Types.ObjectId): Promise<{
    buildingReviews: IReview[];
    unitReviews: IReview[];
    aggregatedStats: {
      averageRating: number;
      totalReviews: number;
      recommendationPercentage: number;
    };
  }>;
  
  getStreetViewData(streetLevelId: string | Types.ObjectId): Promise<{
    aggregatedStats: {
      averageRating: number;
      totalReviews: number;
      recommendationPercentage: number;
    };
    buildingCount: number;
  }>;
}

const ReviewSchema = new Schema({
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
  profileId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile', // Changed from 'User' to 'Profile'
    required: [true, 'Profile ID is required'],
    index: true
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
ReviewSchema.index({ profileId: 1, createdAt: -1 });
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
ReviewSchema.statics.findByStreetLevel = function(streetLevelId: string | Types.ObjectId) {
  return this.find({ streetLevelId })
    .populate('profileId', 'name avatar') // Changed from userId to profileId
    .sort({ createdAt: -1 });
};

ReviewSchema.statics.findByBuildingLevel = function(buildingLevelId: string | Types.ObjectId) {
  return this.find({ buildingLevelId })
    .populate('profileId', 'name avatar') // Changed from userId to profileId
    .sort({ createdAt: -1 });
};

ReviewSchema.statics.findByUnitLevel = function(unitLevelId: string | Types.ObjectId) {
  return this.find({ unitLevelId })
    .populate('profileId', 'name avatar') // Changed from userId to profileId
    .sort({ createdAt: -1 });
};

// UNIT view: own reviews + building summary
ReviewSchema.statics.getUnitViewData = async function(this: IReviewModel, unitLevelId: string | Types.ObjectId) {
  const unitReviews = await this.findByUnitLevel(unitLevelId);
  
  // Get the building level from one of the unit reviews
  const sampleReview = await this.findOne({ unitLevelId });
  if (!sampleReview?.buildingLevelId) {
    return {
      unitReviews,
      buildingSummary: { averageRating: 0, totalReviews: 0, recommendationPercentage: 0 }
    };
  }
  
  const buildingSummary = await this.aggregate([
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
  ]).then(result => result.length > 0 ? result[0] : {
    averageRating: 0,
    totalReviews: 0,
    recommendationPercentage: 0
  });
  
  return { unitReviews, buildingSummary };
};

// BUILDING view: building reviews + all unit reviews
ReviewSchema.statics.getBuildingViewData = async function(this: IReviewModel, buildingLevelId: string | Types.ObjectId) {
  const buildingReviews = await this.find({ 
    buildingLevelId, 
    addressLevel: 'BUILDING' 
  }).populate('profileId', 'name avatar').sort({ createdAt: -1 }); // Changed from userId to profileId
  
  const unitReviews = await this.find({ 
    buildingLevelId, 
    addressLevel: 'UNIT' 
  }).populate('profileId', 'name avatar').sort({ createdAt: -1 }); // Changed from userId to profileId
  
  const aggregatedStats = await this.aggregate([
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
  ]).then(result => result.length > 0 ? result[0] : {
    averageRating: 0,
    totalReviews: 0,
    recommendationPercentage: 0
  });
  
  return { buildingReviews, unitReviews, aggregatedStats };
};

// STREET view: aggregates all building reviews
ReviewSchema.statics.getStreetViewData = async function(this: IReviewModel, streetLevelId: string | Types.ObjectId) {
  const aggregatedStats = await this.aggregate([
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
  ]).then(result => result.length > 0 ? result[0] : {
    averageRating: 0,
    totalReviews: 0,
    recommendationPercentage: 0
  });
  
  const buildingCount = await this.distinct('buildingLevelId', { 
    streetLevelId: new Types.ObjectId(streetLevelId.toString()) 
  }).then(buildings => buildings.length);
  
  return { aggregatedStats, buildingCount };
};

// Create and export the model
export const Review = model<IReview, IReviewModel>('Review', ReviewSchema);
export default Review;
