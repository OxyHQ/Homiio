import type { Document, Model } from 'mongoose';

import mongoose from 'mongoose';

/**
 * Exported because `models/index.ts` re-exports the model, and a declaration
 * emit cannot name a type it cannot import. Note this is NOT the same shape as
 * `documentTypes.ISavedSearch`, which omits `query`/`filters`/`notificationsEnabled`
 * — the two should be unified.
 */
export interface ISavedSearch extends Document {
  oxyUserId: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
  notificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type SavedSearchModel = Model<ISavedSearch>;

const savedSearchSchema = new mongoose.Schema<ISavedSearch, SavedSearchModel>({
  oxyUserId: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  query: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500,
  },
  filters: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  notificationsEnabled: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index to ensure unique oxyUserId + name combinations (prevent duplicate search names per user)
savedSearchSchema.index({ oxyUserId: 1, name: 1 }, { unique: true });

// Index for efficient queries by oxyUserId and createdAt
savedSearchSchema.index({ oxyUserId: 1, createdAt: -1 });

// Index for notification queries
savedSearchSchema.index({ oxyUserId: 1, notificationsEnabled: 1 });

// Update the updatedAt field on save
savedSearchSchema.pre('save', function(this: ISavedSearch) {
  this.updatedAt = new Date();
});

export default mongoose.model<ISavedSearch, SavedSearchModel>('SavedSearch', savedSearchSchema); 
