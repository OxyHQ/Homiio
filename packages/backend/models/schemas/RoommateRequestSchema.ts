const mongoose = require('mongoose');

const roommateRequestSchema = new mongoose.Schema({
  fromProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  toProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  message: {
    type: String,
    trim: true,
    maxlength: [500, 'Message cannot exceed 500 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'declined'],
    default: 'pending',
    index: true,
  }
}, {
  timestamps: true,
});

// Prevent duplicate pending requests between the same pair of profiles
roommateRequestSchema.index(
  { fromProfileId: 1, toProfileId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('RoommateRequest', roommateRequestSchema);
