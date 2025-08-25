"use strict";
/**
 * Property Model
 * Modern ES module export for Property schema
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var shared_types_1 = require("@homiio/shared-types");
var PropertySchema = new mongoose_1.Schema({
    profileId: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: 'Profile',
        required: function () { return !this.isExternal; }
    },
    addressId: {
        type: mongoose_1.Schema.Types.ObjectId,
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
        enum: Object.values(shared_types_1.PropertyType),
        required: true
    },
    housingType: {
        type: String,
        enum: Object.values(shared_types_1.HousingType),
        default: shared_types_1.HousingType.PRIVATE
    },
    layoutType: {
        type: String,
        enum: Object.values(shared_types_1.LayoutType)
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
        enum: Object.values(shared_types_1.LeaseDuration),
        default: shared_types_1.LeaseDuration.MONTHLY
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
        type: mongoose_1.Schema.Types.ObjectId,
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
        transform: function (doc, ret) {
            ret.id = ret._id;
            // Transform addressId to address if populated
            if (ret.addressId && typeof ret.addressId === 'object' && ret.addressId._id) {
                ret.address = __assign({}, ret.addressId);
                delete ret.addressId;
            }
            return ret;
        }
    },
    toObject: {
        virtuals: true,
        transform: function (doc, ret) {
            // Transform addressId to address if populated
            if (ret.addressId && typeof ret.addressId === 'object' && ret.addressId._id) {
                ret.address = __assign({}, ret.addressId);
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
// Pre-save hook to update lastSaved
PropertySchema.pre('save', function () {
    this.lastSaved = new Date();
});
exports.default = (0, mongoose_1.model)('Property', PropertySchema);
