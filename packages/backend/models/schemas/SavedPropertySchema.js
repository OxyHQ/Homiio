const mongoose = require('mongoose');

const savedPropertySchema = new mongoose.Schema({
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

// Compound index to ensure unique oxyUserId + propertyId combinations
savedPropertySchema.index({ oxyUserId: 1, propertyId: 1 }, { unique: true });

// Index for efficient queries by oxyUserId and savedAt
savedPropertySchema.index({ oxyUserId: 1, savedAt: -1 });

module.exports = mongoose.model('SavedProperty', savedPropertySchema); 