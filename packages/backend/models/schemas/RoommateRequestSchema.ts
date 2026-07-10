const mongoose = require('mongoose');

const roommateRequestSchema = new mongoose.Schema({
  fromOxyUserId: {
    type: String,
    required: true,
    index: true,
  },
  toOxyUserId: {
    type: String,
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
  { fromOxyUserId: 1, toOxyUserId: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

module.exports = mongoose.model('RoommateRequest', roommateRequestSchema);
