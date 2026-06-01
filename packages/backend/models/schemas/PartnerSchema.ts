/**
 * Partner Schema
 * Mongoose schema for a Homiio Partner (agent) — a user who sources property
 * listings via a referral link and earns a commission when a sourced deal
 * closes.
 *
 * One Partner per Oxy user (enforced by a unique index on `userId`). The
 * `referralCode` is a unique short slug carried on the partner's referral link.
 * `points` is the running gamification total; the reward tier is derived from
 * it (never stored) so the frontend and backend can never disagree.
 */

const mongoose = require('mongoose');

const PARTNER_STATUSES: ReadonlyArray<string> = ['active', 'inactive'];

const partnerSchema = new mongoose.Schema({
  // Oxy user id — one Partner per user.
  userId: {
    type: String,
    required: [true, 'User ID is required'],
    unique: true,
    index: true,
    trim: true
  },
  // Unique short slug carried on the referral link (e.g. "nate-7f3a").
  referralCode: {
    type: String,
    required: [true, 'Referral code is required'],
    unique: true,
    index: true,
    trim: true,
    lowercase: true
  },
  status: {
    type: String,
    enum: PARTNER_STATUSES,
    default: 'active',
    required: true,
    index: true
  },
  // Running gamification points; reward tier is derived from this via
  // `tierForPoints`, never persisted.
  points: {
    type: Number,
    default: 0,
    min: [0, 'Points cannot be negative']
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

module.exports = mongoose.model('Partner', partnerSchema);
