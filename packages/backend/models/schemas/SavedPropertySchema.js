const mongoose = require('mongoose');

const savedPropertySchema = new mongoose.Schema({
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
  savedAt: {
    type: Date,
    default: Date.now,
  },
  notes: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

// Compound index to ensure unique profileId + propertyId combinations
savedPropertySchema.index({ profileId: 1, propertyId: 1 }, { unique: true });

// Index for efficient queries by profileId and savedAt
savedPropertySchema.index({ profileId: 1, savedAt: -1 });

module.exports = mongoose.model('SavedProperty', savedPropertySchema); 