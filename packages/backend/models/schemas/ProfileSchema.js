const mongoose = require('mongoose');

// Personal Profile Schema - only app-specific data
const personalProfileSchema = new mongoose.Schema({
  // Personal Information
  personalInfo: {
    bio: {
      type: String,
      maxlength: [500, "Bio cannot exceed 500 characters"],
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
      min: [0, "Annual income cannot be negative"],
    },
    employmentStatus: {
      type: String,
      enum: ["employed", "self_employed", "student", "retired", "unemployed", "other"],
    },
    moveInDate: {
      type: Date,
    },
    leaseDuration: {
      type: String,
      enum: ["monthly", "3_months", "6_months", "yearly", "flexible"],
      default: "yearly",
    },
  },
  // App-specific preferences and settings
  preferences: {
    propertyTypes: [{
      type: String,
      enum: ["apartment", "house", "room", "studio"],
    }],
    maxRent: {
      type: Number,
      min: [0, "Maximum rent cannot be negative"],
    },
    minBedrooms: {
      type: Number,
      min: [0, "Minimum bedrooms cannot be negative"],
      default: 0,
    },
    minBathrooms: {
      type: Number,
      min: [0, "Minimum bathrooms cannot be negative"],
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
        min: [1, "Radius must be at least 1 mile"],
        max: [100, "Radius cannot exceed 100 miles"],
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
  // References
  references: [{
    name: {
      type: String,
      required: true,
      trim: true,
    },
    relationship: {
      type: String,
      enum: ["landlord", "employer", "personal", "other"],
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
  // Rental History
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
      enum: ["lease_ended", "bought_home", "job_relocation", "family_reasons", "upgrade", "other"],
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
  // App-specific verification status
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
  // App-specific trust score
  trustScore: {
    score: {
      type: Number,
      min: [0, "Trust score cannot be negative"],
      max: [100, "Trust score cannot exceed 100"],
      default: 50,
    },
    factors: [{
      type: {
        type: String,
        enum: ["verification", "reviews", "payment_history", "communication", "rental_history"],
      },
      value: {
        type: Number,
        min: 0,
        max: 100,
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    }],
  },
  // App-specific settings
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
        enum: ["public", "private", "contacts_only"],
        default: "public",
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
    language: {
      type: String,
      default: "en",
    },
    timezone: {
      type: String,
      default: "UTC",
    },
    currency: {
      type: String,
      default: "USD",
    },
  },
}, { _id: false });

// Roommate Profile Schema - app-specific roommate preferences
const roommateProfileSchema = new mongoose.Schema({
  roommatePreferences: {
    ageRange: {
      min: {
        type: Number,
        min: 18,
        max: 100,
      },
      max: {
        type: Number,
        min: 18,
        max: 100,
      },
    },
    gender: {
      type: String,
      enum: ["male", "female", "any"],
      default: "any",
    },
    lifestyle: {
      smoking: {
        type: String,
        enum: ["yes", "no", "prefer_not"],
        default: "prefer_not",
      },
      pets: {
        type: String,
        enum: ["yes", "no", "prefer_not"],
        default: "prefer_not",
      },
      partying: {
        type: String,
        enum: ["yes", "no", "prefer_not"],
        default: "prefer_not",
      },
      cleanliness: {
        type: String,
        enum: ["very_clean", "clean", "average", "relaxed"],
        default: "average",
      },
      schedule: {
        type: String,
        enum: ["early_bird", "night_owl", "flexible"],
        default: "flexible",
      },
    },
    budget: {
      min: {
        type: Number,
        min: 0,
      },
      max: {
        type: Number,
        min: 0,
      },
    },
    moveInDate: {
      type: Date,
    },
    leaseDuration: {
      type: String,
      enum: ["monthly", "3_months", "6_months", "yearly", "flexible"],
      default: "yearly",
    },
  },
  roommateHistory: [{
    startDate: Date,
    endDate: Date,
    location: String,
    roommateCount: Number,
    reason: String,
  }],
  references: [{
    name: String,
    relationship: String,
    phone: String,
    email: String,
    verified: {
      type: Boolean,
      default: false,
    },
  }],
}, { _id: false });

// Agency Profile Schema - app-specific business data
const agencyProfileSchema = new mongoose.Schema({
  businessType: {
    type: String,
    enum: ["real_estate_agency", "property_management", "brokerage", "developer", "other"],
    required: true,
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, "Description cannot exceed 1000 characters"],
  },
  businessDetails: {
    licenseNumber: String,
    taxId: String,
    yearEstablished: Number,
    employeeCount: {
      type: String,
      enum: ["1-10", "11-50", "51-200", "200+"],
    },
    specialties: [{
      type: String,
      enum: ["residential", "commercial", "luxury", "student_housing", "senior_housing", "vacation_rentals"],
    }],
    serviceAreas: [{
      city: String,
      state: String,
      radius: Number,
    }],
  },
  verification: {
    businessLicense: {
      type: Boolean,
      default: false,
    },
    insurance: {
      type: Boolean,
      default: false,
    },
    bonding: {
      type: Boolean,
      default: false,
    },
    backgroundCheck: {
      type: Boolean,
      default: false,
    },
  },
  ratings: {
    average: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
    },
    count: {
      type: Number,
      default: 0,
    },
  },
  members: [{
    oxyUserId: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ["owner", "admin", "agent", "viewer"],
      default: "agent",
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    addedBy: {
      type: String, // oxyUserId of who added this member
    },
  }],
}, { _id: false });

// Main Profile Schema
const profileSchema = new mongoose.Schema({
  oxyUserId: {
    type: String,
    required: true,
    index: true,
  },
  profileType: {
    type: String,
    enum: ["personal", "roommate", "agency"],
    required: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  personalProfile: {
    type: personalProfileSchema,
  },
  roommateProfile: {
    type: roommateProfileSchema,
  },
  agencyProfile: {
    type: agencyProfileSchema,
  },
}, {
  timestamps: true,
});

// Indexes
profileSchema.index({ oxyUserId: 1, profileType: 1 });
profileSchema.index({ oxyUserId: 1, isPrimary: 1 });
profileSchema.index({ "agencyProfile.members.oxyUserId": 1 });

// Virtual for verification status
profileSchema.virtual("isVerified").get(function() {
  if (this.profileType === "personal" && this.personalProfile) {
    return this.personalProfile.verification.identity && this.personalProfile.verification.income;
  }
  if (this.profileType === "agency" && this.agencyProfile) {
    return this.agencyProfile.verification.businessLicense && this.agencyProfile.verification.insurance;
  }
  return false;
});

// Pre-save middleware to ensure only one primary profile per user
profileSchema.pre("save", async function(next) {
  if (this.isPrimary) {
    // Remove primary flag from other profiles of the same user
    await this.constructor.updateMany(
      { oxyUserId: this.oxyUserId, _id: { $ne: this._id } },
      { isPrimary: false }
    );
  }
  next();
});

// Static methods
profileSchema.statics.findByOxyUserId = function(oxyUserId) {
  return this.find({ oxyUserId });
};

profileSchema.statics.findPrimaryByOxyUserId = function(oxyUserId) {
  return this.findOne({ oxyUserId, isPrimary: true });
};

profileSchema.statics.findByOxyUserIdAndType = function(oxyUserId, profileType) {
  return this.findOne({ oxyUserId, profileType });
};

profileSchema.statics.findAgencyMemberships = function(oxyUserId) {
  return this.find({
    profileType: "agency",
    "agencyProfile.members.oxyUserId": oxyUserId,
  });
};

// Instance methods
profileSchema.methods.updateTrustScore = function(factor, value) {
  if (this.personalProfile) {
    const existingFactor = this.personalProfile.trustScore.factors.find(f => f.type === factor);
    
    if (existingFactor) {
      existingFactor.value = value;
      existingFactor.updatedAt = new Date();
    } else {
      this.personalProfile.trustScore.factors.push({
        type: factor,
        value: value,
        updatedAt: new Date(),
      });
    }
    
    // Recalculate overall trust score
    const totalScore = this.personalProfile.trustScore.factors.reduce(
      (sum, factor) => sum + factor.value,
      0
    );
    this.personalProfile.trustScore.score = Math.round(
      totalScore / this.personalProfile.trustScore.factors.length
    );
  }
  
  return this.save();
};

profileSchema.methods.addAgencyMember = function(oxyUserId, role, addedBy) {
  if (this.profileType !== "agency") {
    throw new Error("Can only add members to agency profiles");
  }
  
  // Check if member already exists
  const existingMember = this.agencyProfile.members.find(m => m.oxyUserId === oxyUserId);
  if (existingMember) {
    throw new Error("Member already exists in this agency");
  }
  
  this.agencyProfile.members.push({
    oxyUserId,
    role,
    addedAt: new Date(),
    addedBy,
  });
  
  return this.save();
};

profileSchema.methods.removeAgencyMember = function(oxyUserId) {
  if (this.profileType !== "agency") {
    throw new Error("Can only remove members from agency profiles");
  }
  
  this.agencyProfile.members = this.agencyProfile.members.filter(
    m => m.oxyUserId !== oxyUserId
  );
  
  return this.save();
};

profileSchema.methods.updateAgencyMemberRole = function(oxyUserId, newRole) {
  if (this.profileType !== "agency") {
    throw new Error("Can only update member roles in agency profiles");
  }
  
  const member = this.agencyProfile.members.find(m => m.oxyUserId === oxyUserId);
  if (!member) {
    throw new Error("Member not found in this agency");
  }
  
  member.role = newRole;
  return this.save();
};

module.exports = mongoose.model("Profile", profileSchema); 