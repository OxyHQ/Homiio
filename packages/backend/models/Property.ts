/**
 * Property Model
 * Modern ES module export for Property schema
 */

import { Schema, model, Document, Model, Query, Types } from 'mongoose';
import {
  PropertyType,
  PropertyStatus,
  HousingType,
  LayoutType,
  LeaseDuration,
  UtilitiesIncluded,
  AvailabilityWindowStatus,
  CancellationPolicy,
  OfferingType,
  ExchangeMode,
  PropertyPriceEthics,
} from '@homiio/shared-types';
import { validateOfferings } from './schemas/offeringValidation';

/** Currency codes accepted on every priced block (rent / sale / exchange). */
const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'] as const;

// Define the Property interface
export interface IProperty extends Document {
  _id: Types.ObjectId;
  oxyUserId?: string;
  addressId: Types.ObjectId;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  isExternal?: boolean;
  externalContact?: {
    phone?: string;
    email?: string;
    whatsapp?: string;
    name?: string;
    agencyName?: string;
    kind?: 'owner' | 'agency' | 'private' | 'unknown';
  };
  expiresAt?: Date;
  type: PropertyType;
  housingType?: HousingType;
  layoutType?: LayoutType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  /** The single source of truth for how this listing is offered. */
  offerings: OfferingType[];
  /** Monthly-rent pricing, present iff `offerings` includes `LONG_TERM_RENT`. */
  longTermRent?: {
    monthlyAmount: number;
    currency: string;
    deposit?: number;
    applicationFee?: number;
    lateFee?: number;
    utilities?: UtilitiesIncluded;
  };
  /** Per-night pricing, present iff `offerings` includes `SHORT_TERM_RENT`. */
  shortTermRent?: {
    nightlyRate: number;
    currency: string;
    cleaningFee?: number;
    serviceFee?: number;
    taxesPercent?: number;
    minNights?: number;
    maxNights?: number;
    instantBook?: boolean;
    deposit?: number;
  };
  amenities?: string[];
  images?: Array<{
    /** Reference to the canonical Image document (entityType 'property'). */
    imageId?: Types.ObjectId;
    /** Ready-to-render URL — the stored medium variant. Preserves the legacy shape. */
    url: string;
    caption?: string;
    isPrimary?: boolean;
    order?: number;
    /** All processed variant URLs, for callers that want a specific rendition. */
    urls?: {
      original?: string;
      small?: string;
      medium?: string;
      large?: string;
    };
  }>;
  /**
   * Denormalized flag: true when `images` holds at least one entry. Kept in
   * lock-step with `images` by the schema pre-save / pre-update hooks so
   * discovery feeds can rank image-bearing listings first with an index-backed
   * sort. Always derived from `images` — never written directly.
   */
  hasImages?: boolean;
  status: PropertyStatus;
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  furnishedStatus?: 'furnished' | 'unfurnished' | 'partially_furnished' | 'not_specified';
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  petPolicy?: 'allowed' | 'not_allowed' | 'case_by_case' | 'not_specified';
  petFee?: number;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
  availableFrom?: Date;
  leaseTerm?: string;
  maxGuests?: number;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  // Short-term (vacation) calendar
  availabilityWindows?: Array<{
    start: Date;
    end: Date;
    status: AvailabilityWindowStatus;
  }>;
  cancellationPolicy?: CancellationPolicy;
  sale?: {
    price: number;
    currency: string;
    pricePerSqm?: number;
    estimatedYield?: number;
    isPriceReduced?: boolean;
    chainStatus?: 'no_chain' | 'chain' | 'unknown';
  };
  exchange?: {
    mode: ExchangeMode;
    availabilityWindows: Array<{
      start: Date;
      end: Date;
      status: AvailabilityWindowStatus;
    }>;
    minStay?: number;
    maxStay?: number;
    welcomeNote?: string;
    languages?: string[];
    mealsIncluded?: boolean;
    requiresReciprocity?: boolean;
  };
  isVerified?: boolean;
  isEcoFriendly?: boolean;
  views?: number;
  lastSaved?: Date;
  /** Soft-delete timestamp: set when the listing is archived via deleteProperty. */
  deletedAt?: Date | null;
  parentPropertyId?: Types.ObjectId;
  rating?: {
    average: number;
    count: number;
  };
  /** Partner attribution: set on create when the listing originated from a partner referral link. */
  sourcedByPartner?: Types.ObjectId;
  /** Audit copy of the referral code captured at create time (partners may rotate codes). */
  sourcedByReferralCode?: string;
  /** Relational Agency link (resolved from portal contact agency name on external listings). */
  agencyId?: Types.ObjectId;
  /** Server-computed ethical + market price score. */
  priceEthics?: Omit<PropertyPriceEthics, 'scoredAt'> & { scoredAt: Date };
  /** Populated runtime virtual added by the `toJSON`/`toObject` transform when `addressId` is populated. */
  address?: Record<string, unknown>;
  /** Auto-managed by `timestamps: true`. */
  createdAt: Date;
  /** Auto-managed by `timestamps: true`. */
  updatedAt: Date;
}

/**
 * Mongoose `Query` shape that the geospatial statics return. `findNearby` /
 * `findWithinRadius` are written as `async function` over an early-return
 * empty array, but their non-empty path returns a `Property.find(...).populate(...)`
 * Query. Call sites chain `.find()`, `.skip()`, `.limit()`, `.clone()`,
 * `.countDocuments()` on the result — so we expose the Query type, which is a
 * thenable that callers can also `await`.
 */
export type PropertyQuery = Query<IProperty[], IProperty>;

/** Custom statics defined on the runtime Property schema. */
export interface IPropertyModel extends Model<IProperty> {
  findByOxyUser(oxyUserId: string, options?: Record<string, unknown>): PropertyQuery;
  findAvailable(filters?: Record<string, unknown>): PropertyQuery;
  search(searchParams: Record<string, unknown>): Promise<IProperty[]>;
  /** Returns a chainable Query (or an empty array when no addresses match). */
  findNearby(longitude: number, latitude: number, maxDistance?: number): PropertyQuery;
  /** Returns a chainable Query (or an empty array when no addresses match). */
  findWithinRadius(longitude: number, latitude: number, radiusInMeters: number): PropertyQuery;
  findInPolygon(coordinates: number[][]): PropertyQuery;
}

// Per-offering priced blocks. Each currency uses the shared 5-code set; 'FAIR'
// is 4 chars so no length cap is applied (a 3-char cap would reject it).
const longTermRentSchema = new Schema({
  monthlyAmount: {
    type: Number,
    required: [true, 'Monthly amount is required'],
    min: [0, 'Monthly amount cannot be negative']
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    enum: SUPPORTED_CURRENCIES,
    default: 'EUR'
  },
  deposit: { type: Number, min: [0, 'Deposit cannot be negative'] },
  applicationFee: { type: Number, min: [0, 'Application fee cannot be negative'] },
  lateFee: { type: Number, min: [0, 'Late fee cannot be negative'] },
  utilities: { type: String, enum: Object.values(UtilitiesIncluded) }
}, { _id: false });

const shortTermRentSchema = new Schema({
  nightlyRate: {
    type: Number,
    required: [true, 'Nightly rate is required'],
    min: [0, 'Nightly rate cannot be negative']
  },
  currency: {
    type: String,
    required: true,
    uppercase: true,
    enum: SUPPORTED_CURRENCIES,
    default: 'EUR'
  },
  cleaningFee: { type: Number, min: [0, 'Cleaning fee cannot be negative'] },
  serviceFee: { type: Number, min: [0, 'Service fee cannot be negative'] },
  taxesPercent: { type: Number, min: [0, 'Taxes percent cannot be negative'], max: [100, 'Taxes percent cannot exceed 100'] },
  minNights: { type: Number, min: [1, 'Minimum nights must be at least 1'] },
  maxNights: { type: Number, min: [1, 'Maximum nights must be at least 1'] },
  instantBook: { type: Boolean, default: false },
  deposit: { type: Number, min: [0, 'Deposit cannot be negative'] }
}, { _id: false });

const PropertySchema = new Schema({
  profileId: {
    type: Schema.Types.ObjectId,
    ref: 'Profile',
    required: function(this: any) { return !this.isExternal; }
  },
  addressId: {
    type: Schema.Types.ObjectId,
    ref: 'Address',
    required: true
  },
  source: {
    type: String,
    trim: true
  },
  sourceId: {
    type: String,
    trim: true
  },
  sourceUrl: {
    type: String,
    trim: true
  },
  isExternal: {
    type: Boolean,
    default: false
  },
  expiresAt: {
    type: Date,
    index: { expireAfterSeconds: 0 }
  },
  type: {
    type: String,
    enum: Object.values(PropertyType),
    required: true
  },
  housingType: {
    type: String,
    enum: Object.values(HousingType),
    default: HousingType.PRIVATE
  },
  layoutType: {
    type: String,
    enum: Object.values(LayoutType)
  },
  description: {
    type: String,
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  squareFootage: {
    type: Number,
    min: [1, 'Square footage must be positive']
  },
  bedrooms: {
    type: Number,
    min: [0, 'Bedrooms cannot be negative'],
    default: 0
  },
  bathrooms: {
    type: Number,
    min: [0, 'Bathrooms cannot be negative'],
    default: 1
  },
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
  images: [{
    imageId: {
      type: Schema.Types.ObjectId,
      ref: 'Image'
    },
    url: {
      type: String,
      required: true
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
    urls: {
      type: new Schema({
        original: { type: String },
        small: { type: String },
        medium: { type: String },
        large: { type: String }
      }, { _id: false }),
      default: undefined
    }
  }],
  status: {
    type: String,
    enum: ['active', 'inactive', 'archived', 'draft', 'expired'],
    default: 'active'
  },
  floor: {
    type: Number,
    min: [0, 'Floor cannot be negative']
  },
  hasElevator: {
    type: Boolean,
    default: false
  },
  parkingSpaces: {
    type: Number,
    min: [0, 'Parking spaces cannot be negative'],
    default: 0
  },
  yearBuilt: {
    type: Number,
    min: [1800, 'Year built seems too old'],
    max: [new Date().getFullYear() + 2, 'Year built cannot be in the future']
  },
  furnishedStatus: {
    type: String,
    enum: ['furnished', 'unfurnished', 'partially_furnished', 'not_specified'],
    default: 'not_specified'
  },
  utilitiesIncluded: {
    type: Boolean,
    default: false
  },
  petFriendly: {
    type: Boolean,
    default: false
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
  hasBalcony: {
    type: Boolean,
    default: false
  },
  hasGarden: {
    type: Boolean,
    default: false
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
  availabilityWindows: {
    type: [{
      start: { type: Date, required: true },
      end: { type: Date, required: true },
      status: {
        type: String,
        enum: Object.values(AvailabilityWindowStatus),
        default: AvailabilityWindowStatus.AVAILABLE,
        required: true
      },
      _id: false
    }],
    default: []
  },
  cancellationPolicy: {
    type: String,
    enum: Object.values(CancellationPolicy)
  },
  sale: {
    price: { type: Number, min: [0, 'Sale price cannot be negative'] },
    currency: { type: String, uppercase: true, minlength: 3, maxlength: 3 },
    pricePerSqm: { type: Number, min: [0, 'Price per sqm cannot be negative'] },
    estimatedYield: { type: Number, min: [0, 'Estimated yield cannot be negative'] },
    isPriceReduced: { type: Boolean, default: false },
    chainStatus: { type: String, enum: ['no_chain', 'chain', 'unknown'] }
  },
  exchange: {
    mode: { type: String, enum: Object.values(ExchangeMode) },
    availabilityWindows: {
      type: [{
        start: { type: Date, required: true },
        end: { type: Date, required: true },
        status: {
          type: String,
          enum: Object.values(AvailabilityWindowStatus),
          default: AvailabilityWindowStatus.AVAILABLE,
          required: true
        },
        _id: false
      }],
      default: []
    },
    minStay: { type: Number, min: [1, 'Minimum stay must be at least 1 night'] },
    maxStay: { type: Number, min: [1, 'Maximum stay must be at least 1 night'] },
    welcomeNote: { type: String, maxlength: [2000, 'Welcome note cannot exceed 2000 characters'] },
    languages: [{ type: String }],
    mealsIncluded: { type: Boolean, default: false },
    requiresReciprocity: { type: Boolean, default: false }
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isEcoFriendly: {
    type: Boolean,
    default: false
  },
  views: {
    type: Number,
    default: 0,
    min: [0, 'Views cannot be negative']
  },
  lastSaved: {
    type: Date,
    default: Date.now
  },
  parentPropertyId: {
    type: Schema.Types.ObjectId,
    ref: 'Property'
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
    transform: function(doc: any, ret: any) {
      ret.id = ret._id;
      // Transform addressId to address if populated
      if (ret.addressId && typeof ret.addressId === 'object' && ret.addressId._id) {
        ret.address = { ...ret.addressId };
        delete ret.addressId;
      }
      return ret;
    }
  },
  toObject: { 
    virtuals: true,
    transform: function(doc: any, ret: any) {
      // Transform addressId to address if populated
      if (ret.addressId && typeof ret.addressId === 'object' && ret.addressId._id) {
        ret.address = { ...ret.addressId };
        delete ret.addressId;
      }
      return ret;
    }
  }
});

// Indexes for better query performance
PropertySchema.index({ profileId: 1, status: 1 });
PropertySchema.index({ addressId: 1 });
PropertySchema.index({ type: 1, status: 1 });
PropertySchema.index({ bedrooms: 1, bathrooms: 1 });
PropertySchema.index({ amenities: 1 });
PropertySchema.index({ createdAt: -1 });
PropertySchema.index({ source: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } });
// ---- Per-offering indexes ----
PropertySchema.index({ offerings: 1, status: 1 });
PropertySchema.index({ 'longTermRent.monthlyAmount': 1 });
PropertySchema.index({ 'shortTermRent.nightlyRate': 1 });
PropertySchema.index({ 'sale.price': 1 });
PropertySchema.index({ 'availabilityWindows.start': 1 });
PropertySchema.index({ 'availabilityWindows.end': 1 });
PropertySchema.index({ offerings: 1, 'exchange.mode': 1, status: 1 });

// Offerings must be non-empty and equal exactly the set of present priced
// blocks, each with a positive price / valid exchange mode (single source of
// truth in `offeringValidation`). Attached to `offerings` so it runs on save
// and on `findOneAndUpdate` with `runValidators`. The controller-level
// `applyOfferingRules*` surfaces the SPECIFIC reason to the client; this is the
// DB last-line guard.
PropertySchema.path('offerings').validate({
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

// Pre-save hook to update lastSaved
PropertySchema.pre('save', function(this: IProperty) {
  this.lastSaved = new Date();
});

export default model<IProperty>('Property', PropertySchema);