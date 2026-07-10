/**
 * Exchange Review Schema
 * Mongoose schema for a review written after a completed home exchange.
 *
 * One review per (exchangeRequest, reviewer) pair: the unique compound index
 * stops a participant from reviewing the same exchange twice.
 */

const mongoose = require('mongoose');

// Minimum / maximum allowed star rating (1-5).
const MIN_RATING = 1;
const MAX_RATING = 5;

const exchangeReviewSchema = new mongoose.Schema({
  exchangeRequestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ExchangeRequest',
    required: [true, 'Exchange request ID is required'],
    index: true
  },
  reviewerOxyUserId: {
    type: String,
    required: [true, 'Reviewer Oxy user ID is required'],
    index: true
  },
  subjectOxyUserId: {
    type: String,
    required: [true, 'Subject Oxy user ID is required'],
    index: true
  },
  rating: {
    type: Number,
    required: [true, 'Rating is required'],
    min: [MIN_RATING, `Rating must be at least ${MIN_RATING}`],
    max: [MAX_RATING, `Rating cannot exceed ${MAX_RATING}`]
  },
  comment: {
    type: String,
    trim: true,
    maxlength: [2000, 'Comment cannot exceed 2000 characters']
  },
  categories: {
    communication: { type: Number, min: MIN_RATING, max: MAX_RATING },
    cleanliness: { type: Number, min: MIN_RATING, max: MAX_RATING },
    accuracy: { type: Number, min: MIN_RATING, max: MAX_RATING },
    hospitality: { type: Number, min: MIN_RATING, max: MAX_RATING }
  },
  isVerified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: any, ret: any) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Subject profile review list (newest first).
exchangeReviewSchema.index({ subjectOxyUserId: 1, createdAt: -1 });
// One review per reviewer per exchange.
exchangeReviewSchema.index({ exchangeRequestId: 1, reviewerOxyUserId: 1 }, { unique: true });

module.exports = mongoose.model('ExchangeReview', exchangeReviewSchema);
