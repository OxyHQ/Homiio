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
  LeaseDuration,
  RentMode,
  AvailabilityWindowStatus,
  CancellationPolicy,
  ListingIntent,
  ExchangeMode
} = require('@homiio/shared-types');

/**
 * Back-compat: every listing predating the multi-intent model has no stored
 * `intents`. Surface those (and any empty array) as rent-only so the field is
 * always present and meaningful on every read path (lean queries, toJSON,
 * toObject). Mutates the passed plain object in place.
 */
function normalizeIntents(ret: any): void {
  if (ret && (!Array.isArray(ret.intents) || ret.intents.length === 0)) {
    ret.intents = [ListingIntent.RENT];
  }
}

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

// Half-open calendar windows for vacation/short-term listings.
// Stored on Property.availabilityWindows. Empty array = always available.
const availabilityWindowSchema = new mongoose.Schema({
  start: {
    type: Date,
    required: [true, 'Availability window start is required']
  },
  end: {
    type: Date,
    required: [true, 'Availability window end is required'],
    validate: {
      validator: function(this: any, value: Date) {
        return value instanceof Date && value > this.start;
      },
      message: 'Availability window end must be after start'
    }
  },
  status: {
    type: String,
    enum: Object.values(AvailabilityWindowStatus),
    required: true,
    default: AvailabilityWindowStatus.AVAILABLE
  }
}, { _id: false });

// Vacation-mode fee breakdown.
const priceBreakdownSchema = new mongoose.Schema({
  cleaningFee: {
    type: Number,
    min: [0, 'Cleaning fee cannot be negative']
  },
  serviceFee: {
    type: Number,
    min: [0, 'Service fee cannot be negative']
  },
  taxesPercent: {
    type: Number,
    min: [0, 'Taxes percent cannot be negative'],
    max: [100, 'Taxes percent cannot exceed 100']
  }
}, { _id: false });

// Sale pricing for listings carrying the SALE intent (buy flow).
const saleSchema = new mongoose.Schema({
  price: {
    type: Number,
    min: [0, 'Sale price cannot be negative']
  },
  currency: {
    type: String,
    uppercase: true,
    // Same currency set as `rentSchema.currency` so rent/sale codes stay
    // consistent. Note 'FAIR' is 4 chars, so no minlength/maxlength constraint
    // (a length cap would wrongly reject 'FAIR' which rent accepts).
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'FAIR']
  },
  pricePerSqm: {
    type: Number,
    min: [0, 'Price per square metre cannot be negative']
  },
  estimatedYield: {
    type: Number,
    min: [0, 'Estimated yield cannot be negative']
  },
  isPriceReduced: {
    type: Boolean,
    default: false
  },
  chainStatus: {
    type: String,
    enum: ['no_chain', 'chain', 'unknown']
  }
}, { _id: false });

// Home-exchange offer for listings carrying the EXCHANGE intent (swap / hosting).
// Reuses availabilityWindowSchema so exchange calendars match vacation calendars.
const exchangeSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: Object.values(ExchangeMode)
  },
  availabilityWindows: {
    type: [availabilityWindowSchema],
    default: []
  },
  minStay: {
    type: Number,
    min: [1, 'Minimum stay must be at least 1 night']
  },
  maxStay: {
    type: Number,
    min: [1, 'Maximum stay must be at least 1 night']
  },
  welcomeNote: {
    type: String,
    trim: true,
    maxlength: [2000, 'Welcome note cannot exceed 2000 characters']
  },
  languages: [{
    type: String,
    trim: true
  }],
  mealsIncluded: {
    type: Boolean,
    default: false
  },
  requiresReciprocity: {
    type: Boolean,
    default: false
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
    // Not unconditionally required: a listing that does NOT carry the RENT
    // intent (sale-only or exchange-only) may legitimately omit the rent block.
    // The `hasTransactablePrice` path validator below still guarantees the
    // listing is transactable via its sale price / exchange offer.
    required: function(this: any) {
      const intents = Array.isArray(this.intents) ? this.intents : [];
      // Empty/missing intents read as rent-only (back-compat) → rent required.
      if (intents.length === 0) return true;
      return intents.includes(ListingIntent.RENT);
    }
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
  // ---- Hybrid rental (long-term + vacation) fields ----
  rentMode: {
    type: String,
    enum: Object.values(RentMode),
    default: RentMode.LONG_TERM,
    index: true
  },
  availabilityWindows: {
    type: [availabilityWindowSchema],
    default: []
  },
  minStay: {
    type: Number,
    min: [1, 'Minimum stay must be at least 1 night']
  },
  maxStay: {
    type: Number,
    min: [1, 'Maximum stay must be at least 1 night']
  },
  cancellationPolicy: {
    type: String,
    enum: Object.values(CancellationPolicy)
  },
  instantBook: {
    type: Boolean,
    default: false
  },
  priceBreakdown: {
    type: priceBreakdownSchema,
    default: undefined
  },
  // ---- Multi-intent platform (rent / sale / exchange) ----
  // A listing may carry several intents at once; empty/missing reads as rent-only.
  intents: {
    type: [{ type: String, enum: Object.values(ListingIntent) }],
    default: [ListingIntent.RENT]
  },
  sale: {
    type: saleSchema,
    default: undefined
  },
  exchange: {
    type: exchangeSchema,
    default: undefined
  },
  // ----------------------------------------------------
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

      // Back-compat: legacy listings predate `intents`; surface them as rent-only.
      normalizeIntents(ret);

      // Apply address field transformation
      transformAddressFields(ret);

      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function(doc, ret) {
      // Back-compat: legacy listings predate `intents`; surface them as rent-only.
      normalizeIntents(ret);

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
// ---- Hybrid rental indexes ----
// Mode-aware feed queries: list properties for a given rent mode, city and status.
// addressId is denormalized into a separate join, so the cheapest compound that
// still scopes the listing feed is (rentMode, status, type).
propertySchema.index({ rentMode: 1, status: 1, type: 1 });
// Calendar range queries: find listings with windows overlapping a request range.
propertySchema.index({ 'availabilityWindows.start': 1 });
propertySchema.index({ 'availabilityWindows.end': 1 });
// Vacation feed sort: highlight instant-book listings.
propertySchema.index({ rentMode: 1, instantBook: 1, status: 1 });
// ---- Multi-intent indexes (rent / sale / exchange) ----
// Intent-scoped feed queries (intents is an array; the index matches membership).
propertySchema.index({ intents: 1, status: 1 });
// Sale price range filtering and salePrice sort.
propertySchema.index({ 'sale.price': 1 });
// Exchange feed queries scoped by intent + exchange mode + status.
propertySchema.index({ intents: 1, 'exchange.mode': 1, status: 1 });

/**
 * A listing is valid when at least one of its declared intents can actually be
 * fulfilled:
 *  - RENT: a positive `rent.amount`,
 *  - SALE: the SALE intent + a positive `sale.price`,
 *  - EXCHANGE: the EXCHANGE intent + a valid `exchange.mode` (a swap/hosting
 *    offer carries no price — its "value" is the exchange itself).
 *
 * This keeps the `rent` field present (so downstream `property.rent` access
 * never throws) while letting sale-only and exchange-only listings skip a
 * meaningful rent. Legacy rent docs (rent > 0) always pass.
 */
function hasTransactablePrice(this: any): boolean {
  const rentAmount = this.rent?.amount;
  if (typeof rentAmount === 'number' && rentAmount > 0) {
    return true;
  }
  const intents = Array.isArray(this.intents) ? this.intents : [];
  const salePrice = this.sale?.price;
  if (intents.includes(ListingIntent.SALE) && typeof salePrice === 'number' && salePrice > 0) {
    return true;
  }
  const exchangeMode = this.exchange?.mode;
  return (
    intents.includes(ListingIntent.EXCHANGE) &&
    typeof exchangeMode === 'string' &&
    Object.values(ExchangeMode).includes(exchangeMode)
  );
}

propertySchema.path('rent').validate(
  hasTransactablePrice,
  'A listing must be transactable: a rent amount, a sale price (sale listings), or an exchange mode (exchange listings)'
);

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

// Post-query hook for lean queries: lean() bypasses the toJSON/toObject
// transforms, so normalize intents (back-compat) and the address shape here so
// every read path is consistent. Address transform only runs when populated.
propertySchema.post(['find', 'findOne'], function(docs) {
  if (!docs) return;
  const apply = (doc: any) => {
    if (!doc) return;
    normalizeIntents(doc);
    if (doc.addressId && typeof doc.addressId === 'object') {
      transformAddressFields(doc);
    }
  };
  if (Array.isArray(docs)) {
    for (const doc of docs) apply(doc);
  } else {
    apply(docs);
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
