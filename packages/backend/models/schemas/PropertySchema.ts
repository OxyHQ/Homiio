/**
 * Property Schema
 * Mongoose schema for Property model
 * Uses shared types from @homiio/shared-types
 */

const mongoose = require('mongoose');
const validator = require('validator');
const { 
  PropertyType, 
  PropertyStatus, 
  HousingType, 
  LayoutType, 
  PaymentFrequency, 
  UtilitiesIncluded, 
  PriceUnit,
  LeaseDuration
} = require('@homiio/shared-types');

const addressSchema = new mongoose.Schema({
  street: {
    type: String,
    required: [true, 'Street address is required'],
    trim: true,
    maxlength: [200, 'Street address cannot exceed 200 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [100, 'City name cannot exceed 100 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [50, 'State name cannot exceed 50 characters']
  },
  zipCode: {
    type: String,
    required: [true, 'ZIP code is required'],
    trim: true,
    validate: {
      validator: function(v) {
        return /^\d{5}(-\d{4})?$/.test(v);
      },
      message: 'ZIP code must be in format 12345 or 12345-6789'
    }
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    default: 'USA',
    maxlength: [50, 'Country name cannot exceed 50 characters']
  },
  coordinates: {
    lat: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    lng: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    }
  }
}, { _id: false });

const rentSchema = new mongoose.Schema({
  amount: {
    type: Number,
    required: [true, 'Rent amount is required'],
    min: [0, 'Rent amount must be positive']
  },
  currency: {
    type: String,
    required: true,
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'],
    default: 'USD'
  },
  paymentFrequency: {
    type: String,
    enum: Object.values(PaymentFrequency),
    default: PaymentFrequency.MONTHLY
  },
  deposit: {
    type: Number,
    min: [0, 'Deposit must be positive'],
    default: 0
  },
  utilities: {
    type: String,
    enum: Object.values(UtilitiesIncluded),
    default: UtilitiesIncluded.EXCLUDED
  },
  hasIncomeBasedPricing: {
    type: Boolean,
    default: false
  },
  hasSlidingScale: {
    type: Boolean,
    default: false
  },
  hasUtilitiesIncluded: {
    type: Boolean,
    default: false
  },
  hasReducedDeposit: {
    type: Boolean,
    default: false
  }
}, { _id: false });

const rulesSchema = new mongoose.Schema({
  pets: {
    type: Boolean,
    default: false
  },
  smoking: {
    type: Boolean,
    default: false
  },
  parties: {
    type: Boolean,
    default: false
  },
  guests: {
    type: Boolean,
    default: true
  },
  maxOccupancy: {
    type: Number,
    min: [1, 'Maximum occupancy must be at least 1'],
    default: 1
  }
}, { _id: false });

const availabilitySchema = new mongoose.Schema({
  isAvailable: {
    type: Boolean,
    default: true
  },
  availableFrom: {
    type: Date,
    default: Date.now
  },
  minimumStay: {
    type: Number,
    min: [1, 'Minimum stay must be at least 1 month'],
    default: 1
  },
  maximumStay: {
    type: Number,
    min: [1, 'Maximum stay must be at least 1 month'],
    default: 12
  }
}, { _id: false });

const energyMonitoringSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  sensors: [{
    type: String,
    trim: true
  }]
}, { _id: false });

const propertySchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Profile ID is required']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  address: {
    type: addressSchema,
    required: true
  },
  type: {
    type: String,
    required: true,
    enum: Object.values(PropertyType),
    default: PropertyType.APARTMENT
  },
  housingType: {
    type: String,
    enum: Object.values(HousingType),
    default: HousingType.PRIVATE
  },
  layoutType: {
    type: String,
    enum: Object.values(LayoutType),
    default: LayoutType.TRADITIONAL
  },
  bedrooms: {
    type: Number,
    min: [0, 'Bedrooms cannot be negative'],
    default: 0
  },
  bathrooms: {
    type: Number,
    min: [0, 'Bathrooms cannot be negative'],
    default: 0
  },
  squareFootage: {
    type: Number,
    min: [0, 'Square footage cannot be negative'],
    default: 0
  },
  floor: {
    type: Number,
    min: [0, 'Floor cannot be negative'],
    default: 0
  },
  yearBuilt: {
    type: Number,
    min: [1800, 'Year built must be at least 1800'],
    max: [new Date().getFullYear(), 'Year built cannot be in the future']
  },
  hasElevator: {
    type: Boolean,
    default: false
  },
  hasBalcony: {
    type: Boolean,
    default: false
  },
  hasGarden: {
    type: Boolean,
    default: false
  },
  utilitiesIncluded: {
    type: Boolean,
    default: false
  },
  petFriendly: {
    type: Boolean,
    default: false
  },
  rent: {
    type: rentSchema,
    required: true
  },
  amenities: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  priceUnit: {
    type: String,
    enum: ['day', 'night', 'week', 'month', 'year'],
    default: 'month'
  },
  furnishedStatus: {
    type: String,
    enum: ['furnished', 'unfurnished', 'partially_furnished'],
    default: 'unfurnished'
  },
  petPolicy: {
    type: String,
    enum: ['allowed', 'not_allowed', 'case_by_case'],
    default: 'not_allowed'
  },
  petFee: {
    type: Number,
    min: [0, 'Pet fee cannot be negative'],
    default: 0
  },
  parkingType: {
    type: String,
    enum: ['none', 'street', 'assigned', 'garage'],
    default: 'none'
  },
  parkingSpaces: {
    type: Number,
    min: [0, 'Parking spaces cannot be negative'],
    default: 0
  },
  availableFrom: {
    type: Date,
    default: Date.now
  },
  leaseTerm: {
    type: String,
    enum: Object.values(LeaseDuration),
    default: LeaseDuration.MONTHLY
  },
  smokingAllowed: {
    type: Boolean,
    default: false
  },
  partiesAllowed: {
    type: Boolean,
    default: false
  },
  guestsAllowed: {
    type: Boolean,
    default: true
  },
  maxGuests: {
    type: Number,
    min: [1, 'Maximum guests must be at least 1'],
    default: 1
  },
  proximityToTransport: {
    type: Boolean,
    default: false
  },
  proximityToSchools: {
    type: Boolean,
    default: false
  },
  proximityToShopping: {
    type: Boolean,
    default: false
  },
  rules: {
    type: rulesSchema,
    default: {}
  },
  images: [{
    url: {
      type: String,
      validate: {
        validator: validator.isURL,
        message: 'Invalid image URL'
      }
    },
    caption: {
      type: String,
      maxlength: [200, 'Image caption cannot exceed 200 characters']
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  coverImageIndex: {
    type: Number,
    default: -1
  },
  documents: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    url: {
      type: String,
      required: true,
      validate: {
        validator: validator.isURL,
        message: 'Invalid document URL'
      }
    },
    type: {
      type: String,
      enum: ['lease', 'inspection', 'insurance', 'other'],
      default: 'other'
    }
  }],
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function(coords) {
          return coords.length === 2 && 
                 coords[0] >= -180 && coords[0] <= 180 && // longitude
                 coords[1] >= -90 && coords[1] <= 90;     // latitude
        },
        message: 'Coordinates must be an array [longitude, latitude] with valid ranges'
      }
    }
  },
  // Accommodation-specific details
  accommodationDetails: {
    sleepingArrangement: {
      type: String,
      enum: ['couch', 'air_mattress', 'floor', 'tent', 'hammock']
    },
    roommatePreferences: [{
      type: String,
      trim: true
    }],
    colivingFeatures: [{
      type: String,
      trim: true
    }],
    hostelRoomType: {
      type: String,
      enum: ['dormitory', 'private_room', 'mixed_dorm', 'female_dorm', 'male_dorm']
    },
    campsiteType: {
      type: String,
      enum: ['tent_site', 'rv_site', 'cabin', 'glamping', 'backcountry']
    },
    maxStay: {
      type: Number,
      min: [1, 'Maximum stay must be at least 1 day']
    },
    minAge: {
      type: Number,
      min: [18, 'Minimum age must be at least 18']
    },
    maxAge: {
      type: Number,
      min: [18, 'Maximum age must be at least 18']
    },
    languages: [{
      type: String,
      trim: true
    }],
    culturalExchange: {
      type: Boolean,
      default: false
    },
    mealsIncluded: {
      type: Boolean,
      default: false
    },
    wifiPassword: {
      type: String,
      trim: true
    },
    houseRules: [{
      type: String,
      trim: true
    }]
  },
  availability: {
    type: availabilitySchema,
    default: {}
  },
  // Draft functionality
  isDraft: {
    type: Boolean,
    default: true
  },
  lastSaved: {
    type: Date,
    default: Date.now
  },
  deviceId: {
    type: String,
    trim: true
  },
  energyMonitoring: {
    type: energyMonitoringSchema,
    default: {}
  },
  rooms: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  }],
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived'],
    default: 'active'
  },
  views: {
    type: Number,
    default: 0
  },
  rating: {
    average: {
      type: Number,
      min: 0,
      max: 5,
      default: 0
    },
    count: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for better query performance
propertySchema.index({ profileId: 1, status: 1 });
propertySchema.index({ 'address.city': 1, 'address.state': 1 });
propertySchema.index({ type: 1, 'availability.isAvailable': 1 });
propertySchema.index({ 'rent.amount': 1 });
propertySchema.index({ bedrooms: 1, bathrooms: 1 });
propertySchema.index({ amenities: 1 });
propertySchema.index({ createdAt: -1 });
// GeoJSON 2dsphere index for geospatial queries
propertySchema.index({ location: '2dsphere' });
// Text index for search functionality across multiple fields
propertySchema.index({
  title: 'text',
  description: 'text',
  'address.city': 'text',
  'address.state': 'text',
  'address.street': 'text'
});

// Virtual for full address
propertySchema.virtual('fullAddress').get(function() {
  return `${this.address.street}, ${this.address.city}, ${this.address.state} ${this.address.zipCode}`;
});

// Virtual for primary image
propertySchema.virtual('primaryImage').get(function() {
  const primary = this.images.find(img => img.isPrimary);
  return primary || this.images[0] || null;
});

// Pre-save middleware
propertySchema.pre('save', function(next) {
  // Ensure only one primary image
  if (this.isModified('images')) {
    let hasPrimary = false;
    this.images.forEach((img, index) => {
      if (img.isPrimary && !hasPrimary) {
        hasPrimary = true;
      } else if (img.isPrimary && hasPrimary) {
        img.isPrimary = false;
      }
    });

    // If no primary image is set, make the first one primary
    if (!hasPrimary && this.images.length > 0) {
      this.images[0].isPrimary = true;
    }
  }

  next();
});

// Static methods
propertySchema.statics.findByProfile = function(profileId, options = {}) {
  return this.find({ profileId, status: { $ne: 'archived' } }, null, options);
};

propertySchema.statics.findAvailable = function(filters = {}) {
  const query = { 
    'availability.isAvailable': true, 
    status: 'active',
    ...filters 
  };
  return this.find(query);
};

propertySchema.statics.search = function(searchParams) {
  const {
    city,
    state,
    type,
    minRent,
    maxRent,
    bedrooms,
    bathrooms,
    amenities,
    available = true
  } = searchParams;

  const query = {};

  if (available) {
    query['availability.isAvailable'] = true;
    query.status = 'active';
  }

  if (city) {
    query['address.city'] = new RegExp(city, 'i');
  }

  if (state) {
    query['address.state'] = new RegExp(state, 'i');
  }

  if (type) {
    query.type = type;
  }

  if (minRent !== undefined || maxRent !== undefined) {
    query['rent.amount'] = {};
    if (minRent !== undefined) query['rent.amount'].$gte = minRent;
    if (maxRent !== undefined) query['rent.amount'].$lte = maxRent;
  }

  if (bedrooms !== undefined) {
    query.bedrooms = bedrooms;
  }

  if (bathrooms !== undefined) {
    query.bathrooms = bathrooms;
  }

  if (amenities && amenities.length > 0) {
    query.amenities = { $in: amenities };
  }

  return this.find(query);
};

// Geospatial query methods
propertySchema.statics.findNearby = function(longitude, latitude, maxDistance = 10000) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    'availability.isAvailable': true,
    status: 'active'
  });
};

propertySchema.statics.findWithinRadius = function(longitude, latitude, radiusInMeters) {
  return this.find({
    location: {
      $geoWithin: {
        $centerSphere: [[longitude, latitude], radiusInMeters / 6371000] // Convert to radians
      }
    },
    'availability.isAvailable': true,
    status: 'active'
  });
};

propertySchema.statics.findInPolygon = function(coordinates) {
  return this.find({
    location: {
      $geoWithin: {
        $geometry: {
          type: 'Polygon',
          coordinates: [coordinates]
        }
      }
    },
    'availability.isAvailable': true,
    status: 'active'
  });
};

// Instance methods
propertySchema.methods.incrementViews = function() {
  this.views += 1;
  return this.save();
};

propertySchema.methods.updateRating = function(newRating) {
  const totalRating = (this.rating.average * this.rating.count) + newRating;
  this.rating.count += 1;
  this.rating.average = totalRating / this.rating.count;
  return this.save();
};

// GeoJSON helper methods
propertySchema.methods.setLocation = function(longitude, latitude) {
  this.location = {
    type: 'Point',
    coordinates: [longitude, latitude]
  };
  return this;
};

propertySchema.methods.getCoordinates = function() {
  if (this.location && this.location.coordinates && this.location.coordinates.length === 2) {
    return {
      longitude: this.location.coordinates[0],
      latitude: this.location.coordinates[1]
    };
  }
  return null;
};

module.exports = mongoose.model('Property', propertySchema);
