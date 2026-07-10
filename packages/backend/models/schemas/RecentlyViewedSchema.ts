const mongoose = require('mongoose');

const recentlyViewedSchema = new mongoose.Schema({
  oxyUserId: {
    type: String,
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

// Compound index to ensure unique oxyUserId + propertyId combinations
recentlyViewedSchema.index({ oxyUserId: 1, propertyId: 1 }, { unique: true });

// Index for efficient queries by oxyUserId and viewedAt
recentlyViewedSchema.index({ oxyUserId: 1, viewedAt: -1 });

module.exports = mongoose.model('RecentlyViewed', recentlyViewedSchema); 