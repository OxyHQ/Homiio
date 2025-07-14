/**
 * Energy Data Schema
 * Mongoose schema for energy monitoring data
 */

const mongoose = require('mongoose');

const energyDataSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: [true, 'Device ID is required'],
    trim: true
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required']
  },
  roomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room'
  },
  sensorId: {
    type: String,
    required: [true, 'Sensor ID is required'],
    trim: true
  },
  sensorType: {
    type: String,
    required: true,
    enum: ['electricity', 'gas', 'water', 'temperature', 'humidity', 'light', 'motion', 'air_quality', 'pressure']
  },
  reading: {
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: [true, 'Reading value is required']
    },
    unit: {
      type: String,
      required: [true, 'Unit is required'],
      trim: true
    },
    quality: {
      type: String,
      enum: ['good', 'fair', 'poor', 'error'],
      default: 'good'
    }
  },
  metadata: {
    location: {
      type: String,
      trim: true
    },
    description: {
      type: String,
      trim: true
    },
    calibrationDate: Date,
    batteryLevel: {
      type: Number,
      min: [0, 'Battery level cannot be negative'],
      max: [100, 'Battery level cannot exceed 100']
    },
    signalStrength: {
      type: Number,
      min: [-100, 'Signal strength cannot be less than -100'],
      max: [0, 'Signal strength cannot be greater than 0']
    }
  },
  processed: {
    hourlyAverage: Number,
    dailyTotal: Number,
    weeklyTotal: Number,
    monthlyTotal: Number,
    trends: {
      hourly: [{
        hour: Number,
        value: Number
      }],
      daily: [{
        date: Date,
        value: Number
      }],
      weekly: [{
        week: Number,
        year: Number,
        value: Number
      }],
      monthly: [{
        month: Number,
        year: Number,
        value: Number
      }]
    },
    anomalies: [{
      type: {
        type: String,
        enum: ['spike', 'drop', 'unusual_pattern', 'sensor_error']
      },
      severity: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical']
      },
      description: String,
      detectedAt: {
        type: Date,
        default: Date.now
      },
      resolved: {
        type: Boolean,
        default: false
      },
      resolvedAt: Date
    }]
  },
  cost: {
    rate: {
      type: Number,
      min: [0, 'Cost rate cannot be negative']
    },
    currency: {
      type: String,
      enum: ['USD', 'EUR', 'GBP', 'CAD'],
      default: 'USD'
    },
    calculatedCost: {
      type: Number,
      min: [0, 'Calculated cost cannot be negative']
    },
    billingPeriod: {
      type: String,
      enum: ['hourly', 'daily', 'monthly'],
      default: 'monthly'
    }
  },
  timestamp: {
    type: Date,
    required: [true, 'Timestamp is required'],
    default: Date.now
  },
  source: {
    type: String,
    enum: ['sensor', 'manual', 'api', 'calculated'],
    default: 'sensor'
  },
  isValid: {
    type: Boolean,
    default: true
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient querying
energyDataSchema.index({ deviceId: 1, sensorType: 1, timestamp: -1 });
energyDataSchema.index({ propertyId: 1, sensorType: 1, timestamp: -1 });
energyDataSchema.index({ roomId: 1, sensorType: 1, timestamp: -1 });
energyDataSchema.index({ timestamp: -1, sensorType: 1 });

// TTL index to automatically delete old data (optional - keep 2 years)
energyDataSchema.index({ timestamp: 1 }, { expireAfterSeconds: 63072000 }); // 2 years

// Virtual for formatted reading
energyDataSchema.virtual('formattedReading').get(function() {
  return `${this.reading.value} ${this.reading.unit}`;
});

// Virtual for cost per unit
energyDataSchema.virtual('costPerUnit').get(function() {
  if (this.cost.rate && this.reading.value) {
    return (this.cost.rate * parseFloat(this.reading.value)).toFixed(4);
  }
  return 0;
});

// Pre-save middleware for data validation and processing
energyDataSchema.pre('save', function(next) {
  // Validate reading based on sensor type
  if (this.isModified('reading') || this.isNew) {
    const value = parseFloat(this.reading.value);
    
    switch (this.sensorType) {
      case 'temperature':
        if (value < -50 || value > 60) {
          this.reading.quality = 'poor';
        }
        break;
      case 'humidity':
        if (value < 0 || value > 100) {
          this.reading.quality = 'error';
          this.isValid = false;
        }
        break;
      case 'electricity':
        if (value < 0) {
          this.reading.quality = 'error';
          this.isValid = false;
        }
        break;
    }
  }

  // Calculate cost if rate is provided
  if (this.cost.rate && this.reading.value && !this.cost.calculatedCost) {
    this.cost.calculatedCost = this.cost.rate * parseFloat(this.reading.value);
  }

  next();
});

// Static methods
energyDataSchema.statics.findByDevice = function(deviceId, options = {}) {
  return this.find({ deviceId, isValid: true }, null, options);
};

energyDataSchema.statics.findByProperty = function(propertyId, options = {}) {
  return this.find({ propertyId, isValid: true }, null, options);
};

energyDataSchema.statics.findByRoom = function(roomId, options = {}) {
  return this.find({ roomId, isValid: true }, null, options);
};

energyDataSchema.statics.findBySensorType = function(sensorType, options = {}) {
  return this.find({ sensorType, isValid: true }, null, options);
};

energyDataSchema.statics.findByDateRange = function(startDate, endDate, filters = {}) {
  return this.find({
    timestamp: {
      $gte: startDate,
      $lte: endDate
    },
    isValid: true,
    ...filters
  });
};

energyDataSchema.statics.getAggregatedData = function(groupBy, filters = {}) {
  const matchStage = {
    isValid: true,
    ...filters
  };

  let groupId;
  switch (groupBy) {
    case 'hour':
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
        hour: { $hour: '$timestamp' },
        sensorType: '$sensorType'
      };
      break;
    case 'day':
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
        sensorType: '$sensorType'
      };
      break;
    case 'month':
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        sensorType: '$sensorType'
      };
      break;
    default:
      groupId = '$sensorType';
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: groupId,
        count: { $sum: 1 },
        avgValue: { $avg: { $toDouble: '$reading.value' } },
        minValue: { $min: { $toDouble: '$reading.value' } },
        maxValue: { $max: { $toDouble: '$reading.value' } },
        totalCost: { $sum: '$cost.calculatedCost' },
        firstReading: { $first: '$timestamp' },
        lastReading: { $last: '$timestamp' }
      }
    },
    { $sort: { '_id': 1 } }
  ]);
};

// Instance methods
energyDataSchema.methods.detectAnomaly = function() {
  // Simple anomaly detection logic
  const value = parseFloat(this.reading.value);
  
  // This would typically involve more sophisticated algorithms
  // For now, just check for extreme values
  const anomalies = [];
  
  if (this.sensorType === 'electricity' && value > 10000) {
    anomalies.push({
      type: 'spike',
      severity: 'high',
      description: 'Unusually high electricity consumption detected'
    });
  }
  
  if (this.sensorType === 'temperature' && (value < -10 || value > 40)) {
    anomalies.push({
      type: 'unusual_pattern',
      severity: 'medium',
      description: 'Temperature reading outside normal range'
    });
  }

  if (this.reading.quality === 'error') {
    anomalies.push({
      type: 'sensor_error',
      severity: 'critical',
      description: 'Sensor error detected'
    });
  }

  this.processed.anomalies = this.processed.anomalies || [];
  this.processed.anomalies.push(...anomalies);

  return anomalies;
};

energyDataSchema.methods.calculateCost = function(rate, currency = 'USD') {
  const value = parseFloat(this.reading.value);
  if (value && rate) {
    this.cost.rate = rate;
    this.cost.currency = currency;
    this.cost.calculatedCost = rate * value;
    return this.cost.calculatedCost;
  }
  return 0;
};

module.exports = mongoose.model('EnergyData', energyDataSchema);
