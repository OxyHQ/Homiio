/**
 * Reservation Schema
 * Mongoose schema for vacation/short-term bookings (Airbnb-style).
 *
 * Distinct from ViewingRequest (in-person tour) and Lease (long-term contract).
 */

const mongoose = require('mongoose');
const { ReservationStatus, CancellationPolicy } = require('@homiio/shared-types');

const reservationSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  guestProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Guest profile ID is required'],
    index: true
  },
  hostProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Host profile ID is required'],
    index: true
  },
  checkIn: {
    type: Date,
    required: [true, 'Check-in date is required']
  },
  checkOut: {
    type: Date,
    required: [true, 'Check-out date is required'],
    validate: {
      validator: function(this: any, value: Date) {
        return value instanceof Date && value > this.checkIn;
      },
      message: 'Check-out date must be after check-in date'
    }
  },
  guestCount: {
    type: Number,
    required: [true, 'Guest count is required'],
    min: [1, 'Guest count must be at least 1']
  },
  nights: {
    type: Number,
    required: [true, 'Nights is required'],
    min: [1, 'Reservation must be at least 1 night']
  },
  nightlyRate: {
    type: Number,
    required: [true, 'Nightly rate is required'],
    min: [0, 'Nightly rate cannot be negative']
  },
  subtotal: {
    type: Number,
    required: [true, 'Subtotal is required'],
    min: [0, 'Subtotal cannot be negative']
  },
  cleaningFee: {
    type: Number,
    default: 0,
    min: [0, 'Cleaning fee cannot be negative']
  },
  serviceFee: {
    type: Number,
    default: 0,
    min: [0, 'Service fee cannot be negative']
  },
  taxes: {
    type: Number,
    default: 0,
    min: [0, 'Taxes cannot be negative']
  },
  total: {
    type: Number,
    required: [true, 'Total is required'],
    min: [0, 'Total cannot be negative']
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    uppercase: true,
    minlength: 3,
    maxlength: 3,
    default: 'EUR'
  },
  status: {
    type: String,
    enum: Object.values(ReservationStatus),
    default: ReservationStatus.PENDING,
    required: true,
    index: true
  },
  instantBooked: {
    type: Boolean,
    default: false
  },
  cancellationPolicy: {
    type: String,
    enum: Object.values(CancellationPolicy),
    required: [true, 'Cancellation policy is required']
  },
  specialRequests: {
    type: String,
    trim: true,
    maxlength: [2000, 'Special requests cannot exceed 2000 characters']
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

// Indexes for availability conflict checks and host/guest dashboards.
reservationSchema.index({ propertyId: 1, checkIn: 1, checkOut: 1 });
reservationSchema.index({ guestProfileId: 1, status: 1 });
reservationSchema.index({ hostProfileId: 1, status: 1, createdAt: -1 });

// Pre-save: recompute `nights` so it always matches the date range.
// Idempotent — safe to call on every save.
reservationSchema.pre('save', function(this: any, next: any) {
  if (this.checkIn instanceof Date && this.checkOut instanceof Date) {
    const ms = this.checkOut.getTime() - this.checkIn.getTime();
    const nights = Math.round(ms / (1000 * 60 * 60 * 24));
    if (nights > 0) {
      this.nights = nights;
    }
  }
  next();
});

module.exports = mongoose.model('Reservation', reservationSchema);
