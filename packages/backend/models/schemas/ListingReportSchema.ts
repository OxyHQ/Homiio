/**
 * ListingReport Schema
 * Mongoose schema for trust & safety reports filed against a property listing.
 *
 * Filed by a signed-in user to flag a problem (inaccurate info, suspected
 * scam, inappropriate content, an already-rented listing, …). Reports feed an
 * internal review queue and carry no public visibility. Distinct from a
 * `Review` (public address rating).
 */

const mongoose = require('mongoose');
const validator = require('validator');
const {
  ListingReportReason,
  ListingReportStatus
} = require('@homiio/shared-types');

const MAX_DETAILS_LENGTH = 4000;

const listingReportSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  reporterProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Reporter profile ID is required'],
    index: true
  },
  reason: {
    type: String,
    enum: Object.values(ListingReportReason),
    required: [true, 'Report reason is required']
  },
  details: {
    type: String,
    trim: true,
    maxlength: [MAX_DETAILS_LENGTH, `Details cannot exceed ${MAX_DETAILS_LENGTH} characters`]
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: (value: string) => !value || validator.isEmail(value),
      message: 'Invalid contact email'
    }
  },
  status: {
    type: String,
    enum: Object.values(ListingReportStatus),
    default: ListingReportStatus.OPEN,
    required: true,
    index: true
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

// Triage queue + per-property pipeline lookups.
listingReportSchema.index({ status: 1, createdAt: -1 });
listingReportSchema.index({ propertyId: 1, status: 1 });

// One open report per reporter per property — re-filing while a report is
// still open is a no-op at the controller layer (guarded by this index).
listingReportSchema.index(
  { propertyId: 1, reporterProfileId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: ListingReportStatus.OPEN }
  }
);

module.exports = mongoose.model('ListingReport', listingReportSchema);
