import type { IProfile } from '../documentTypes';

const mongoose = require('mongoose');
const {
  EmploymentStatus,
  LeaseDuration,
  PriceUnit,
  PropertyType,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  GenderPreference
} = require('@homiio/shared-types');

const personalProfileSchema = new mongoose.Schema({
  personalInfo: {
    bio: {
      type: String,
      maxlength: [500, 'Bio cannot exceed 500 characters'],
    },
    occupation: {
      type: String,
      trim: true,
    },
    employer: {
      type: String,
      trim: true,
    },
    annualIncome: {
      type: Number,
      min: [0, 'Annual income cannot be negative'],
    },
    employmentStatus: {
      type: String,
      enum: Object.values(EmploymentStatus),
    },
    moveInDate: {
      type: Date,
    },
    leaseDuration: {
      type: String,
      enum: Object.values(LeaseDuration),
      default: LeaseDuration.YEARLY,
    },
  },
  preferences: {
    propertyTypes: [{
      type: String,
      enum: Object.values(PropertyType),
    }],
    maxRent: {
      type: Number,
      min: [0, 'Maximum rent cannot be negative'],
    },
    priceUnit: {
      type: String,
      enum: Object.values(PriceUnit),
      default: PriceUnit.MONTH,
    },
    minBedrooms: {
      type: Number,
      min: [0, 'Minimum bedrooms cannot be negative'],
      default: 0,
    },
    minBathrooms: {
      type: Number,
      min: [0, 'Minimum bathrooms cannot be negative'],
      default: 0,
    },
    preferredAmenities: [{
      type: String,
      trim: true,
      lowercase: true,
    }],
    preferredLocations: [{
      city: String,
      state: String,
      radius: {
        type: Number,
        min: [1, 'Radius must be at least 1 mile'],
        max: [100, 'Radius cannot exceed 100 miles'],
        default: 10,
      },
    }],
    petFriendly: {
      type: Boolean,
      default: false,
    },
    smokingAllowed: {
      type: Boolean,
      default: false,
    },
    furnished: {
      type: Boolean,
      default: false,
    },
    parkingRequired: {
      type: Boolean,
      default: false,
    },
    accessibility: {
      type: Boolean,
      default: false,
    },
  },
  references: [{
    name: {
      type: String,
      required: true,
      trim: true,
    },
    relationship: {
      type: String,
      enum: Object.values(ReferenceRelationship),
      required: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
  }],
  rentalHistory: [{
    address: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
    },
    monthlyRent: {
      type: Number,
      min: 0,
    },
    reasonForLeaving: {
      type: String,
      enum: Object.values(ReasonForLeaving),
    },
    landlordContact: {
      name: String,
      phone: String,
      email: String,
    },
    verified: {
      type: Boolean,
      default: false,
    },
  }],
  verification: {
    identity: {
      type: Boolean,
      default: false,
    },
    income: {
      type: Boolean,
      default: false,
    },
    background: {
      type: Boolean,
      default: false,
    },
    rentalHistory: {
      type: Boolean,
      default: false,
    },
    references: {
      type: Boolean,
      default: false,
    },
  },
  settings: {
    notifications: {
      email: {
        type: Boolean,
        default: true,
      },
      push: {
        type: Boolean,
        default: true,
      },
      sms: {
        type: Boolean,
        default: false,
      },
      propertyAlerts: {
        type: Boolean,
        default: true,
      },
      viewingReminders: {
        type: Boolean,
        default: true,
      },
      leaseUpdates: {
        type: Boolean,
        default: true,
      },
    },
    privacy: {
      profileVisibility: {
        type: String,
        enum: Object.values(ProfileVisibility),
        default: ProfileVisibility.PUBLIC,
      },
      showContactInfo: {
        type: Boolean,
        default: true,
      },
      showIncome: {
        type: Boolean,
        default: false,
      },
      showRentalHistory: {
        type: Boolean,
        default: false,
      },
      showReferences: {
        type: Boolean,
        default: false,
      },
    },
    roommate: {
      enabled: {
        type: Boolean,
        default: false,
      },
      preferences: {
        ageRange: {
          min: {
            type: Number,
            min: [18, 'Minimum age must be at least 18'],
            max: [100, 'Minimum age cannot exceed 100'],
            default: 18,
          },
          max: {
            type: Number,
            min: [18, 'Maximum age must be at least 18'],
            max: [100, 'Maximum age cannot exceed 100'],
            default: 35,
          },
        },
        gender: {
          type: String,
          enum: Object.values(GenderPreference),
          default: GenderPreference.ANY,
        },
        lifestyle: {
          smoking: {
            type: String,
            enum: ['yes', 'no', 'prefer_not'],
            default: 'no',
          },
          pets: {
            type: String,
            enum: ['yes', 'no', 'prefer_not'],
            default: 'prefer_not',
          },
          partying: {
            type: String,
            enum: ['yes', 'no', 'prefer_not'],
            default: 'no',
          },
          cleanliness: {
            type: String,
            enum: ['very_clean', 'clean', 'average', 'relaxed'],
            default: 'clean',
          },
          schedule: {
            type: String,
            enum: ['early_bird', 'night_owl', 'flexible'],
            default: 'flexible',
          },
        },
        budget: {
          min: {
            type: Number,
            min: [0, 'Minimum budget cannot be negative'],
            default: 800,
          },
          max: {
            type: Number,
            min: [0, 'Maximum budget cannot be negative'],
            default: 1500,
          },
        },
        moveInDate: {
          type: Date,
        },
        leaseDuration: {
          type: String,
          enum: Object.values(LeaseDuration),
          default: LeaseDuration.YEARLY,
        },
      },
      history: [{
        startDate: {
          type: Date,
          required: true,
        },
        endDate: {
          type: Date,
        },
        location: {
          type: String,
          required: true,
        },
        roommateCount: {
          type: Number,
          min: [1, 'Roommate count must be at least 1'],
        },
        reason: {
          type: String,
          trim: true,
        },
      }],
    },
    language: {
      type: String,
      default: 'en',
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    currency: {
      type: String,
      default: 'USD',
    },
  },
  chatHistory: [
    {
      role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
        required: true,
      },
      content: {
        type: String,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
    },
  ],
}, { _id: false });

const profileSchema = new mongoose.Schema({
  oxyUserId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  personalProfile: {
    type: personalProfileSchema,
  },
}, {
  timestamps: true,
});

profileSchema.index({ createdAt: -1 });
profileSchema.index({ updatedAt: -1 });

profileSchema.statics.findByOxyUserId = function(oxyUserId: string, select: string | null = null) {
  const query = this.findOne({ oxyUserId });

  if (select) {
    query.select(select);
  }

  return query;
};

profileSchema.statics.findByOxyUserIdAndUpdate = function(
  oxyUserId: string,
  updateData: Record<string, unknown>,
) {
  return this.findOneAndUpdate(
    { oxyUserId },
    updateData,
    { new: true, runValidators: true, upsert: false },
  );
};

profileSchema.set('toJSON', {
  transform: function(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Profile', profileSchema);
