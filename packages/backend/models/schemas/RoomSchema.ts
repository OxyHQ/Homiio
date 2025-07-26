/**
 * Room Schema
 * Mongoose schema for Room model
 */

const mongoose = require('mongoose');
const validator = require('validator');

const roomSchema = new mongoose.Schema({
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required']
  },
  name: {
    type: String,
    required: [true, 'Room name is required'],
    trim: true,
    maxlength: [100, 'Room name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  type: {
    type: String,
    required: true,
    enum: ['bedroom', 'living_room', 'kitchen', 'bathroom', 'office', 'storage', 'other'],
    default: 'bedroom'
  },
  floor: {
    type: Number,
    min: [0, 'Floor cannot be negative'],
    default: 0
  },
  squareFootage: {
    type: Number,
    min: [0, 'Square footage cannot be negative']
  },
  dimensions: {
    length: {
      type: Number,
      min: [0, 'Length cannot be negative']
    },
    width: {
      type: Number,
      min: [0, 'Width cannot be negative']
    },
    height: {
      type: Number,
      min: [0, 'Height cannot be negative']
    },
    unit: {
      type: String,
      enum: ['feet', 'meters'],
      default: 'feet'
    }
  },
  rent: {
    amount: {
      type: Number,
      min: [0, 'Rent amount cannot be negative']
    },
    currency: {
      type: String,
      enum: ['USD', 'EUR', 'GBP', 'CAD'],
      default: 'USD'
    },
    included: {
      type: Boolean,
      default: true // Whether rent is included in property rent
    }
  },
  amenities: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  features: [{
    name: {
      type: String,
      required: true,
      trim: true
    },
    description: {
      type: String,
      trim: true
    }
  }],
  images: [{
    url: {
      type: String,
      required: true,
      validate: {
        validator: validator.isURL,
        message: 'Invalid image URL'
      }
    },
    caption: {
      type: String,
      maxlength: [200, 'Image caption cannot exceed 200 characters']
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],
  availability: {
    isAvailable: {
      type: Boolean,
      default: true
    },
    availableFrom: {
      type: Date,
      default: Date.now
    },
    availableUntil: {
      type: Date
    }
  },
  occupancy: {
    maxOccupants: {
      type: Number,
      min: [1, 'Maximum occupants must be at least 1'],
      default: 1
    },
    currentOccupants: {
      type: Number,
      min: [0, 'Current occupants cannot be negative'],
      default: 0
    },
    occupantIds: [{
      type: String // User IDs of current occupants
    }]
  },
  // Energy monitoring
  deviceId: {
    type: String,
    trim: true
  },
  sensors: [{
    type: {
      type: String,
      enum: ['temperature', 'humidity', 'light', 'motion', 'energy', 'air_quality'],
      required: true
    },
    sensorId: {
      type: String,
      required: true,
      trim: true
    },
    location: {
      type: String,
      trim: true
    },
    isActive: {
      type: Boolean,
      default: true
    },
    lastReading: {
      value: mongoose.Schema.Types.Mixed,
      timestamp: {
        type: Date,
        default: Date.now
      },
      unit: String
    }
  }],
  // Lease information
  currentLease: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lease'
  },
  leaseHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lease'
  }],
  status: {
    type: String,
    enum: ['available', 'occupied', 'maintenance', 'renovating', 'unavailable'],
    default: 'available'
  },
  maintenanceSchedule: [{
    type: {
      type: String,
      enum: ['cleaning', 'inspection', 'repair', 'upgrade'],
      required: true
    },
    scheduledDate: {
      type: Date,
      required: true
    },
    description: {
      type: String,
      trim: true
    },
    assignedTo: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
      default: 'scheduled'
    },
    completedDate: Date,
    notes: String
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
roomSchema.index({ propertyId: 1, type: 1 });
roomSchema.index({ status: 1, 'availability.isAvailable': 1 });
roomSchema.index({ 'occupancy.occupantIds': 1 });
roomSchema.index({ deviceId: 1 });

// Virtual for calculated square footage from dimensions
roomSchema.virtual('calculatedSquareFootage').get(function() {
  if (this.dimensions.length && this.dimensions.width) {
    return this.dimensions.length * this.dimensions.width;
  }
  return this.squareFootage || 0;
});

// Virtual for occupancy rate
roomSchema.virtual('occupancyRate').get(function() {
  if (this.occupancy.maxOccupants > 0) {
    return (this.occupancy.currentOccupants / this.occupancy.maxOccupants) * 100;
  }
  return 0;
});

// Virtual for primary image
roomSchema.virtual('primaryImage').get(function() {
  const primary = this.images.find(img => img.isPrimary);
  return primary || this.images[0] || null;
});

// Pre-save middleware
roomSchema.pre('save', function(next) {
  // Ensure only one primary image
  if (this.isModified('images')) {
    let hasPrimary = false;
    this.images.forEach((img) => {
      if (img.isPrimary && !hasPrimary) {
        hasPrimary = true;
      } else if (img.isPrimary && hasPrimary) {
        img.isPrimary = false;
      }
    });

    // If no primary image is set, make the first one primary
    if (!hasPrimary && this.images.length > 0) {
      this.images[0].isPrimary = true;
    }
  }

  // Update occupancy count based on occupantIds
  if (this.isModified('occupancy.occupantIds')) {
    this.occupancy.currentOccupants = this.occupancy.occupantIds.length;
  }

  next();
});

// Static methods
roomSchema.statics.findByProperty = function(propertyId, options = {}) {
  return this.find({ propertyId }, null, options);
};

roomSchema.statics.findAvailable = function(propertyId = null) {
  const query: any = {
    status: 'available',
    'availability.isAvailable': true
  };
  
  if (propertyId) {
    query.propertyId = propertyId;
  }

  return this.find(query);
};

roomSchema.statics.findByOccupant = function(occupantId) {
  return this.find({ 'occupancy.occupantIds': occupantId });
};

// Instance methods
roomSchema.methods.addOccupant = function(occupantId) {
  if (!this.occupancy.occupantIds.includes(occupantId) && 
      this.occupancy.currentOccupants < this.occupancy.maxOccupants) {
    this.occupancy.occupantIds.push(occupantId);
    this.occupancy.currentOccupants = this.occupancy.occupantIds.length;
    
    if (this.occupancy.currentOccupants >= this.occupancy.maxOccupants) {
      this.status = 'occupied';
      this.availability.isAvailable = false;
    }
    
    return this.save();
  }
  throw new Error('Cannot add occupant: room is full or occupant already exists');
};

roomSchema.methods.removeOccupant = function(occupantId) {
  this.occupancy.occupantIds.pull(occupantId);
  this.occupancy.currentOccupants = this.occupancy.occupantIds.length;
  
  if (this.occupancy.currentOccupants === 0) {
    this.status = 'available';
    this.availability.isAvailable = true;
  }
  
  return this.save();
};

roomSchema.methods.updateSensorReading = function(sensorId, value, unit = null) {
  const sensor = this.sensors.find(s => s.sensorId === sensorId);
  
  if (sensor) {
    sensor.lastReading = {
      value: value,
      timestamp: new Date(),
      unit: unit
    };
    return this.save();
  }
  
  throw new Error('Sensor not found');
};

roomSchema.methods.scheduleMaintenance = function(maintenanceData) {
  this.maintenanceSchedule.push({
    ...maintenanceData,
    status: 'scheduled'
  });
  return this.save();
};

module.exports = mongoose.model('Room', roomSchema);
