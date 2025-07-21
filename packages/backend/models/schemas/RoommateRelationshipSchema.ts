/**
 * Roommate Relationship Schema
 * Mongoose schema for RoommateRelationship model
 */

const mongoose = require('mongoose');

const roommateRelationshipSchema = new mongoose.Schema({
  // The two roommate profiles
  profile1Id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Profile 1 ID is required']
  },
  profile2Id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Profile 2 ID is required']
  },
  
  // Relationship status
  status: {
    type: String,
    enum: ['active', 'inactive', 'ended'],
    default: 'active'
  },
  
  // Relationship details
  startDate: {
    type: Date,
    default: Date.now
  },
  
  endDate: {
    type: Date
  },
  
  // How they found each other
  matchPercentage: {
    type: Number,
    min: [0, 'Match percentage cannot be negative'],
    max: [100, 'Match percentage cannot exceed 100']
  },
  
  // Shared preferences and agreements
  sharedPreferences: {
    budget: {
      min: Number,
      max: Number,
      currency: {
        type: String,
        default: 'USD'
      }
    },
    location: {
      city: String,
      state: String,
      radius: Number
    },
    moveInDate: Date,
    leaseDuration: {
      type: String,
      enum: ['monthly', '3_months', '6_months', 'yearly', 'flexible']
    },
    lifestyle: {
      smoking: {
        type: String,
        enum: ['yes', 'no', 'prefer_not']
      },
      pets: {
        type: String,
        enum: ['yes', 'no', 'prefer_not']
      },
      partying: {
        type: String,
        enum: ['yes', 'no', 'prefer_not']
      },
      cleanliness: {
        type: String,
        enum: ['very_clean', 'clean', 'average', 'relaxed']
      },
      schedule: {
        type: String,
        enum: ['early_bird', 'night_owl', 'flexible']
      }
    }
  },
  
  // Communication and interaction tracking
  lastInteraction: {
    type: Date,
    default: Date.now
  },
  
  interactionCount: {
    type: Number,
    default: 0
  },
  
  // Property search status
  propertySearchStatus: {
    type: String,
    enum: ['searching', 'found', 'moved_in', 'not_searching'],
    default: 'searching'
  },
  
  // Notes and agreements
  notes: {
    type: String,
    trim: true,
    maxlength: [2000, 'Notes cannot exceed 2000 characters']
  },
  
  // Rating and feedback
  rating: {
    profile1Rating: {
      type: Number,
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5']
    },
    profile2Rating: {
      type: Number,
      min: [1, 'Rating must be at least 1'],
      max: [5, 'Rating cannot exceed 5']
    },
    profile1Feedback: {
      type: String,
      trim: true,
      maxlength: [1000, 'Feedback cannot exceed 1000 characters']
    },
    profile2Feedback: {
      type: String,
      trim: true,
      maxlength: [1000, 'Feedback cannot exceed 1000 characters']
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
roommateRelationshipSchema.index({ profile1Id: 1, profile2Id: 1 }, { unique: true });
roommateRelationshipSchema.index({ profile1Id: 1, status: 1 });
roommateRelationshipSchema.index({ profile2Id: 1, status: 1 });
roommateRelationshipSchema.index({ status: 1, propertySearchStatus: 1 });

// Virtual for getting the other profile ID
roommateRelationshipSchema.virtual('getOtherProfileId').get(function(profileId) {
  if (this.profile1Id.toString() === profileId.toString()) {
    return this.profile2Id;
  }
  return this.profile1Id;
});

// Static methods
roommateRelationshipSchema.statics.findByProfile = function(profileId) {
  return this.find({
    $or: [
      { profile1Id: profileId },
      { profile2Id: profileId }
    ],
    status: 'active'
  }).populate('profile1Id profile2Id');
};

roommateRelationshipSchema.statics.findActiveRelationship = function(profile1Id, profile2Id) {
  return this.findOne({
    $or: [
      { profile1Id, profile2Id },
      { profile1Id: profile2Id, profile2Id: profile1Id }
    ],
    status: 'active'
  });
};

roommateRelationshipSchema.statics.createRelationship = function(profile1Id, profile2Id, matchPercentage, sharedPreferences = {}) {
  return this.create({
    profile1Id,
    profile2Id,
    matchPercentage,
    sharedPreferences
  });
};

// Instance methods
roommateRelationshipSchema.methods.endRelationship = function(endDate = new Date()) {
  this.status = 'ended';
  this.endDate = endDate;
  return this.save();
};

roommateRelationshipSchema.methods.updateInteraction = function() {
  this.lastInteraction = new Date();
  this.interactionCount += 1;
  return this.save();
};

roommateRelationshipSchema.methods.updatePropertySearchStatus = function(status) {
  this.propertySearchStatus = status;
  return this.save();
};

roommateRelationshipSchema.methods.addRating = function(raterProfileId, rating, feedback = '') {
  if (this.profile1Id.toString() === raterProfileId.toString()) {
    this.rating.profile1Rating = rating;
    this.rating.profile1Feedback = feedback;
  } else if (this.profile2Id.toString() === raterProfileId.toString()) {
    this.rating.profile2Rating = rating;
    this.rating.profile2Feedback = feedback;
  }
  return this.save();
};

module.exports = mongoose.model('RoommateRelationship', roommateRelationshipSchema); 