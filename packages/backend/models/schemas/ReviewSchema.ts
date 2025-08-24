/**
 * Review Schema - Mongoose version
 * Comprehensive address review schema with all required fields
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// Enums for multiple choice fields
const TemperatureRating = {
  VERY_COLD: 'very_cold',
  COLD: 'cold',
  COMFORTABLE: 'comfortable',
  WARM: 'warm',
  VERY_WARM: 'very_warm'
};

const NoiseLevel = {
  VERY_QUIET: 'very_quiet',
  QUIET: 'quiet',
  MODERATE: 'moderate',
  LOUD: 'loud',
  VERY_LOUD: 'very_loud'
};

const LightLevel = {
  VERY_DARK: 'very_dark',
  DARK: 'dark',
  ADEQUATE: 'adequate',
  BRIGHT: 'bright',
  VERY_BRIGHT: 'very_bright'
};

const ConditionRating = {
  VERY_POOR: 'very_poor',
  POOR: 'poor',
  FAIR: 'fair',
  GOOD: 'good',
  EXCELLENT: 'excellent'
};

const LandlordTreatment = {
  VERY_POOR: 'very_poor',
  POOR: 'poor',
  FAIR: 'fair',
  GOOD: 'good',
  EXCELLENT: 'excellent'
};

const ResponseRating = {
  NEVER_RESPONDED: 'never_responded',
  VERY_SLOW: 'very_slow',
  SLOW: 'slow',
  REASONABLE: 'reasonable',
  FAST: 'fast',
  VERY_FAST: 'very_fast'
};

const NeighborRating = {
  VERY_UNFRIENDLY: 'very_unfriendly',
  UNFRIENDLY: 'unfriendly',
  NEUTRAL: 'neutral',
  FRIENDLY: 'friendly',
  VERY_FRIENDLY: 'very_friendly'
};

const NeighborRelations = {
  VERY_POOR: 'very_poor',
  POOR: 'poor',
  FAIR: 'fair',
  GOOD: 'good',
  EXCELLENT: 'excellent'
};

const CleaningRating = {
  VERY_DIRTY: 'very_dirty',
  DIRTY: 'dirty',
  ACCEPTABLE: 'acceptable',
  CLEAN: 'clean',
  VERY_CLEAN: 'very_clean'
};

const TouristLevel = {
  NONE: 'none',
  FEW: 'few',
  MODERATE: 'moderate',
  MANY: 'many',
  OVERWHELMING: 'overwhelming'
};

const SecurityLevel = {
  VERY_UNSAFE: 'very_unsafe',
  UNSAFE: 'unsafe',
  NEUTRAL: 'neutral',
  SAFE: 'safe',
  VERY_SAFE: 'very_safe'
};

const ServiceType = {
  INTERNET: 'internet',
  CABLE_TV: 'cable_tv',
  PARKING: 'parking',
  LAUNDRY: 'laundry',
  GYM: 'gym',
  POOL: 'pool',
  CONCIERGE: 'concierge',
  SECURITY: 'security',
  MAINTENANCE: 'maintenance',
  CLEANING: 'cleaning'
};

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
      validator: function(value) {
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
      validator: function(url) {
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
    required: [true, 'Area security rating is required']
  },
  
  // Metadata
  profileId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
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

// Virtual for human-readable duration
ReviewSchema.virtual('humanDuration').get(function() {
  if (!this.livedForMonths) return 'Unknown duration';
  
  const years = Math.floor(this.livedForMonths / 12);
  const remainingMonths = this.livedForMonths % 12;
  
  if (years === 0) {
    return `${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
  }
  if (remainingMonths === 0) {
    return `${years} year${years !== 1 ? 's' : ''}`;
  }
  return `${years} year${years !== 1 ? 's' : ''} ${remainingMonths} month${remainingMonths !== 1 ? 's' : ''}`;
});

// Pre-save middleware to calculate lived duration
ReviewSchema.pre('save', function(next) {
  if (this.livedFrom && this.livedTo) {
    const diffTime = Math.abs(this.livedTo.getTime() - this.livedFrom.getTime());
    const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30.44)); // Average month length
    this.livedForMonths = diffMonths;
  }
  next();
});

// Static methods
ReviewSchema.statics.findByAddress = function(addressId) {
  return this.find({ addressId })
    .populate('profileId', 'profileType personalProfile agencyProfile')
    .sort({ createdAt: -1 });
};

ReviewSchema.statics.getAverageRating = function(addressId) {
  return this.aggregate([
    { $match: { addressId: new mongoose.Types.ObjectId(addressId.toString()) } },
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

// Indexes for performance
ReviewSchema.index({ addressId: 1, createdAt: -1 });
ReviewSchema.index({ profileId: 1, createdAt: -1 });
ReviewSchema.index({ rating: 1 });
ReviewSchema.index({ recommendation: 1 });

module.exports = mongoose.model('Review', ReviewSchema);
