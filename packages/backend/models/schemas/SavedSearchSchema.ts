import type { Document, Model, Types } from 'mongoose';

const mongoose: typeof import('mongoose') = require('mongoose');

interface ISavedSearch extends Document {
  oxyUserId: string;
  name: string;
  query: string;
  filters: Record<string, unknown>;
  notificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type SavedSearchModel = Model<ISavedSearch>;

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

module.exports = mongoose.model<ISavedSearch, SavedSearchModel>('SavedSearch', savedSearchSchema); 
