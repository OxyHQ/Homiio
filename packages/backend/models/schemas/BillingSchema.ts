const mongoose = require('mongoose');

const billingSchema = new mongoose.Schema({
  oxyUserId: {
    type: String,
    required: true,
  },
  plusActive: {
    type: Boolean,
    default: false,
  },
  plusSince: {
    type: Date,
  },
  plusCanceledAt: {
    type: Date,
  },
  plusStripeSubscriptionId: {
    type: String,
  },
  fileCredits: {
    type: Number,
    default: 0,
  },
  lastPaymentAt: {
    type: Date,
  },
  processedSessions: {
    type: [String],
    default: [],
  },
  founderSupporter: {
    type: Boolean,
    default: false,
  },
  founderSince: {
    type: Date,
  },
}, {
  timestamps: true,
});

// Indexes for efficient queries
billingSchema.index({ oxyUserId: 1 }, { unique: true });
billingSchema.index({ plusActive: 1 });
billingSchema.index({ plusStripeSubscriptionId: 1 });

// Static methods
billingSchema.statics.findByOxyUserId = function(oxyUserId) {
  return this.findOne({ oxyUserId });
};

billingSchema.statics.findByStripeSubscriptionId = function(subscriptionId) {
  return this.findOne({ plusStripeSubscriptionId: subscriptionId });
};

billingSchema.statics.findActiveSubscriptions = function() {
  return this.find({ plusActive: true });
};

// Instance methods
billingSchema.methods.addFileCredit = function(amount = 1) {
  this.fileCredits += amount;
  this.lastPaymentAt = new Date();
  return this.save();
};

billingSchema.methods.consumeFileCredit = function() {
  if (this.plusActive) {
    return Promise.resolve({ consumed: false, remaining: 'unlimited' });
  }
  
  if (this.fileCredits <= 0) {
    throw new Error('No file credits available');
  }
  
  this.fileCredits -= 1;
  return this.save().then(() => ({ consumed: true, remaining: this.fileCredits }));
};

billingSchema.methods.activatePlus = function(stripeSubscriptionId) {
  this.plusActive = true;
  this.plusSince = new Date();
  this.lastPaymentAt = new Date();
  
  if (stripeSubscriptionId) {
    this.plusStripeSubscriptionId = stripeSubscriptionId;
  }
  
  return this.save();
};

billingSchema.methods.deactivatePlus = function() {
  this.plusActive = false;
  this.plusStripeSubscriptionId = undefined;
  return this.save();
};

billingSchema.methods.addProcessedSession = function(sessionId) {
  if (!this.processedSessions.includes(sessionId)) {
    this.processedSessions.push(sessionId);
  }
  return this.save();
};

billingSchema.methods.isSessionProcessed = function(sessionId) {
  return this.processedSessions.includes(sessionId);
};

// Pre-save middleware to ensure unique oxyUserId
billingSchema.pre('save', async function(next) {
  if (this.isNew) {
    const existing = await this.constructor.findOne({ oxyUserId: this.oxyUserId });
    if (existing) {
      throw new Error(`Billing record already exists for Oxy user: ${this.oxyUserId}`);
    }
  }
  next();
});

module.exports = mongoose.model('Billing', billingSchema);
