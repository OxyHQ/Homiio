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
        enum: [
          "verification", 
          "reviews", 
          "payment_history", 
          "communication", 
          "rental_history",
          "basic_info",
          "employment",
          "references",
          "roommate_preferences",
          "roommate_compatibility",
          "agency_business",
          "agency_verification",
          "agency_members"
        ],
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
    roommate: {
      enabled: {
        type: Boolean,
        default: false,
      },
      preferences: {
        ageRange: {
          min: {
            type: Number,
            min: [18, "Minimum age must be at least 18"],
            max: [100, "Minimum age cannot exceed 100"],
            default: 18,
          },
          max: {
            type: Number,
            min: [18, "Maximum age must be at least 18"],
            max: [100, "Maximum age cannot exceed 100"],
            default: 35,
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
            default: "no",
          },
          pets: {
            type: String,
            enum: ["yes", "no", "prefer_not"],
            default: "prefer_not",
          },
          partying: {
            type: String,
            enum: ["yes", "no", "prefer_not"],
            default: "no",
          },
          cleanliness: {
            type: String,
            enum: ["very_clean", "clean", "average", "relaxed"],
            default: "clean",
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
            min: [0, "Minimum budget cannot be negative"],
            default: 800,
          },
          max: {
            type: Number,
            min: [0, "Maximum budget cannot be negative"],
            default: 1500,
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
          min: [1, "Roommate count must be at least 1"],
        },
        reason: {
          type: String,
          trim: true,
        },
      }],
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
  // Sindi chat history
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

// Agency Profile Schema - app-specific business data
const agencyProfileSchema = new mongoose.Schema({
  businessType: {
    type: String,
    enum: ["real_estate_agency", "property_management", "brokerage", "developer", "other"],
    required: true,
  },
  legalCompanyName: {
    type: String,
    trim: true,
    maxlength: [200, "Legal company name cannot exceed 200 characters"],
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

// Business Profile Schema
const businessProfileSchema = new mongoose.Schema({
  businessType: {
    type: String,
    enum: ["small_business", "startup", "freelancer", "consultant", "other"],
    required: true,
  },
  legalCompanyName: {
    type: String,
    trim: true,
  },
  description: {
    type: String,
    maxlength: [1000, "Description cannot exceed 1000 characters"],
  },
  businessDetails: {
    licenseNumber: {
      type: String,
      trim: true,
    },
    taxId: {
      type: String,
      trim: true,
    },
    yearEstablished: {
      type: Number,
      min: [1900, "Year established cannot be before 1900"],
      max: [new Date().getFullYear(), "Year established cannot be in the future"],
    },
    employeeCount: {
      type: String,
      enum: ["1-5", "6-10", "11-25", "26+"],
    },
    industry: {
      type: String,
      trim: true,
    },
    specialties: [{
      type: String,
      trim: true,
      lowercase: true,
    }],
    serviceAreas: [{
      city: {
        type: String,
        required: true,
        trim: true,
      },
      state: {
        type: String,
        required: true,
        trim: true,
      },
      radius: {
        type: Number,
        min: [1, "Radius must be at least 1 mile"],
        max: [100, "Radius cannot exceed 100 miles"],
        default: 10,
      },
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
    enum: ['personal', 'agency', 'business', 'cooperative'],
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  isPrimary: {
    type: Boolean,
    default: false,
  },
  personalProfile: {
    type: personalProfileSchema,
  },
  agencyProfile: {
    type: agencyProfileSchema,
  },
  businessProfile: {
    type: businessProfileSchema,
  },
  cooperativeProfile: {
    legalName: { type: String, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    members: [{
      oxyUserId: String,
      role: { type: String, enum: ['owner', 'admin', 'member'] },
      addedAt: { type: Date, default: Date.now }
    }]
  },
}, {
  timestamps: true,
});

// Indexes
profileSchema.index({ oxyUserId: 1, profileType: 1 });
profileSchema.index({ "agencyProfile.members.oxyUserId": 1 });
// Unique compound index to ensure only one active profile per user
profileSchema.index({ oxyUserId: 1, isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
profileSchema.index({ createdAt: -1 });
profileSchema.index({ updatedAt: -1 });

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

// Pre-save middleware to ensure only one active profile per user
profileSchema.pre("save", async function(next) {
  // Ensure only one active profile per user
  if (this.isActive) {
    // Deactivate all other profiles for the same user
    await this.constructor.updateMany(
      { oxyUserId: this.oxyUserId, _id: { $ne: this._id } },
      { isActive: false }
    );
  }
  
  next();
});

// Static methods
profileSchema.statics.findActiveByOxyUserId = function(oxyUserId, select = null) {
  const query = this.findOne({ 
    oxyUserId, 
    isActive: true 
  });
  
  if (select) {
    query.select(select);
  }
  
  // Don't use lean() to preserve toJSON transform
  return query;
};

profileSchema.statics.findByOxyUserId = function(oxyUserId, select = null) {
  const query = this.find({ 
    oxyUserId
  }).sort({ isActive: -1, createdAt: -1 });
  
  if (select) {
    query.select(select);
  }
  
  // Don't use lean() to preserve toJSON transform
  return query;
};

profileSchema.statics.findByOxyUserIdAndType = function(oxyUserId, profileType) {
  return this.findOne({ 
    oxyUserId, 
    profileType
  }); // Remove .lean() to preserve toJSON transform
};

profileSchema.statics.findActiveByOxyUserIdAndUpdate = function(oxyUserId, updateData) {
  return this.findOneAndUpdate(
    { oxyUserId, isActive: true },
    updateData,
    { new: true, runValidators: true }
  );
};

profileSchema.statics.findByOxyUserIdAndUpdate = function(oxyUserId, profileId, updateData) {
  return this.findOneAndUpdate(
    { oxyUserId, _id: profileId },
    updateData,
    { new: true, runValidators: true }
  );
};

profileSchema.statics.findAgencyMemberships = function(oxyUserId, select = null) {
  const query = this.find({
    profileType: "agency",
    "agencyProfile.members.oxyUserId": oxyUserId,
  });
  if (select) {
    query.select(select);
  }
  // Don't use lean() to preserve toJSON transform
  return query;
};

// Static method to safely activate a profile
profileSchema.statics.activateProfile = async function(oxyUserId, profileId) {
  const session = await this.startSession();
  try {
    await session.withTransaction(async () => {
      // First, deactivate all profiles for this user
      await this.updateMany(
        { oxyUserId },
        { isActive: false },
        { session }
      );
      
      // Then activate the specified profile
      await this.findByIdAndUpdate(
        profileId,
        { isActive: true },
        { session, new: true, runValidators: true }
      );
    });
    
    // Return the activated profile
    return await this.findById(profileId);
  } finally {
    await session.endSession();
  }
};

// Instance methods
profileSchema.methods.calculateTrustScore = function(forceRecalculate = false) {
  // Check if trust score is already calculated and recent (within 1 hour)
  if (!forceRecalculate && 
      this.personalProfile?.trustScore?.lastCalculated && 
      Date.now() - new Date(this.personalProfile.trustScore.lastCalculated).getTime() < 60 * 60 * 1000) {
    return {
      score: this.personalProfile.trustScore.score,
      factors: this.personalProfile.trustScore.factors,
      totalScore: this.personalProfile.trustScore.totalScore,
      maxScore: this.personalProfile.trustScore.maxScore
    };
  }

  let totalScore = 0;
  let maxScore = 0;
  const factors = [];

  // Personal Profile Scoring
  if (this.personalProfile) {
    const personal = this.personalProfile;
    
    // Basic Information (20 points)
    if (personal.basicInfo) {
      const basicMax = 20;
      let basicScore = 0;
      
      if (personal.basicInfo.firstName) basicScore += 2;
      if (personal.basicInfo.lastName) basicScore += 2;
      if (personal.basicInfo.dateOfBirth) basicScore += 3;
      if (personal.basicInfo.phoneNumber) basicScore += 3;
      if (personal.basicInfo.emergencyContact) basicScore += 3;
      if (personal.basicInfo.nationality) basicScore += 2;
      if (personal.basicInfo.languages && personal.basicInfo.languages.length > 0) basicScore += 2;
      if (personal.basicInfo.bio && personal.basicInfo.bio.length > 10) basicScore += 3;
      
      totalScore += basicScore;
      maxScore += basicMax;
      factors.push({
        type: "basic_info",
        value: basicScore,
        maxValue: basicMax,
        label: "Basic Information"
      });
    }

    // Employment Information (25 points)
    if (personal.employment) {
      const employmentMax = 25;
      let employmentScore = 0;
      
      if (personal.employment.employmentStatus) employmentScore += 5;
      if (personal.employment.employerName) employmentScore += 5;
      if (personal.employment.jobTitle) employmentScore += 3;
      if (personal.employment.employmentStartDate) employmentScore += 3;
      if (personal.employment.monthlyIncome) employmentScore += 5;
      if (personal.employment.employmentType) employmentScore += 2;
      if (personal.employment.employerPhone) employmentScore += 2;
      
      totalScore += employmentScore;
      maxScore += employmentMax;
      factors.push({
        type: "employment",
        value: employmentScore,
        maxValue: employmentMax,
        label: "Employment Information"
      });
    }

    // References (20 points)
    if (personal.references && personal.references.length > 0) {
      const referencesMax = 20;
      let referencesScore = 0;
      
      personal.references.forEach(ref => {
        if (ref.name) referencesScore += 2;
        if (ref.relationship) referencesScore += 1;
        if (ref.phone) referencesScore += 2;
        if (ref.email) referencesScore += 1;
        if (ref.verified) referencesScore += 1;
      });
      
      referencesScore = Math.min(referencesScore, referencesMax);
      totalScore += referencesScore;
      maxScore += referencesMax;
      factors.push({
        type: "references",
        value: referencesScore,
        maxValue: referencesMax,
        label: "References"
      });
    }

    // Rental History (20 points)
    if (personal.rentalHistory && personal.rentalHistory.length > 0) {
      const rentalMax = 20;
      let rentalScore = 0;
      
      personal.rentalHistory.forEach(rental => {
        if (rental.address) rentalScore += 3;
        if (rental.startDate) rentalScore += 2;
        if (rental.endDate) rentalScore += 2;
        if (rental.reasonForLeaving) rentalScore += 2;
        if (rental.landlordContact?.name) rentalScore += 2;
        if (rental.landlordContact?.phone) rentalScore += 2;
        if (rental.landlordContact?.email) rentalScore += 2;
        if (rental.verified) rentalScore += 2;
      });
      
      rentalScore = Math.min(rentalScore, rentalMax);
      totalScore += rentalScore;
      maxScore += rentalMax;
      factors.push({
        type: "rental_history",
        value: rentalScore,
        maxValue: rentalMax,
        label: "Rental History"
      });
    }

    // Verification Status (15 points)
    if (personal.verification) {
      const verificationMax = 15;
      let verificationScore = 0;
      
      if (personal.verification.identity) verificationScore += 5;
      if (personal.verification.income) verificationScore += 5;
      if (personal.verification.background) verificationScore += 3;
      if (personal.verification.rentalHistory) verificationScore += 2;
      
      totalScore += verificationScore;
      maxScore += verificationMax;
      factors.push({
        type: "verification",
        value: verificationScore,
        maxValue: verificationMax,
        label: "Verification Status"
      });
    }
  }

  // Agency Profile Scoring
  if (this.agencyProfile) {
    const agency = this.agencyProfile;
    
    // Business Information (20 points)
    if (agency.businessInfo) {
      const businessMax = 20;
      let businessScore = 0;
      
      if (agency.businessInfo.businessName) businessScore += 3;
      if (agency.businessInfo.businessType) businessScore += 2;
      if (agency.businessInfo.licenseNumber) businessScore += 5;
      if (agency.businessInfo.taxId) businessScore += 3;
      if (agency.businessInfo.website) businessScore += 2;
      if (agency.businessInfo.businessPhone) businessScore += 2;
      if (agency.businessInfo.businessEmail) businessScore += 2;
      if (agency.businessInfo.businessAddress) businessScore += 1;
      
      totalScore += businessScore;
      maxScore += businessMax;
      factors.push({
        type: "agency_business",
        value: businessScore,
        maxValue: businessMax,
        label: "Business Information"
      });
    }

    // Verification (15 points)
    if (agency.verification) {
      const agencyVerificationMax = 15;
      let agencyVerificationScore = 0;
      
      if (agency.verification.businessLicense) agencyVerificationScore += 5;
      if (agency.verification.insurance) agencyVerificationScore += 5;
      if (agency.verification.bonding) agencyVerificationScore += 3;
      if (agency.verification.backgroundCheck) agencyVerificationScore += 2;
      
      totalScore += agencyVerificationScore;
      maxScore += agencyVerificationMax;
      factors.push({
        type: "agency_verification",
        value: agencyVerificationScore,
        maxValue: agencyVerificationMax,
        label: "Agency Verification"
      });
    }

    // Team Members (10 points)
    if (agency.members && agency.members.length > 0) {
      const membersMax = 10;
      let membersScore = 0;
      
      membersScore = Math.min(agency.members.length * 2, membersMax);
      
      totalScore += membersScore;
      maxScore += membersMax;
      factors.push({
        type: "agency_members",
        value: membersScore,
        maxValue: membersMax,
        label: "Team Members"
      });
    }
  }

  // Calculate final score as percentage
  const finalScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  // Update the trust score in the profile
  if (this.personalProfile) {
    this.personalProfile.trustScore = {
      score: finalScore,
      factors: factors,
      totalScore: totalScore,
      maxScore: maxScore,
      lastCalculated: new Date()
    };
  } else if (this.profileType === 'personal') {
    // Initialize personalProfile if it doesn't exist but this is a personal profile
    this.personalProfile = {
      trustScore: {
        score: finalScore,
        factors: factors,
        totalScore: totalScore,
        maxScore: maxScore,
        lastCalculated: new Date()
      }
    };
  }

  return {
    score: finalScore,
    factors: factors,
    totalScore: totalScore,
    maxScore: maxScore
  };
};

profileSchema.methods.updateTrustScore = function(factor, value) {
  if (this.personalProfile) {
    // Initialize trustScore if it doesn't exist
    if (!this.personalProfile.trustScore) {
      this.personalProfile.trustScore = {
        score: 0,
        factors: [],
        totalScore: 0,
        maxScore: 0,
        lastCalculated: new Date()
      };
    }
    
    // Initialize factors array if it doesn't exist
    if (!this.personalProfile.trustScore.factors) {
      this.personalProfile.trustScore.factors = [];
    }
    
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

// Transform _id to id for frontend compatibility
profileSchema.set('toJSON', {
  transform: function(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model("Profile", profileSchema); 