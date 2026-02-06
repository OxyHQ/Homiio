/**
 * Property Schema
 * Mongoose schema for Property model
 * Uses shared types from @homiio/shared-types
 */

const mongoose = require('mongoose');
const validator = require('validator');
const { transformAddressFields } = require('../../utils/helpers');
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
    default: 'EUR'
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

const propertySchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: function(this: any) { return !this.isExternal; },
    // When external, this can be null/undefined
  },
  // External sourcing metadata
  source: {
    type: String,
    default: 'internal',
    index: true
  },
  sourceId: {
    type: String,
    index: true,
    sparse: true,
    maxlength: [200, 'Source ID cannot exceed 200 characters']
  },
  sourceUrl: {
    type: String,
    validate: {
      validator: validator.isURL,
      message: 'Invalid source URL'
    }
  },
  isExternal: {
    type: Boolean,
    default: false,
    index: true
  },
  expiresAt: {
    type: Date,
    index: { expireAfterSeconds: 0 }, // TTL index; document auto-removed after this date
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  addressId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  showAddressNumber: {
    type: Boolean,
    default: true
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
    enum: ['furnished', 'unfurnished', 'partially_furnished', 'not_specified'],
    default: 'not_specified'
  },
  petPolicy: {
    type: String,
    enum: ['allowed', 'not_allowed', 'case_by_case', 'not_specified'],
    default: 'not_specified'
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
  lastSaved: {
    type: Date,
    default: Date.now
  },
  // Parent property reference (for rooms)
  parentPropertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    // Only required for rooms that are part of a larger property
    required: function(this: any) { return this.type === PropertyType.ROOM; }
  },
  status: {
    type: String,
    enum: Object.values(PropertyStatus),
    default: PropertyStatus.DRAFT
  },
  // Verification and sustainability flags
  isVerified: {
    type: Boolean,
    
    default: false
  },
  isEcoFriendly: {
    type: Boolean,
    default: false
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
      
      // Apply address field transformation
      transformAddressFields(ret);
      
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Apply address field transformation (used by lean queries)
      transformAddressFields(ret);
      
      return ret;
    }
  }
});

// Indexes for better query performance
propertySchema.index({ profileId: 1, status: 1 });
propertySchema.index({ profileId: 1, createdAt: -1 }); // User's property list queries
propertySchema.index({ addressId: 1 });
propertySchema.index({ type: 1, 'availability.isAvailable': 1 });
propertySchema.index({ status: 1, 'availability.isAvailable': 1 }); // Search queries
propertySchema.index({ 'rent.amount': 1 });
propertySchema.index({ bedrooms: 1, bathrooms: 1 });
propertySchema.index({ amenities: 1 });
propertySchema.index({ createdAt: -1 });
// Prevent duplicate external listings by (source, sourceId)
propertySchema.index({ source: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } });
// Text index for search functionality across multiple fields
propertySchema.index({
  title: 'text',
  description: 'text'
});

// Virtual for full address (requires population)
propertySchema.virtual('fullAddress').get(function() {
  const address = this.address || this.addressId;
  if (address && address.street) {
    return `${address.street}, ${address.city}, ${address.state} ${address.zipCode}`;
  }
  return null;
});

// Virtual for location string (requires population)
propertySchema.virtual('location').get(function() {
  const address = this.address || this.addressId;
  if (address && address.city) {
    const parts = [];
    if (address.city) parts.push(address.city);
    if (address.state) parts.push(address.state);
    if (address.country && address.country !== 'USA') parts.push(address.country);
    return parts.join(', ');
  }
  return null;
});

// Virtual for primary image
propertySchema.virtual('primaryImage').get(function() {
  const primary = this.images.find(img => img.isPrimary);
  return primary || this.images[0] || null;
});

// Post-query hook for lean queries — only transform when addressId is populated as object
propertySchema.post(['find', 'findOne'], function(docs) {
  if (!docs) return;
  if (Array.isArray(docs)) {
    for (const doc of docs) {
      if (doc && doc.addressId && typeof doc.addressId === 'object') {
        transformAddressFields(doc);
      }
    }
  } else if (docs.addressId && typeof docs.addressId === 'object') {
    transformAddressFields(docs);
  }
});

// Pre-save middleware
propertySchema.pre('save', function(next) {
  // Auto-set/refresh expiresAt for external listings (default 30 days or env override)
  if (this.isExternal) {
    const days = parseInt(process.env.EXTERNAL_PROPERTY_TTL_DAYS || '30', 10);
    const ms = days * 24 * 60 * 60 * 1000;
    if (!this.expiresAt || (this.isModified() && this.expiresAt.getTime() < Date.now() + ms)) {
      this.expiresAt = new Date(Date.now() + ms);
    }
    // Ensure profileId is removed for external listings
    if (this.profileId) {
      this.profileId = undefined;
    }
  }

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
    status: 'published',
    ...filters 
  };
  return this.find(query);
};

propertySchema.statics.search = async function(searchParams) {
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

  const query: any = {};

  if (available) {
    query['availability.isAvailable'] = true;
    query.status = 'published';
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

  // If city or state filters are provided, we need to find matching addresses first
  if (city || state) {
    const Address = require('./AddressSchema');
    const addressQuery: any = {};
    
    if (city) {
      addressQuery.city = new RegExp(city, 'i');
    }
    
    if (state) {
      addressQuery.state = new RegExp(state, 'i');
    }
    
    const matchingAddresses = await Address.find(addressQuery).select('_id');
    const addressIds = matchingAddresses.map(addr => addr._id);
    
    if (addressIds.length === 0) {
      return []; // No matching addresses found
    }
    
    query.addressId = { $in: addressIds };
  }

  return this.find(query).populate('addressId');
};

// Geospatial query methods
propertySchema.statics.findNearby = async function(longitude, latitude, maxDistance = 10000) {
  // First find addresses within the specified distance
  const Address = require('./AddressSchema');
  const nearbyAddresses = await Address.find({
    coordinates: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    }
  }).select('_id');

  const addressIds = nearbyAddresses.map(addr => addr._id);
  
  if (addressIds.length === 0) {
    return [];
  }

  return this.find({
    addressId: { $in: addressIds },
    'availability.isAvailable': true,
    status: 'published'
  }).populate('addressId');
};

propertySchema.statics.findWithinRadius = async function(longitude, latitude, radiusInMeters) {
  // First find addresses within the specified radius
  const Address = require('./AddressSchema');
  const nearbyAddresses = await Address.find({
    coordinates: {
      $geoWithin: {
        $centerSphere: [[longitude, latitude], radiusInMeters / 6371000] // Convert to radians
      }
    }
  }).select('_id');

  const addressIds = nearbyAddresses.map(addr => addr._id);
  
  if (addressIds.length === 0) {
    return [];
  }

  return this.find({
    addressId: { $in: addressIds },
    'availability.isAvailable': true,
    status: 'published'
  }).populate('addressId');
};

propertySchema.statics.findInPolygon = async function(coordinates) {
  // First find addresses within the specified polygon
  const Address = require('./AddressSchema');
  const addressesInPolygon = await Address.find({
    coordinates: {
      $geoWithin: {
        $geometry: {
          type: 'Polygon',
          coordinates: [coordinates]
        }
      }
    }
  }).select('_id');

  const addressIds = addressesInPolygon.map(addr => addr._id);
  
  if (addressIds.length === 0) {
    return [];
  }

  return this.find({
    addressId: { $in: addressIds },
    'availability.isAvailable': true,
    status: 'published'
  }).populate('addressId');
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
propertySchema.methods.setLocation = async function(longitude, latitude) {
  // This method now needs to update the referenced address
  if (this.addressId) {
    const Address = require('./AddressSchema');
    const address = await Address.findById(this.addressId);
    if (address) {
      address.setLocation(longitude, latitude);
      await address.save();
    }
  }
  return this;
};

propertySchema.methods.getCoordinates = function() {
  // This method requires the address to be populated
  const address = this.address || this.addressId;
  if (address && address.coordinates && address.coordinates.coordinates && address.coordinates.coordinates.length === 2) {
    return {
      longitude: address.coordinates.coordinates[0],
      latitude: address.coordinates.coordinates[1]
    };
  }
  return null;
};

module.exports = mongoose.model('Property', propertySchema);
