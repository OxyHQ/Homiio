const mongoose = require('mongoose');

const savedProfileSchema = new mongoose.Schema({
  followerProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
  followedProfileId: { type: mongoose.Schema.Types.ObjectId, ref: 'Profile', required: true, index: true },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: true });

savedProfileSchema.index({ followerProfileId: 1, followedProfileId: 1 }, { unique: true });

module.exports = mongoose.models.SavedProfile || mongoose.model('SavedProfile', savedProfileSchema);

