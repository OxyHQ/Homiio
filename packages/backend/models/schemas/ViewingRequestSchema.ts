const mongoose = require('mongoose');

const viewingRequestSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true,
    index: true,
  },
  requesterProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  ownerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  scheduledAt: {
    type: Date,
    required: true,
    index: true,
  },
  message: {
    type: String,
    trim: true,
    maxlength: [1000, 'Message cannot exceed 1000 characters']
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'declined', 'cancelled'],
    default: 'pending',
    index: true,
  },
  cancelledBy: {
    type: String,
    enum: ['requester', 'owner'],
  }
}, {
  timestamps: true,
});

// Ensure an owner cannot be double-booked for the exact same property/time slot
viewingRequestSchema.index({ propertyId: 1, scheduledAt: 1, status: 1 });
viewingRequestSchema.index({ ownerProfileId: 1, scheduledAt: 1, status: 1 });

module.exports = mongoose.model('ViewingRequest', viewingRequestSchema);


