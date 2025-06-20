/**
 * User Schema
 * Mongoose schema for User model
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const validator = require("validator");

const profileSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      trim: true,
      maxlength: [50, "First name cannot exceed 50 characters"],
    },
    lastName: {
      type: String,
      trim: true,
      maxlength: [50, "Last name cannot exceed 50 characters"],
    },
    avatar: {
      type: String,
      validate: {
        validator: validator.isURL,
        message: "Invalid avatar URL",
      },
    },
    bio: {
      type: String,
      trim: true,
      maxlength: [500, "Bio cannot exceed 500 characters"],
    },
    dateOfBirth: {
      type: Date,
      validate: {
        validator: function (v) {
          return v < new Date();
        },
        message: "Date of birth must be in the past",
      },
    },
    phone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v) {
          return validator.isMobilePhone(v, "any", { strictMode: false });
        },
        message: "Invalid phone number",
      },
    },
    occupation: {
      type: String,
      trim: true,
      maxlength: [100, "Occupation cannot exceed 100 characters"],
    },
    income: {
      amount: {
        type: Number,
        min: [0, "Income cannot be negative"],
      },
      currency: {
        type: String,
        enum: ["USD", "EUR", "GBP", "CAD"],
        default: "USD",
      },
      frequency: {
        type: String,
        enum: ["hourly", "daily", "weekly", "monthly", "yearly"],
        default: "yearly",
      },
    },
  },
  { _id: false },
);

const preferencesSchema = new mongoose.Schema(
  {
    propertyTypes: [
      {
        type: String,
        enum: ["apartment", "house", "room", "studio"],
      },
    ],
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
    preferredAmenities: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    preferredLocations: [
      {
        city: String,
        state: String,
        radius: {
          type: Number,
          min: [1, "Radius must be at least 1 mile"],
          max: [100, "Radius cannot exceed 100 miles"],
          default: 10,
        },
      },
    ],
    petFriendly: {
      type: Boolean,
      default: false,
    },
    smokingAllowed: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const verificationSchema = new mongoose.Schema(
  {
    email: {
      type: Boolean,
      default: false,
    },
    phone: {
      type: Boolean,
      default: false,
    },
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
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      lowercase: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username cannot exceed 30 characters"],
      validate: {
        validator: function (v) {
          return /^[a-zA-Z0-9_-]+$/.test(v);
        },
        message:
          "Username can only contain letters, numbers, underscores, and hyphens",
      },
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: validator.isEmail,
        message: "Invalid email address",
      },
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [8, "Password must be at least 8 characters"],
      select: false, // Don't include password in queries by default
    },
    profile: {
      type: profileSchema,
      default: {},
    },
    preferences: {
      type: preferencesSchema,
      default: {},
    },
    verification: {
      type: verificationSchema,
      default: {},
    },
    role: {
      type: String,
      enum: ["tenant", "landlord", "admin"],
      default: "tenant",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "pending"],
      default: "pending",
    },
    lastLogin: {
      type: Date,
    },
    loginAttempts: {
      type: Number,
      default: 0,
    },
    lockUntil: {
      type: Date,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },
    // Oxy integration
    oxyUserId: {
      type: String,
      unique: true,
      sparse: true,
    },
    // Properties owned by this user (if landlord)
    ownedProperties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Property",
      },
    ],
    // Current leases (if tenant)
    currentLeases: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Lease",
      },
    ],
    // Saved/favorite properties
    savedProperties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Property",
      },
    ],
    // Recently viewed properties
    recentlyViewedProperties: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Property",
      },
    ],
    // Trust score for the platform
    trustScore: {
      score: {
        type: Number,
        min: [0, "Trust score cannot be negative"],
        max: [100, "Trust score cannot exceed 100"],
        default: 50,
      },
      factors: [
        {
          type: {
            type: String,
            enum: [
              "verification",
              "reviews",
              "payment_history",
              "communication",
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
        },
      ],
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.resetPasswordToken;
        delete ret.resetPasswordExpires;
        delete ret.emailVerificationToken;
        delete ret.emailVerificationExpires;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

// Indexes (only for fields that don't have unique: true)
userSchema.index({ role: 1, status: 1 });
userSchema.index({ "preferences.preferredLocations.city": 1 });
userSchema.index({ recentlyViewedProperties: 1 });

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  if (this.profile.firstName && this.profile.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.username;
});

// Virtual for account locked status
userSchema.virtual("isLocked").get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Virtual for verification status
userSchema.virtual("isVerified").get(function () {
  return this.verification.email && this.verification.identity;
});

// Pre-save middleware to hash password
userSchema.pre("save", async function (next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified("password")) return next();

  try {
    // Hash password with cost of 12
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Static methods
userSchema.statics.findByEmail = function (email) {
  return this.findOne({ email: email.toLowerCase() }).select("+password");
};

userSchema.statics.findByUsername = function (username) {
  return this.findOne({ username: username.toLowerCase() }).select("+password");
};

userSchema.statics.findByOxyId = function (oxyUserId) {
  return this.findOne({ oxyUserId });
};

// Instance methods
userSchema.methods.comparePassword = async function (candidatePassword) {
  if (!this.password) {
    throw new Error("Password not available for comparison");
  }
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.incrementLoginAttempts = function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 },
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }

  return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: { loginAttempts: 1, lockUntil: 1 },
  });
};

userSchema.methods.updateTrustScore = function (factor, value) {
  const existingFactor = this.trustScore.factors.find((f) => f.type === factor);

  if (existingFactor) {
    existingFactor.value = value;
    existingFactor.updatedAt = new Date();
  } else {
    this.trustScore.factors.push({
      type: factor,
      value: value,
      updatedAt: new Date(),
    });
  }

  // Recalculate overall trust score
  const totalScore = this.trustScore.factors.reduce(
    (sum, factor) => sum + factor.value,
    0,
  );
  this.trustScore.score = Math.round(
    totalScore / this.trustScore.factors.length,
  );

  return this.save();
};

userSchema.methods.addSavedProperty = function (propertyId) {
  if (!this.savedProperties.includes(propertyId)) {
    this.savedProperties.push(propertyId);
    return this.save();
  }
  return Promise.resolve(this);
};

userSchema.methods.removeSavedProperty = function (propertyId) {
  this.savedProperties.pull(propertyId);
  return this.save();
};

userSchema.methods.addRecentlyViewedProperty = async function (
  propertyId,
  limit = 10,
) {
  const mongoose = require('mongoose');
  
  // Use atomic operations for better performance
  return await mongoose.model('User').findByIdAndUpdate(
    this._id,
    [
      {
        $set: {
          recentlyViewedProperties: {
            $slice: [
              {
                $concatArrays: [
                  [propertyId],
                  {
                    $filter: {
                      input: "$recentlyViewedProperties",
                      cond: { $ne: ["$$this", propertyId] }
                    }
                  }
                ]
              },
              limit
            ]
          }
        }
      }
    ],
    { new: true }
  );
};

module.exports = mongoose.model("User", userSchema);
