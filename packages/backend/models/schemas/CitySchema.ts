/**
 * City Schema
 * Mongoose schema for City model
 */

const mongoose = require('mongoose');

const citySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'City name is required'],
    trim: true,
    maxlength: [100, 'City name cannot exceed 100 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [50, 'State name cannot exceed 50 characters']
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    default: 'USA',
    maxlength: [50, 'Country name cannot exceed 50 characters']
  },
  coordinates: {
    lat: {
      type: Number,
      min: [-90, 'Latitude must be between -90 and 90'],
      max: [90, 'Latitude must be between -90 and 90']
    },
    lng: {
      type: Number,
      min: [-180, 'Longitude must be between -180 and 180'],
      max: [180, 'Longitude must be between -180 and 180']
    }
  },
  timezone: {
    type: String,
    trim: true,
    maxlength: [50, 'Timezone cannot exceed 50 characters']
  },
  population: {
    type: Number,
    min: [0, 'Population must be positive']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  popularNeighborhoods: [{
    type: String,
    trim: true,
    maxlength: [100, 'Neighborhood name cannot exceed 100 characters']
  }],
  averageRent: {
    type: Number,
    min: [0, 'Average rent must be positive']
  },
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'],
    default: 'USD'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  propertiesCount: {
    type: Number,
    default: 0,
    min: [0, 'Properties count cannot be negative']
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient querying
citySchema.index({ name: 1, state: 1, country: 1 }, { unique: true });
citySchema.index({ 'coordinates.lat': 1, 'coordinates.lng': 1 });
citySchema.index({ isActive: 1 });
citySchema.index({ propertiesCount: -1 });

// Text search index
citySchema.index({
  name: 'text',
  state: 'text',
  country: 'text',
  description: 'text'
});

// Virtual for full location string
citySchema.virtual('fullLocation').get(function() {
  return `${this.name}, ${this.state}, ${this.country}`;
});

// Virtual for display name
citySchema.virtual('displayName').get(function() {
  return `${this.name}, ${this.state}`;
});

// Static method to find cities by search term
citySchema.statics.findBySearch = function(searchTerm) {
  return this.find({
    $or: [
      { name: { $regex: searchTerm, $options: 'i' } },
      { state: { $regex: searchTerm, $options: 'i' } },
      { country: { $regex: searchTerm, $options: 'i' } }
    ],
    isActive: true
  }).sort({ propertiesCount: -1, name: 1 });
};

// Static method to get popular cities
citySchema.statics.getPopularCities = function(limit = 10) {
  return this.find({ isActive: true })
    .sort({ propertiesCount: -1, name: 1 })
    .limit(limit);
};

// Instance method to update properties count
citySchema.methods.updatePropertiesCount = async function() {
  const Property = mongoose.model('Property');
  const count = await Property.countDocuments({
    'address.city': this.name,
    'address.state': this.state,
    'address.country': this.country
  });
  
  this.propertiesCount = count;
  this.lastUpdated = new Date();
  return this.save();
};

// Pre-save middleware to ensure unique city names
citySchema.pre('save', async function(next) {
  if (this.isModified('name') || this.isModified('state') || this.isModified('country')) {
    const existingCity = await this.constructor.findOne({
      name: this.name,
      state: this.state,
      country: this.country,
      _id: { $ne: this._id }
    });
    
    if (existingCity) {
      return next(new Error('City already exists with this name, state, and country combination'));
    }
  }
  next();
});

module.exports = mongoose.model('City', citySchema); 