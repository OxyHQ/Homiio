/**
 * TenantApplication Schema
 * Mongoose schema for long-term rent applications (Idealista-style).
 *
 * Submitted by a prospective tenant after viewing a property; reviewed by
 * the landlord before signing a Lease. Distinct from Reservation (vacation
 * booking) and ViewingRequest (in-person tour).
 */

const mongoose = require('mongoose');
const validator = require('validator');
const {
  TenantApplicationStatus,
  TenantApplicationDocumentType,
  EmploymentStatus,
  ReferenceRelationship
} = require('@homiio/shared-types');

const referenceContactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Reference name is required'],
    trim: true,
    maxlength: [200, 'Reference name cannot exceed 200 characters']
  },
  relationship: {
    type: String,
    enum: Object.values(ReferenceRelationship),
    required: [true, 'Reference relationship is required']
  },
  phone: {
    type: String,
    required: [true, 'Reference phone is required'],
    trim: true,
    maxlength: [50, 'Phone number cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Reference email is required'],
    trim: true,
    lowercase: true,
    validate: {
      validator: validator.isEmail,
      message: 'Invalid reference email'
    }
  }
}, { _id: false });

const applicationDocumentSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: Object.values(TenantApplicationDocumentType),
    required: [true, 'Document type is required']
  },
  url: {
    type: String,
    required: [true, 'Document URL is required'],
    validate: {
      validator: validator.isURL,
      message: 'Invalid document URL'
    }
  },
  filename: {
    type: String,
    required: [true, 'Document filename is required'],
    trim: true,
    maxlength: [255, 'Filename cannot exceed 255 characters']
  }
}, { _id: false });

const tenantApplicationSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  applicantOxyUserId: {
    type: String,
    required: [true, 'Applicant Oxy user ID is required'],
    index: true
  },
  landlordOxyUserId: {
    type: String,
    required: [true, 'Landlord Oxy user ID is required'],
    index: true
  },
  moveInDate: {
    type: Date,
    required: [true, 'Move-in date is required']
  },
  leaseTermMonths: {
    type: Number,
    required: [true, 'Lease term (months) is required'],
    min: [1, 'Lease term must be at least 1 month']
  },
  monthlyIncome: {
    type: Number,
    required: [true, 'Monthly income is required'],
    min: [0, 'Monthly income cannot be negative']
  },
  employmentStatus: {
    type: String,
    enum: Object.values(EmploymentStatus),
    required: [true, 'Employment status is required']
  },
  referenceContacts: {
    type: [referenceContactSchema],
    default: []
  },
  documents: {
    type: [applicationDocumentSchema],
    default: []
  },
  status: {
    type: String,
    enum: Object.values(TenantApplicationStatus),
    default: TenantApplicationStatus.SUBMITTED,
    required: true,
    index: true
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [4000, 'Notes cannot exceed 4000 characters']
  },
  submittedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  decidedAt: {
    type: Date
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

// Indexes for landlord/applicant dashboards and property pipeline views.
tenantApplicationSchema.index({ propertyId: 1, status: 1 });
tenantApplicationSchema.index({ applicantOxyUserId: 1, status: 1 });
tenantApplicationSchema.index({ landlordOxyUserId: 1, status: 1, submittedAt: -1 });

// Pre-save: stamp `decidedAt` when status transitions to a terminal state.
const TERMINAL_STATUSES = new Set([
  TenantApplicationStatus.APPROVED,
  TenantApplicationStatus.REJECTED,
  TenantApplicationStatus.WITHDRAWN
]);

tenantApplicationSchema.pre('save', function(this: any, next: any) {
  if (this.isModified('status') && TERMINAL_STATUSES.has(this.status) && !this.decidedAt) {
    this.decidedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('TenantApplication', tenantApplicationSchema);
