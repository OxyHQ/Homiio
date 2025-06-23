const mongoose = require('mongoose');

const recentlyViewedSchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true,
  },
  viewedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index to ensure unique profileId + propertyId combinations
recentlyViewedSchema.index({ profileId: 1, propertyId: 1 }, { unique: true });

// Index for efficient queries by profileId and viewedAt
recentlyViewedSchema.index({ profileId: 1, viewedAt: -1 });

module.exports = mongoose.model('RecentlyViewed', recentlyViewedSchema); 