import mongoose from 'mongoose';
import type { ISaved } from '../documentTypes';

const savedSchema = new mongoose.Schema({
  oxyUserId: { type: String, required: true, index: true },
  targetType: { type: String, enum: ['property'], required: true, index: true },
  targetId: { type: String, required: true, index: true },
  notes: { type: String },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedPropertyFolder' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

savedSchema.index({ oxyUserId: 1, targetType: 1, targetId: 1 }, { unique: true });

export default mongoose.models.Saved || mongoose.model<ISaved>('Saved', savedSchema);
