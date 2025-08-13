const mongoose = require('mongoose');

const savedSchema = new mongoose.Schema({
  profileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
  targetType: { type: String, enum: ['property', 'profile'], required: true, index: true },
  targetId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  notes: { type: String },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedPropertyFolder' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

savedSchema.index({ profileId: 1, targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.models.Saved || mongoose.model('Saved', savedSchema);

