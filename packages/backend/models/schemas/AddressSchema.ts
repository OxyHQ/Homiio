/**
 * Address Schema
 * Mongoose schema for Address model
 * Extracted from Property to normalize address data
 */

const mongoose = require('mongoose');
const validator = require('validator');

const addressSchema = new mongoose.Schema({
  street: {
    type: String,
    required: [true, 'Street address is required'],
    trim: true,
    maxlength: [200, 'Street address cannot exceed 200 characters']
  },
  city: {
    type: String,
    required: [true, 'City is required'],
    trim: true,
    maxlength: [100, 'City name cannot exceed 100 characters']
  },
  state: {
    type: String,
    required: [true, 'State is required'],
    trim: true,
    maxlength: [50, 'State name cannot exceed 50 characters']
  },
  zipCode: {
    type: String,
    required: [true, 'ZIP code is required'],
    trim: true,
    validate: {
      validator: function(v) {
        return /^\d{5}(-\d{4})?$/.test(v);
      },
      message: 'ZIP code must be in format 12345 or 12345-6789'
    }
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    default: 'USA',
    maxlength: [50, 'Country name cannot exceed 50 characters']
  },
  neighborhood: {
    type: String,
    trim: true,
    maxlength: [100, 'Neighborhood name cannot exceed 100 characters']
  },
  showAddressNumber: {
    type: Boolean,
    default: true
  },
  coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function(coords) {
          if (!Array.isArray(coords) || coords.length !== 2) {
            return false;
          }
          const [lng, lat] = coords;
          return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
        },
        message: 'Coordinates must be an array [longitude, latitude] with valid ranges'
      }
    }
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for better query performance
addressSchema.index({ city: 1, state: 1 });
addressSchema.index({ zipCode: 1 });
addressSchema.index({ coordinates: '2dsphere' });
addressSchema.index({ street: 1, city: 1, state: 1, zipCode: 1 }, { unique: true }); // Prevent duplicate addresses

// Virtual for full address
addressSchema.virtual('fullAddress').get(function() {
  return `${this.street}, ${this.city}, ${this.state} ${this.zipCode}`;
});

// Virtual for location string
addressSchema.virtual('location').get(function() {
  const parts = [];
  if (this.city) parts.push(this.city);
  if (this.state) parts.push(this.state);
  if (this.country && this.country !== 'USA') parts.push(this.country);
  return parts.join(', ');
});

// Static method to find or create address
addressSchema.statics.findOrCreate = async function(addressData) {
  const { street, city, state, zipCode, country = 'USA', neighborhood, coordinates, showAddressNumber = true } = addressData;
  
  // First try to find existing address
  let address = await this.findOne({
    street: street.trim(),
    city: city.trim(),
    state: state.trim(),
    zipCode: zipCode.trim(),
    country: country.trim()
  });

  if (address) {
    return address;
  }

  // Create new address if not found
  address = new this({
    street: street.trim(),
    city: city.trim(),
    state: state.trim(),
    zipCode: zipCode.trim(),
    country: country.trim(),
    neighborhood,
    coordinates,
    showAddressNumber
  });

  return await address.save();
};

// Instance methods
addressSchema.methods.getCoordinates = function() {
  if (this.coordinates && this.coordinates.coordinates && this.coordinates.coordinates.length === 2) {
    return {
      longitude: this.coordinates.coordinates[0],
      latitude: this.coordinates.coordinates[1]
    };
  }
  return null;
};

addressSchema.methods.setLocation = function(longitude, latitude) {
  this.coordinates = {
    type: 'Point',
    coordinates: [longitude, latitude]
  };
  return this;
};

module.exports = mongoose.model('Address', addressSchema);