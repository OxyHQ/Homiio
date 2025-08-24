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
  // Basic Information
  addressId: Types.ObjectId;
  address: string;
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
  userId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  verified: boolean;
}

// Define static methods interface
export interface IReviewModel extends Model<IReview> {
  findByAddress(addressId: string | Types.ObjectId): Promise<IReview[]>;
  getAverageRating(addressId: string | Types.ObjectId): Promise<{
    averageRating: number;
    totalReviews: number;
    recommendationPercentage: number;
  }>;
}

const ReviewSchema = new Schema({
  // Basic Information
  addressId: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    required: [true, 'Address ID is required'],
    index: true
  },
  address: {
    type: String,
    required: [true, 'Address text is required'],
    trim: true,
    maxlength: [500, 'Address cannot exceed 500 characters']
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
  
  // Environmental Conditions
  summerTemperature: {
    type: String,
    enum: Object.values(TemperatureRating),
    required: [true, 'Summer temperature rating is required']
  },
  winterTemperature: {
    type: String,
    enum: Object.values(TemperatureRating),
    required: [true, 'Winter temperature rating is required']
  },
  noise: {
    type: String,
    enum: Object.values(NoiseLevel),
    required: [true, 'Noise level rating is required']
  },
  light: {
    type: String,
    enum: Object.values(LightLevel),
    required: [true, 'Light level rating is required']
  },
  conditionAndMaintenance: {
    type: String,
    enum: Object.values(ConditionRating),
    required: [true, 'Condition and maintenance rating is required']
  },
  services: [{
    type: String,
    enum: Object.values(ServiceType)
  }],
  
  // Management
  landlordTreatment: {
    type: String,
    enum: Object.values(LandlordTreatment),
    required: [true, 'Landlord treatment rating is required']
  },
  problemResponse: {
    type: String,
    enum: Object.values(ResponseRating),
    required: [true, 'Problem response rating is required']
  },
  depositReturned: {
    type: Boolean,
    required: [true, 'Deposit return status is required']
  },
  
  // Neighbors / Community
  staircaseNeighbors: {
    type: String,
    enum: Object.values(NeighborRating),
    required: [true, 'Staircase/neighbors rating is required']
  },
  touristApartments: {
    type: Boolean,
    required: [true, 'Tourist apartments status is required']
  },
  neighborRelations: {
    type: String,
    enum: Object.values(NeighborRelations),
    required: [true, 'Neighbor relations rating is required']
  },
  cleaning: {
    type: String,
    enum: Object.values(CleaningRating),
    required: [true, 'Cleaning rating is required']
  },
  
  // Area (300m radius)
  areaTourists: {
    type: String,
    enum: Object.values(TouristLevel),
    required: [true, 'Area tourists level is required']
  },
  areaSecurity: {
    type: String,
    enum: Object.values(SecurityLevel),
    required: [true, 'Area security level is required']
  },
  
  // Metadata
  userId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required'],
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
ReviewSchema.index({ userId: 1, createdAt: -1 });
ReviewSchema.index({ rating: -1 });
ReviewSchema.index({ recommendation: 1 });
ReviewSchema.index({ verified: 1 });

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
ReviewSchema.statics.findByAddress = function(addressId: string | Types.ObjectId) {
  return this.find({ addressId })
    .populate('userId', 'name avatar')
    .sort({ createdAt: -1 });
};

ReviewSchema.statics.getAverageRating = function(addressId: string | Types.ObjectId) {
  return this.aggregate([
    { $match: { addressId: new Types.ObjectId(addressId.toString()) } },
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
};

// Create and export the model
export const Review = model<IReview, IReviewModel>('Review', ReviewSchema);
export default Review;
