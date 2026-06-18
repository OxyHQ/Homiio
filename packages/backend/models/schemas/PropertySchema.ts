/**
 * Property Schema
 * Mongoose schema for Property model
 * Uses shared types from @homiio/shared-types
 */

import type { IProperty } from '../Property';

const mongoose = require('mongoose');
const validator = require('validator');
const { transformAddressFields } = require('../../utils/helpers');
const { validateOfferings } = require('./offeringValidation');
const {
  PropertyType,
  PropertyStatus,
  HousingType,
  LayoutType,
  UtilitiesIncluded,
  LeaseDuration,
  AvailabilityWindowStatus,
  CancellationPolicy,
  OfferingType,
  ExchangeMode
} = require('@homiio/shared-types');

/** Currency codes accepted on every priced block (rent / sale / exchange). */
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'];

// Monthly-rent pricing block (offering: long_term_rent). 'FAIR' is 4 chars so
// no length cap is applied — only the shared currency enum.
const longTermRentSchema = new mongoose.Schema({
  monthlyAmount: {
    type: Number,
    required: [true, 'Monthly amount is required'],
    min: [0, 'Monthly amount must be positive']
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    enum: SUPPORTED_CURRENCIES,
    default: 'EUR'
  },
  deposit: {
    type: Number,
    min: [0, 'Deposit must be positive']
  },
  applicationFee: {
    type: Number,
    min: [0, 'Application fee must be positive']
  },
  lateFee: {
    type: Number,
    min: [0, 'Late fee must be positive']
  },
  utilities: {
    type: String,
    enum: Object.values(UtilitiesIncluded)
  }
}, { _id: false });

// Per-night pricing block (offering: short_term_rent).
const shortTermRentSchema = new mongoose.Schema({
  nightlyRate: {
    type: Number,
    required: [true, 'Nightly rate is required'],
    min: [0, 'Nightly rate must be positive']
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    enum: SUPPORTED_CURRENCIES,
    default: 'EUR'
  },
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
  },
  minNights: {
    type: Number,
    min: [1, 'Minimum nights must be at least 1']
  },
  maxNights: {
    type: Number,
    min: [1, 'Maximum nights must be at least 1']
  },
  instantBook: {
    type: Boolean,
    default: false
  },
  deposit: {
    type: Number,
    min: [0, 'Deposit must be positive']
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

// Sale pricing for listings carrying the SALE offering (buy flow).
const saleSchema = new mongoose.Schema({
  price: {
    type: Number,
    min: [0, 'Sale price cannot be negative']
  },
  currency: {
    type: String,
    uppercase: true,
    // Shared 5-code currency set so rent/sale codes stay consistent. Note
    // 'FAIR' is 4 chars, so no minlength/maxlength constraint (a length cap
    // would wrongly reject 'FAIR').
    enum: SUPPORTED_CURRENCIES
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
  // Partner (agent) referral attribution — set when the listing is created
  // through a partner's referral link. `sourcedByReferralCode` is an audit copy
  // of the code captured at create time (the partner may rotate codes later).
  sourcedByPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    index: true,
    sparse: true
  },
  sourcedByReferralCode: {
    type: String,
    trim: true,
    lowercase: true
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
  // ---- Per-offering priced blocks ----
  // `offerings` is the single source of truth; the `offeringValidation` path
  // validator guarantees it equals exactly the set of present blocks, each with
  // a positive price / valid exchange mode.
  offerings: {
    type: [{ type: String, enum: Object.values(OfferingType) }],
    required: true,
    default: []
  },
  longTermRent: {
    type: longTermRentSchema,
    default: undefined
  },
  shortTermRent: {
    type: shortTermRentSchema,
    default: undefined
  },
  amenities: [{
    type: String,
    trim: true,
    lowercase: true
  }],
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
  // ---- Short-term (vacation) calendar + booking policy ----
  availabilityWindows: {
    type: [availabilityWindowSchema],
    default: []
  },
  cancellationPolicy: {
    type: String,
    enum: Object.values(CancellationPolicy)
  },
  // ---- Sale / exchange offering blocks ----
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
  // Property photos, backed by the canonical Image collection. Each entry keeps
  // the historical `{ url, caption, isPrimary }` read shape (url = the stored
  // MEDIUM variant) and references its canonical Image via `imageId`, carrying
  // the full variant `urls` for opt-in use. See `services/imageSerializer`.
  images: [{
    imageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Image'
    },
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
    },
    order: {
      type: Number,
      default: 0,
      min: [0, 'Image order cannot be negative']
    },
    // All processed variant URLs (small/medium/large/original). Optional so
    // legacy/external entries that predate the Image collection still validate.
    urls: {
      type: new mongoose.Schema({
        original: { type: String },
        small: { type: String },
        medium: { type: String },
        large: { type: String }
      }, { _id: false }),
      default: undefined
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
  },
  // Soft-delete timestamp: set when the listing is archived via deleteProperty.
  // Public list/search/geo queries exclude archived docs via `deletedAt: null`.
  deletedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
      ret.id = ret._id;

      // Apply address field transformation
      transformAddressFields(ret);

      return ret;
    }
  },
  toObject: {
    virtuals: true,
    transform: function(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
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
// ---- Per-offering indexes ----
// Offering-scoped feed queries (offerings is an array; the index matches membership).
propertySchema.index({ offerings: 1, status: 1 });
// Price-range filtering + price sort, resolved per offering.
propertySchema.index({ 'longTermRent.monthlyAmount': 1 });
propertySchema.index({ 'shortTermRent.nightlyRate': 1 });
propertySchema.index({ 'sale.price': 1 });
// Calendar range queries: find listings with windows overlapping a request range.
propertySchema.index({ 'availabilityWindows.start': 1 });
propertySchema.index({ 'availabilityWindows.end': 1 });
// Exchange feed queries scoped by offering + exchange mode + status.
propertySchema.index({ offerings: 1, 'exchange.mode': 1, status: 1 });

/**
 * Offerings must be non-empty and equal exactly the set of present priced
 * blocks (long_term_rent↔longTermRent, short_term_rent↔shortTermRent,
 * sale↔sale, exchange↔exchange), each with a positive price / valid exchange
 * mode. The rule lives once in `offeringValidation` so it can't drift between
 * the schema and the controllers. Attached to `offerings` so it runs on save
 * and on `findOneAndUpdate` with `runValidators`.
 */
propertySchema.path('offerings').validate({
  validator: function(this: IProperty): boolean {
    // Only the document context exposes every block as `this.*`. Update
    // validators (findOneAndUpdate + runValidators) run with a Query `this`
    // where sibling blocks are not visible, which would wrongly reject a
    // partial edit — the update controller's `applyOfferingRulesForUpdate`
    // already enforces full coherence there, so skip when not a document.
    if (typeof (this as { isModified?: unknown }).isModified !== 'function') {
      return true;
    }
    return validateOfferings(this) === null;
  },
  message: 'offerings must be non-empty and match exactly the present priced blocks, each with a positive price'
});

// Helper: read a geo ref's name when the ref is DEEP-populated (id form yields
// null — names are relational and live on the Country/Region/City docs).
const geoRefName = (ref: unknown): string | null =>
  ref && typeof ref === 'object' && typeof (ref as { name?: unknown }).name === 'string'
    ? (ref as { name: string }).name
    : null;

interface PopulatedAddressLike {
  street?: string;
  postal_code?: string;
  cityId?: unknown;
  regionId?: unknown;
  countryId?: unknown;
}

interface PropertyImageLike {
  url: string;
  isPrimary?: boolean;
  [key: string]: unknown;
}

// Virtual for full address. Requires the address to be populated, and its
// city/region/country to be DEEP-populated for the names (geo is relational).
propertySchema.virtual('fullAddress').get(function(this: IProperty): string | null {
  const address = (this.address || this.addressId) as PopulatedAddressLike | undefined;
  if (!address || !address.street) return null;
  const parts: string[] = [address.street];
  const city = geoRefName(address.cityId);
  const region = geoRefName(address.regionId);
  if (city) parts.push(city);
  const regionPostal = [region, address.postal_code].filter(Boolean).join(' ').trim();
  if (regionPostal) parts.push(regionPostal);
  return parts.join(', ');
});

// Virtual for location string. Same deep-population requirement for names.
propertySchema.virtual('location').get(function(this: IProperty): string | null {
  const address = (this.address || this.addressId) as PopulatedAddressLike | undefined;
  if (!address) return null;
  const parts: string[] = [];
  const city = geoRefName(address.cityId);
  const region = geoRefName(address.regionId);
  const country = geoRefName(address.countryId);
  if (city) parts.push(city);
  if (region) parts.push(region);
  if (country) parts.push(country);
  return parts.length > 0 ? parts.join(', ') : null;
});

// Virtual for primary image
propertySchema.virtual('primaryImage').get(function(this: IProperty): PropertyImageLike | null {
  const images = (this.images || []) as PropertyImageLike[];
  const primary = images.find((img) => img.isPrimary);
  return primary || images[0] || null;
});

// Post-query hook for lean queries: lean() bypasses the toJSON/toObject
// transforms, so normalize the address shape here so every read path is
// consistent. Address transform only runs when the address is populated.
propertySchema.post(['find', 'findOne'], function(docs: unknown): void {
  if (!docs) return;
  const apply = (doc: unknown): void => {
    if (!doc || typeof doc !== 'object') return;
    const candidate = doc as { addressId?: unknown };
    if (candidate.addressId && typeof candidate.addressId === 'object') {
      transformAddressFields(doc as Record<string, unknown>);
    }
  };
  if (Array.isArray(docs)) {
    for (const doc of docs) apply(doc);
  } else {
    apply(docs);
  }
});

// Pre-save middleware
propertySchema.pre('save', function(this: IProperty, next: (err?: Error) => void): void {
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
    const images = (this.images || []) as PropertyImageLike[];
    let hasPrimary = false;
    images.forEach((img) => {
      if (img.isPrimary && !hasPrimary) {
        hasPrimary = true;
      } else if (img.isPrimary && hasPrimary) {
        img.isPrimary = false;
      }
    });

    // If no primary image is set, make the first one primary
    if (!hasPrimary && images.length > 0) {
      images[0].isPrimary = true;
    }
  }

  next();
});

// Static methods
type ObjectIdLike = string | { toString(): string };

propertySchema.statics.findByProfile = function(
  profileId: ObjectIdLike,
  options: Record<string, unknown> = {}
) {
  return this.find({ profileId, status: { $ne: 'archived' } }, null, options);
};

propertySchema.statics.findAvailable = function(filters: Record<string, unknown> = {}) {
  const query = { 
    'availability.isAvailable': true, 
    status: 'published',
    ...filters 
  };
  return this.find(query);
};

interface PropertySearchParams {
  city?: string;
  state?: string;
  type?: string;
  minRent?: number;
  maxRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  amenities?: string[];
  available?: boolean;
}

propertySchema.statics.search = async function(searchParams: PropertySearchParams) {
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

  const query: Record<string, unknown> = {};

  if (available) {
    query['availability.isAvailable'] = true;
    query.status = 'published';
  }

  if (type) {
    query.type = type;
  }

  if (minRent !== undefined || maxRent !== undefined) {
    const range: { $gte?: number; $lte?: number } = {};
    if (minRent !== undefined) range.$gte = minRent;
    if (maxRent !== undefined) range.$lte = maxRent;
    query['longTermRent.monthlyAmount'] = range;
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

  // If city or state filters are provided, resolve them to canonical geo ids
  // (City/Region collections) and constrain by the matching Address ids. Geo is
  // relational, so there is no free-text city/state matching on the Address.
  if (city || state) {
    const { resolveGeoFilterAddressIds } = require('../../services/geoQueryService');
    const addressIds = await resolveGeoFilterAddressIds({ city, state });
    if (addressIds === null || addressIds.length === 0) {
      return []; // No matching city/region, or no addresses there
    }
    query.addressId = { $in: addressIds };
  }

  return this.find(query).populate('addressId');
};

// Geospatial query methods
interface AddressIdRef {
  _id: unknown;
}

propertySchema.statics.findNearby = async function(
  longitude: number,
  latitude: number,
  maxDistance: number = 10000
) {
  // First find addresses within the specified distance
  const Address = mongoose.model('Address');
  const nearbyAddresses: AddressIdRef[] = await Address.find({
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

  const addressIds = nearbyAddresses.map((addr: AddressIdRef) => addr._id);

  if (addressIds.length === 0) {
    return [];
  }

  return this.find({
    addressId: { $in: addressIds },
    'availability.isAvailable': true,
    status: 'published'
  }).populate('addressId');
};

propertySchema.statics.findWithinRadius = async function(
  longitude: number,
  latitude: number,
  radiusInMeters: number
) {
  // First find addresses within the specified radius
  const Address = mongoose.model('Address');
  const nearbyAddresses: AddressIdRef[] = await Address.find({
    coordinates: {
      $geoWithin: {
        $centerSphere: [[longitude, latitude], radiusInMeters / 6371000] // Convert to radians
      }
    }
  }).select('_id');

  const addressIds = nearbyAddresses.map((addr: AddressIdRef) => addr._id);

  if (addressIds.length === 0) {
    return [];
  }

  return this.find({
    addressId: { $in: addressIds },
    'availability.isAvailable': true,
    status: 'published'
  }).populate('addressId');
};

propertySchema.statics.findInPolygon = async function(coordinates: number[][]) {
  // First find addresses within the specified polygon
  const Address = mongoose.model('Address');
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

  const addressIds = addressesInPolygon.map((addr: AddressIdRef) => addr._id);
  
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
propertySchema.methods.incrementViews = function(this: IProperty) {
  this.views = (this.views || 0) + 1;
  return this.save();
};

propertySchema.methods.updateRating = function(this: IProperty, newRating: number) {
  const rating = this.rating || { average: 0, count: 0 };
  const totalRating = (rating.average * rating.count) + newRating;
  rating.count += 1;
  rating.average = totalRating / rating.count;
  this.rating = rating;
  return this.save();
};

interface AddressWithCoords {
  coordinates?: {
    coordinates?: number[];
  };
}

interface AddressDocWithSetLocation {
  setLocation(longitude: number, latitude: number): void;
  save(): Promise<unknown>;
}

// GeoJSON helper methods
propertySchema.methods.setLocation = async function(this: IProperty, longitude: number, latitude: number) {
  // This method now needs to update the referenced address
  if (this.addressId) {
    const Address = mongoose.model('Address');
    const address = (await Address.findById(this.addressId)) as AddressDocWithSetLocation | null;
    if (address) {
      address.setLocation(longitude, latitude);
      await address.save();
    }
  }
  return this;
};

propertySchema.methods.getCoordinates = function(this: IProperty): { longitude: number; latitude: number } | null {
  // This method requires the address to be populated
  const address = (this.address || this.addressId) as AddressWithCoords | undefined;
  const coords = address?.coordinates?.coordinates;
  if (coords && coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    return {
      longitude: coords[0],
      latitude: coords[1]
    };
  }
  return null;
};

module.exports = mongoose.model('Property', propertySchema);
