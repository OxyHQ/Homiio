/**
 * Roommate Request Schema
 * Mongoose schema for RoommateRequest model
 */

const mongoose = require('mongoose');

const roommateRequestSchema = new mongoose.Schema({
  // Sender and receiver profile IDs
  senderProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Sender profile ID is required']
  },
  receiverProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Receiver profile ID is required']
  },
  
  // Request details
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined', 'expired'],
    default: 'pending'
  },
  
  message: {
    type: String,
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  
  // Match percentage calculated when request was sent
  matchPercentage: {
    type: Number,
    min: [0, 'Match percentage cannot be negative'],
    max: [100, 'Match percentage cannot exceed 100']
  },
  
  // Request metadata
  sentAt: {
    type: Date,
    default: Date.now
  },
  
  respondedAt: {
    type: Date
  },
  
  expiresAt: {
    type: Date,
    default: function() {
      // Requests expire after 30 days
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 30);
      return expiryDate;
    }
  },
  
  // Response details
  responseMessage: {
    type: String,
    trim: true,
    maxlength: [1000, 'Response message cannot exceed 1000 characters']
  },
  
  // If accepted, create a roommate relationship
  roommateRelationshipId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RoommateRelationship'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
roommateRequestSchema.index({ senderProfileId: 1, receiverProfileId: 1 }, { unique: true });
roommateRequestSchema.index({ receiverProfileId: 1, status: 1 });
roommateRequestSchema.index({ senderProfileId: 1, status: 1 });
roommateRequestSchema.index({ status: 1, expiresAt: 1 });

// Virtual for checking if request is expired
roommateRequestSchema.virtual('isExpired').get(function() {
  return this.expiresAt && new Date() > this.expiresAt;
});

// Pre-save middleware to update respondedAt when status changes
roommateRequestSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status !== 'pending' && !this.respondedAt) {
    this.respondedAt = new Date();
  }
  next();
});

// Static methods
roommateRequestSchema.statics.findPendingRequests = function(profileId) {
  return this.find({
    receiverProfileId: profileId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  }).populate('senderProfileId');
};

roommateRequestSchema.statics.findSentRequests = function(profileId) {
  return this.find({
    senderProfileId: profileId
  }).populate('receiverProfileId');
};

roommateRequestSchema.statics.findReceivedRequests = function(profileId) {
  return this.find({
    receiverProfileId: profileId
  }).populate('senderProfileId');
};

roommateRequestSchema.statics.findActiveRequest = function(senderProfileId, receiverProfileId) {
  return this.findOne({
    senderProfileId,
    receiverProfileId,
    status: { $in: ['pending', 'accepted'] }
  });
};

// Instance methods
roommateRequestSchema.methods.accept = function(responseMessage = '') {
  this.status = 'accepted';
  this.responseMessage = responseMessage;
  this.respondedAt = new Date();
  return this.save();
};

roommateRequestSchema.methods.decline = function(responseMessage = '') {
  this.status = 'declined';
  this.responseMessage = responseMessage;
  this.respondedAt = new Date();
  return this.save();
};

roommateRequestSchema.methods.expire = function() {
  this.status = 'expired';
  return this.save();
};

module.exports = mongoose.model('RoommateRequest', roommateRequestSchema); 