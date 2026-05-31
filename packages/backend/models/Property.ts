/**
 * Property Model
 * Modern ES module export for Property schema
 */

import { Schema, model, Document, Types } from 'mongoose';
import {
  PropertyType,
  PropertyStatus,
  HousingType,
  LayoutType,
  LeaseDuration,
  RentMode,
  AvailabilityWindowStatus,
  CancellationPolicy,
  ListingIntent,
  ExchangeMode
} from '@homiio/shared-types';

// Define the Property interface
export interface IProperty extends Document {
  _id: Types.ObjectId;
  profileId?: Types.ObjectId;
  addressId: Types.ObjectId;
  source?: string;
  sourceId?: string;
  sourceUrl?: string;
  isExternal?: boolean;
  expiresAt?: Date;
  type: PropertyType;
  housingType?: HousingType;
  layoutType?: LayoutType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: {
    amount: number;
    currency: string;
    paymentFrequency: 'monthly' | 'weekly' | 'daily';
  };
  priceUnit?: 'day' | 'night' | 'week' | 'month' | 'year';
  amenities?: string[];
  images?: Array<{
    url: string;
    caption?: string;
    isPrimary?: boolean;
  }>;
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
  // Hybrid rental fields
  rentMode?: RentMode;
  availabilityWindows?: Array<{
    start: Date;
    end: Date;
    status: AvailabilityWindowStatus;
  }>;
  minStay?: number;
  maxStay?: number;
  cancellationPolicy?: CancellationPolicy;
  instantBook?: boolean;
  priceBreakdown?: {
    cleaningFee?: number;
    serviceFee?: number;
    taxesPercent?: number;
  };
  // Multi-intent platform (rent / sale / exchange)
  intents?: ListingIntent[];
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
  parentPropertyId?: Types.ObjectId;
  rating?: {
    average: number;
    count: number;
  };
}

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
  rent: {
    amount: {
      type: Number,
      required: true,
      min: [0, 'Rent amount cannot be negative']
    },
    currency: {
      type: String,
      required: true,
      default: 'USD',
      uppercase: true,
      minlength: 3,
      maxlength: 3
    },
    paymentFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'monthly'],
      default: 'monthly'
    }
  },
  priceUnit: {
    type: String,
    enum: ['day', 'night', 'week', 'month', 'year'],
    default: 'month'
  },
  amenities: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  images: [{
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
  rentMode: {
    type: String,
    enum: Object.values(RentMode),
    default: RentMode.LONG_TERM,
    index: true
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
    cleaningFee: { type: Number, min: 0 },
    serviceFee: { type: Number, min: 0 },
    taxesPercent: { type: Number, min: 0, max: 100 }
  },
  // ---- Multi-intent platform (rent / sale / exchange) ----
  // A listing may carry several intents at once; empty/missing reads as rent-only.
  intents: {
    type: [{ type: String, enum: Object.values(ListingIntent) }],
    default: [ListingIntent.RENT]
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
      // Back-compat: legacy listings predate `intents`; surface them as rent-only.
      if (!Array.isArray(ret.intents) || ret.intents.length === 0) {
        ret.intents = [ListingIntent.RENT];
      }
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
PropertySchema.index({ 'rent.amount': 1 });
PropertySchema.index({ bedrooms: 1, bathrooms: 1 });
PropertySchema.index({ amenities: 1 });
PropertySchema.index({ createdAt: -1 });
PropertySchema.index({ source: 1, sourceId: 1 }, { unique: true, partialFilterExpression: { sourceId: { $type: 'string' } } });
// Hybrid rental indexes
PropertySchema.index({ rentMode: 1, status: 1, type: 1 });
PropertySchema.index({ 'availabilityWindows.start': 1 });
PropertySchema.index({ 'availabilityWindows.end': 1 });
PropertySchema.index({ rentMode: 1, instantBook: 1, status: 1 });
// Multi-intent indexes
PropertySchema.index({ intents: 1, status: 1 });
PropertySchema.index({ 'sale.price': 1 });
PropertySchema.index({ intents: 1, 'exchange.mode': 1, status: 1 });

/**
 * A listing is valid when it can actually be transacted: either it has a
 * rent amount, or it is offered for sale with a sale price. This keeps the
 * `rent` field present (so `property.rent` access never throws) while letting
 * sale-only listings skip a meaningful rent. Legacy rent docs always pass.
 */
function hasTransactablePrice(this: IProperty): boolean {
  const rentAmount = this.rent?.amount;
  if (typeof rentAmount === 'number' && rentAmount > 0) {
    return true;
  }
  const intents = Array.isArray(this.intents) ? this.intents : [];
  const salePrice = this.sale?.price;
  return intents.includes(ListingIntent.SALE) && typeof salePrice === 'number' && salePrice > 0;
}

PropertySchema.path('rent').validate(
  hasTransactablePrice,
  'A listing must have a rent amount or, for sale listings, a sale price'
);

// Pre-save hook to update lastSaved
PropertySchema.pre('save', function(this: IProperty) {
  this.lastSaved = new Date();
});

export default model<IProperty>('Property', PropertySchema);