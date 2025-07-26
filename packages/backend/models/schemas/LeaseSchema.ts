/**
 * Lease Schema
 * Mongoose schema for Lease model
 */

const mongoose = require('mongoose');

const paymentScheduleSchema = new mongoose.Schema({
  dueDate: {
    type: Date,
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Payment amount cannot be negative']
  },
  type: {
    type: String,
    enum: ['rent', 'deposit', 'fee', 'utility'],
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'overdue', 'cancelled'],
    default: 'pending'
  },
  paidDate: Date,
  paidAmount: {
    type: Number,
    min: [0, 'Paid amount cannot be negative']
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'check', 'bank_transfer', 'credit_card', 'debit_card', 'digital_wallet']
  },
  transactionId: String
}, { _id: true });

const leaseSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required']
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  },
  landlordProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Landlord profile ID is required']
  },
  tenantProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: [true, 'Tenant profile ID is required']
  },
  coTenants: [{
    profileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',
      required: true
    },
    role: {
      type: String,
      enum: ['primary', 'secondary', 'guarantor'],
      default: 'secondary'
    },
    signedDate: Date,
    status: {
      type: String,
      enum: ['pending', 'signed', 'declined'],
      default: 'pending'
    }
  }],
  leaseTerms: {
    startDate: {
      type: Date,
      required: [true, 'Lease start date is required']
    },
    endDate: {
      type: Date,
      required: [true, 'Lease end date is required']
    },
    renewalOptions: {
      type: String,
      enum: ['none', 'automatic', 'optional'],
      default: 'none'
    },
    renewalNoticeRequired: {
      type: Number,
      min: [0, 'Renewal notice period cannot be negative'],
      default: 30 // days
    },
    terminationNoticeRequired: {
      type: Number,
      min: [0, 'Termination notice period cannot be negative'],
      default: 30 // days
    }
  },
  rentDetails: {
    monthlyRent: {
      type: Number,
      required: [true, 'Monthly rent is required'],
      min: [0, 'Monthly rent cannot be negative']
    },
    currency: {
      type: String,
      enum: ['USD', 'EUR', 'GBP', 'CAD'],
      default: 'USD'
    },
    dueDate: {
      type: Number,
      min: [1, 'Due date must be between 1 and 31'],
      max: [31, 'Due date must be between 1 and 31'],
      default: 1 // day of month
    },
    lateFee: {
      amount: {
        type: Number,
        min: [0, 'Late fee cannot be negative'],
        default: 0
      },
      gracePeriod: {
        type: Number,
        min: [0, 'Grace period cannot be negative'],
        default: 5 // days
      }
    },
    securityDeposit: {
      type: Number,
      min: [0, 'Security deposit cannot be negative'],
      default: 0
    },
    petDeposit: {
      type: Number,
      min: [0, 'Pet deposit cannot be negative'],
      default: 0
    }
  },
  utilities: {
    included: [{
      type: String,
      enum: ['electricity', 'gas', 'water', 'trash', 'internet', 'cable', 'heat', 'air_conditioning']
    }],
    tenantResponsible: [{
      type: String,
      enum: ['electricity', 'gas', 'water', 'trash', 'internet', 'cable', 'heat', 'air_conditioning']
    }],
    sharedCosts: [{
      utility: {
        type: String,
        enum: ['electricity', 'gas', 'water', 'trash', 'internet', 'cable', 'heat', 'air_conditioning']
      },
      splitPercentage: {
        type: Number,
        min: [0, 'Split percentage cannot be negative'],
        max: [100, 'Split percentage cannot exceed 100']
      }
    }]
  },
  rules: {
    pets: {
      allowed: {
        type: Boolean,
        default: false
      },
      types: [{
        type: String,
        enum: ['dog', 'cat', 'bird', 'fish', 'reptile', 'other']
      }],
      maxNumber: {
        type: Number,
        min: [0, 'Maximum pets cannot be negative'],
        default: 0
      },
      restrictions: [String]
    },
    smoking: {
      type: Boolean,
      default: false
    },
    guests: {
      overnight: {
        allowed: {
          type: Boolean,
          default: true
        },
        maxConsecutiveDays: {
          type: Number,
          min: [0, 'Maximum consecutive days cannot be negative'],
          default: 7
        },
        maxDaysPerMonth: {
          type: Number,
          min: [0, 'Maximum days per month cannot be negative'],
          default: 14
        }
      },
      parties: {
        type: Boolean,
        default: false
      }
    },
    subletting: {
      type: Boolean,
      default: false
    },
    alterations: {
      type: Boolean,
      default: false
    }
  },
  signatures: {
    landlord: {
      signed: {
        type: Boolean,
        default: false
      },
      signedDate: Date,
      ipAddress: String,
      digitalSignature: String
    },
    tenant: {
      signed: {
        type: Boolean,
        default: false
      },
      signedDate: Date,
      ipAddress: String,
      digitalSignature: String
    }
  },
  documents: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    url: {
      type: String,
      required: true
    },
    type: {
      type: String,
      enum: ['lease_agreement', 'addendum', 'inspection_report', 'insurance', 'other'],
      default: 'other'
    },
    uploadedBy: {
      type: String,
      required: true
    },
    uploadedDate: {
      type: Date,
      default: Date.now
    }
  }],
  paymentSchedule: [paymentScheduleSchema],
  status: {
    type: String,
    enum: ['draft', 'pending_signatures', 'active', 'expired', 'terminated', 'cancelled'],
    default: 'draft'
  },
  inspections: [{
    type: {
      type: String,
      enum: ['move_in', 'move_out', 'periodic', 'maintenance'],
      required: true
    },
    scheduledDate: {
      type: Date,
      required: true
    },
    completedDate: Date,
    inspector: {
      type: String,
      required: true
    },
    findings: [{
      area: String,
      condition: {
        type: String,
        enum: ['excellent', 'good', 'fair', 'poor', 'needs_repair']
      },
      description: String,
      photos: [String]
    }],
    notes: String,
    signedByTenant: {
      type: Boolean,
      default: false
    },
    signedByLandlord: {
      type: Boolean,
      default: false
    }
  }],
  terminationNotice: {
    givenBy: String,
    givenDate: Date,
    effectiveDate: Date,
    reason: String,
    acknowledged: {
      type: Boolean,
      default: false
    },
    acknowledgedDate: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
leaseSchema.index({ propertyId: 1, status: 1 });
leaseSchema.index({ landlordProfileId: 1, status: 1 });
leaseSchema.index({ tenantProfileId: 1, status: 1 });
leaseSchema.index({ 'leaseTerms.startDate': 1, 'leaseTerms.endDate': 1 });
leaseSchema.index({ 'paymentSchedule.dueDate': 1, 'paymentSchedule.status': 1 });

// Virtual for lease duration
leaseSchema.virtual('leaseDuration').get(function() {
  if (this.leaseTerms.startDate && this.leaseTerms.endDate) {
    const diffTime = Math.abs(this.leaseTerms.endDate - this.leaseTerms.startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
  return 0;
});

// Virtual for monthly rent with currency
leaseSchema.virtual('formattedRent').get(function() {
  const amount = this.rentDetails.monthlyRent;
  const currency = this.rentDetails.currency;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount);
});

// Virtual for fully signed status
leaseSchema.virtual('isFullySigned').get(function() {
  const landlordSigned = this.signatures.landlord.signed;
  const tenantSigned = this.signatures.tenant.signed;
  const coTenantsSigned = this.coTenants.length === 0 || 
    this.coTenants.every(ct => ct.status === 'signed');
  
  return landlordSigned && tenantSigned && coTenantsSigned;
});

// Virtual for days until expiration
leaseSchema.virtual('daysUntilExpiration').get(function() {
  if (this.leaseTerms.endDate) {
    const now = new Date();
    const diffTime = this.leaseTerms.endDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }
  return null;
});

// Pre-save middleware
leaseSchema.pre('save', function(next) {
  // Auto-update status based on signatures
  if (this.isModified('signatures') || this.isModified('coTenants')) {
    if (this.isFullySigned && this.status === 'pending_signatures') {
      this.status = 'active';
    }
  }

  // Generate payment schedule if not exists and lease is active
  if (this.status === 'active' && this.paymentSchedule.length === 0) {
    this.generatePaymentSchedule();
  }

  next();
});

// Static methods
leaseSchema.statics.findByProperty = function(propertyId, options = {}) {
  return this.find({ propertyId }, null, options);
};

leaseSchema.statics.findByTenant = function(tenantProfileId, options = {}) {
  return this.find({ tenantProfileId }, null, options);
};

leaseSchema.statics.findByLandlord = function(landlordProfileId, options = {}) {
  return this.find({ landlordProfileId }, null, options);
};

leaseSchema.statics.findActive = function() {
  const now = new Date();
  return this.find({
    status: 'active',
    'leaseTerms.startDate': { $lte: now },
    'leaseTerms.endDate': { $gte: now }
  });
};

leaseSchema.statics.findExpiringSoon = function(days = 30) {
  const now = new Date();
  const futureDate = new Date(now.getTime() + (days * 24 * 60 * 60 * 1000));
  
  return this.find({
    status: 'active',
    'leaseTerms.endDate': {
      $gte: now,
      $lte: futureDate
    }
  });
};

// Instance methods
leaseSchema.methods.generatePaymentSchedule = function() {
  const startDate = new Date(this.leaseTerms.startDate);
  const endDate = new Date(this.leaseTerms.endDate);
  const monthlyRent = this.rentDetails.monthlyRent;
  const dueDay = this.rentDetails.dueDate;

  // Clear existing schedule
  this.paymentSchedule = [];

  // Add security deposit if applicable
  if (this.rentDetails.securityDeposit > 0) {
    this.paymentSchedule.push({
      dueDate: startDate,
      amount: this.rentDetails.securityDeposit,
      type: 'deposit',
      description: 'Security Deposit'
    });
  }

  // Generate monthly rent payments
  const currentDate = new Date(startDate.getFullYear(), startDate.getMonth(), dueDay);
  if (currentDate < startDate) {
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  while (currentDate <= endDate) {
    this.paymentSchedule.push({
      dueDate: new Date(currentDate),
      amount: monthlyRent,
      type: 'rent',
      description: `Monthly Rent - ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
    });
    
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return this.paymentSchedule;
};

leaseSchema.methods.signAsLandlord = function(ipAddress, digitalSignature) {
  this.signatures.landlord = {
    signed: true,
    signedDate: new Date(),
    ipAddress: ipAddress,
    digitalSignature: digitalSignature
  };

  if (this.signatures.tenant.signed) {
    this.status = 'active';
  } else {
    this.status = 'pending_signatures';
  }

  return this.save();
};

leaseSchema.methods.signAsTenant = function(ipAddress, digitalSignature) {
  this.signatures.tenant = {
    signed: true,
    signedDate: new Date(),
    ipAddress: ipAddress,
    digitalSignature: digitalSignature
  };

  if (this.signatures.landlord.signed) {
    this.status = 'active';
  } else {
    this.status = 'pending_signatures';
  }

  return this.save();
};

leaseSchema.methods.recordPayment = function(paymentId, amount, paymentMethod, transactionId) {
  const payment = this.paymentSchedule.id(paymentId);
  if (payment) {
    payment.status = 'paid';
    payment.paidDate = new Date();
    payment.paidAmount = amount;
    payment.paymentMethod = paymentMethod;
    payment.transactionId = transactionId;
    return this.save();
  }
  throw new Error('Payment not found');
};

leaseSchema.methods.scheduleInspection = function(inspectionData) {
  this.inspections.push({
    ...inspectionData,
    signedByTenant: false,
    signedByLandlord: false
  });
  return this.save();
};

module.exports = mongoose.model('Lease', leaseSchema);
