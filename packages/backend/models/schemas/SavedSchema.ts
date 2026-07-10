const mongoose = require('mongoose');

const savedSchema = new mongoose.Schema({
  oxyUserId: { type: String, required: true, index: true },
  targetType: { type: String, enum: ['property', 'user'], required: true, index: true },
  targetId: { type: String, required: true, index: true },
  notes: { type: String },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SavedPropertyFolder' },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

savedSchema.index({ oxyUserId: 1, targetType: 1, targetId: 1 }, { unique: true });

module.exports = mongoose.models.Saved || mongoose.model('Saved', savedSchema);
