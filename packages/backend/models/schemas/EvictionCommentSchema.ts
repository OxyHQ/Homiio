/**
 * EvictionComment Schema
 *
 * A public comment on an eviction case — the community coordination thread
 * (logistics, updates from the ground, solidarity messages). Comments are
 * cascade-deleted when their parent `EvictionCase` is removed.
 */

const mongoose = require('mongoose');

const MAX_BODY_LENGTH = 2000;

const evictionCommentSchema = new mongoose.Schema({
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EvictionCase',
    required: [true, 'Case ID is required'],
    index: true
  },
  oxyUserId: {
    type: String,
    required: [true, 'Oxy user ID is required'],
    index: true
  },
  body: {
    type: String,
    required: [true, 'Comment body is required'],
    trim: true,
    maxlength: [MAX_BODY_LENGTH, `Comment cannot exceed ${MAX_BODY_LENGTH} characters`]
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: unknown, ret: Record<string, unknown>) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Newest-first thread pagination per case.
evictionCommentSchema.index({ caseId: 1, createdAt: -1 });

module.exports = mongoose.model('EvictionComment', evictionCommentSchema);
