const mongoose = require('mongoose');

/**
 * Confirmed roommate relationship between two Oxy accounts.
 * Participant ids are stored sorted lexicographically for canonical pairing.
 */
const roommateRelationshipSchema = new mongoose.Schema({
  participant1OxyUserId: {
    type: String,
    required: true,
    index: true,
  },
  participant2OxyUserId: {
    type: String,
    required: true,
    index: true,
  },
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RoommateRequest',
  },
  matchScore: {
    type: Number,
    min: 0,
    max: 100,
    default: 0,
  },
  status: {
    type: String,
    enum: ['active', 'ended'],
    default: 'active',
    index: true,
  },
  startDate: {
    type: Date,
    default: Date.now,
  },
  endDate: {
    type: Date,
  },
}, {
  timestamps: true,
});

roommateRelationshipSchema.index(
  { participant1OxyUserId: 1, participant2OxyUserId: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('RoommateRelationship', roommateRelationshipSchema);
