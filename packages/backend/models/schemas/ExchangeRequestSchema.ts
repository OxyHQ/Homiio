/**
 * Exchange Request Schema
 * Mongoose schema for home-swap / free-hosting requests against a listing
 * carrying the EXCHANGE intent.
 *
 * Distinct from Reservation (paid vacation booking), ViewingRequest (in-person
 * tour) and Lease (long-term contract). Mirrors ReservationSchema's structure.
 */

const mongoose = require('mongoose');
const { ExchangeMode, ExchangeRequestStatus } = require('@homiio/shared-types');

// Half-open date range [start, end) for an exchange stay.
const exchangeWindowSchema = new mongoose.Schema({
  start: {
    type: Date,
    required: [true, 'Window start is required']
  },
  end: {
    type: Date,
    required: [true, 'Window end is required'],
    validate: {
      validator: function(this: any, value: Date) {
        return value instanceof Date && value > this.start;
      },
      message: 'Window end must be after start'
    }
  }
}, { _id: false });

const exchangeRequestSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  requesterOxyUserId: {
    type: String,
    required: [true, 'Requester Oxy user ID is required'],
    index: true
  },
  hostOxyUserId: {
    type: String,
    required: [true, 'Host Oxy user ID is required'],
    index: true
  },
  mode: {
    type: String,
    enum: Object.values(ExchangeMode),
    required: [true, 'Exchange mode is required']
  },
  // For a SWAP: the property the requester offers in return.
  offeredPropertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property'
  },
  requestedWindow: {
    type: exchangeWindowSchema,
    required: [true, 'Requested window is required']
  },
  // For a SWAP: dates the host could stay in the requester's property.
  offeredWindow: {
    type: exchangeWindowSchema,
    default: undefined
  },
  message: {
    type: String,
    trim: true,
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  status: {
    type: String,
    enum: Object.values(ExchangeRequestStatus),
    default: ExchangeRequestStatus.PENDING,
    required: true,
    index: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: any, ret: any) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for host/requester dashboards and calendar-overlap checks.
exchangeRequestSchema.index({ propertyId: 1, status: 1 });
exchangeRequestSchema.index({ requesterOxyUserId: 1, status: 1, createdAt: -1 });
exchangeRequestSchema.index({ hostOxyUserId: 1, status: 1, createdAt: -1 });
exchangeRequestSchema.index({ 'requestedWindow.start': 1, 'requestedWindow.end': 1 });

// Pre-save: a swap request must offer a property; a host request must not.
exchangeRequestSchema.pre('save', function(this: any, next: any) {
  if (this.mode === ExchangeMode.HOST && this.offeredPropertyId) {
    this.offeredPropertyId = undefined;
    this.offeredWindow = undefined;
  }
  next();
});

module.exports = mongoose.model('ExchangeRequest', exchangeRequestSchema);
