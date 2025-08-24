/**
 * Address Model
 * Modern ES module export for Address schema
 */

import { Schema, model, Document } from 'mongoose';
import validator from 'validator';

// Define the Address interface
export interface IAddress extends Document {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  neighborhood?: string;
  coordinates: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  fullAddress: string;
  location: string;
  getCoordinates(): { longitude: number; latitude: number } | null;
  setLocation(longitude: number, latitude: number): this;
}

const AddressSchema = new Schema({
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
      validator: function(v: string) {
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
        validator: function(coords: number[]) {
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
    transform: function(doc: any, ret: any) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Indexes for better query performance
AddressSchema.index({ city: 1, state: 1 });
AddressSchema.index({ zipCode: 1 });
AddressSchema.index({ coordinates: '2dsphere' });
AddressSchema.index({ street: 1, city: 1, state: 1, zipCode: 1 }, { unique: true });

// Virtual for full address
AddressSchema.virtual('fullAddress').get(function(this: IAddress) {
  return `${this.street}, ${this.city}, ${this.state} ${this.zipCode}`;
});

// Virtual for location string
AddressSchema.virtual('location').get(function(this: IAddress) {
  const parts = [];
  if (this.city) parts.push(this.city);
  if (this.state) parts.push(this.state);
  if (this.country && this.country !== 'USA') parts.push(this.country);
  return parts.join(', ');
});

// Static method to find or create address
AddressSchema.statics.findOrCreate = async function(addressData: any) {
  const { street, city, state, zipCode, country = 'USA', neighborhood, coordinates } = addressData;
  
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
    coordinates
  });

  return await address.save();
};

// Instance methods
AddressSchema.methods.getCoordinates = function(this: IAddress) {
  if (this.coordinates && this.coordinates.coordinates && this.coordinates.coordinates.length === 2) {
    return {
      longitude: this.coordinates.coordinates[0],
      latitude: this.coordinates.coordinates[1]
    };
  }
  return null;
};

AddressSchema.methods.setLocation = function(this: IAddress, longitude: number, latitude: number) {
  this.coordinates = {
    type: 'Point',
    coordinates: [longitude, latitude]
  };
  return this;
};

export default model<IAddress>('Address', AddressSchema);