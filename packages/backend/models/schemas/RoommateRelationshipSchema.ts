const mongoose = require('mongoose');

/**
 * A confirmed roommate relationship between two personal profiles.
 *
 * Created when a `RoommateRequest` is accepted (see roommateController). The two
 * participant ids are stored sorted (`profile1Id` < `profile2Id` by string) so a
 * pair maps to a single canonical row regardless of who sent the request; this
 * also lets the unique partial index below prevent two concurrent `active`
 * relationships for the same pair.
 */
const roommateRelationshipSchema = new mongoose.Schema({
  profile1Id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  profile2Id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  /** The request whose acceptance created this relationship (audit link). */
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

// At most one ACTIVE relationship per sorted pair.
roommateRelationshipSchema.index(
  { profile1Id: 1, profile2Id: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('RoommateRelationship', roommateRelationshipSchema);
