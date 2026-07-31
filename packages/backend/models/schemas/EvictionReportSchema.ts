/**
 * EvictionReport Schema
 *
 * Trust & safety report filed against an eviction case (suspected fake notice,
 * inappropriate content, …). Mirrors `ListingReportSchema` — same reason/status
 * enums — but scoped to `caseId` instead of `propertyId`. Reports feed the same
 * internal review queue and carry no public visibility.
 */

import mongoose from 'mongoose';
import type { IEvictionReport } from '../documentTypes';
import validator from 'validator';
import { ListingReportReason, ListingReportStatus } from '@homiio/shared-types';

const MAX_DETAILS_LENGTH = 4000;

const evictionReportSchema = new mongoose.Schema({
  caseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'EvictionCase',
    required: [true, 'Case ID is required'],
    index: true
  },
  reporterOxyUserId: {
    type: String,
    required: [true, 'Reporter Oxy user ID is required'],
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
    transform: function(_doc: unknown, ret: Record<string, unknown>) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Triage queue + per-case pipeline lookups.
evictionReportSchema.index({ status: 1, createdAt: -1 });
evictionReportSchema.index({ caseId: 1, status: 1 });

// One open report per reporter per case — re-filing while a report is still
// open is a no-op at the controller layer (guarded by this index).
evictionReportSchema.index(
  { caseId: 1, reporterOxyUserId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: ListingReportStatus.OPEN }
  }
);

export default mongoose.model<IEvictionReport>('EvictionReport', evictionReportSchema);
