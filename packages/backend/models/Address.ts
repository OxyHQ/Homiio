/**
 * Address Model
 * Modern ES module export for Address schema with international support
 */

import { Schema, model, Document, Model } from 'mongoose';
import crypto from 'crypto';

// Define the Address interface with new international fields
export interface IAddress extends Document {
  // Core location fields
  street: string;
  city: string;
  state?: string; // Made optional for international support
  postal_code: string; // Renamed from zipCode
  country: string; // No default
  countryCode: string; // ISO-2 country code
  
  // Detailed address components
  number?: string; // Building/house number
  building_name?: string; // Building or complex name
  block?: string; // Block identifier
  entrance?: string; // Entrance identifier
  floor?: string; // Floor number
  unit?: string; // Apartment/unit number
  subunit?: string; // Sub-unit within unit
  district?: string; // District/borough
  neighborhood?: string;
  address_lines: string[]; // Flexible address lines array
  
  // Land plot information
  land_plot?: {
    block?: string;
    lot?: string;
    parcel?: string;
  };
  
  // Flexible additional data
  extras?: any; // Mixed type for custom fields
  
  // Coordinates
  coordinates: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  
  // Computed fields
  normalizedKey: string; // SHA-1 hash for uniqueness
  fullAddress: string;
  location: string;
  
  // Methods
  getCoordinates(): { longitude: number; latitude: number } | null;
  setLocation(longitude: number, latitude: number): this;
  computeNormalizedKey(): string;
}

const AddressSchema = new Schema({
  // Core location fields
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
    required: false, // Made optional for international support
    trim: true,
    maxlength: [50, 'State name cannot exceed 50 characters']
  },
  postal_code: { // Renamed from zipCode
    type: String,
    required: [true, 'Postal code is required'],
    trim: true,
    maxlength: [20, 'Postal code cannot exceed 20 characters']
    // Removed hardcoded U.S. ZIP regex for international support
  },
  country: {
    type: String,
    required: [true, 'Country is required'],
    trim: true,
    maxlength: [50, 'Country name cannot exceed 50 characters']
    // Removed default: 'USA'
  },
  countryCode: {
    type: String,
    required: [true, 'Country code is required'],
    trim: true,
    uppercase: true,
    validate: {
      validator: function(v: string) {
        return /^[A-Z]{2}$/.test(v);
      },
      message: 'Country code must be a valid ISO-2 code (e.g., US, CA, GB)'
    }
  },
  
  // Detailed address components
  number: {
    type: String,
    trim: true,
    maxlength: [20, 'Building number cannot exceed 20 characters']
  },
  building_name: {
    type: String,
    trim: true,
    maxlength: [100, 'Building name cannot exceed 100 characters']
  },
  block: {
    type: String,
    trim: true,
    maxlength: [50, 'Block identifier cannot exceed 50 characters']
  },
  entrance: {
    type: String,
    trim: true,
    maxlength: [20, 'Entrance identifier cannot exceed 20 characters']
  },
  floor: {
    type: String,
    trim: true,
    maxlength: [10, 'Floor cannot exceed 10 characters']
  },
  unit: {
    type: String,
    trim: true,
    maxlength: [20, 'Unit number cannot exceed 20 characters']
  },
  subunit: {
    type: String,
    trim: true,
    maxlength: [20, 'Subunit cannot exceed 20 characters']
  },
  district: {
    type: String,
    trim: true,
    maxlength: [100, 'District name cannot exceed 100 characters']
  },
  neighborhood: {
    type: String,
    trim: true,
    maxlength: [100, 'Neighborhood name cannot exceed 100 characters']
  },
  address_lines: {
    type: [String],
    default: [],
    validate: {
      validator: function(lines: string[]) {
        return lines.length <= 5 && lines.every(line => line.length <= 200);
      },
      message: 'Address lines must be 5 or fewer, each under 200 characters'
    }
  },
  
  // Land plot information
  land_plot: {
    block: {
      type: String,
      trim: true,
      maxlength: [50, 'Land block cannot exceed 50 characters']
    },
    lot: {
      type: String,
      trim: true,
      maxlength: [50, 'Land lot cannot exceed 50 characters']
    },
    parcel: {
      type: String,
      trim: true,
      maxlength: [50, 'Land parcel cannot exceed 50 characters']
    }
  },
  
  // Flexible additional data
  extras: {
    type: Schema.Types.Mixed,
    default: {}
  },
  
  // Coordinates (required)
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
  },
  
  // Computed fields
  normalizedKey: {
    type: String,
    required: true,
    unique: true,
    index: true
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
AddressSchema.index({ coordinates: '2dsphere' }); // Keep 2dsphere index
AddressSchema.index({ city: 1, state: 1, countryCode: 1 }); // City/state/country lookup
AddressSchema.index({ postal_code: 1, countryCode: 1 }); // Postal code lookup

// Virtual for full address (international-aware)
AddressSchema.virtual('fullAddress').get(function(this: IAddress) {
  const parts = [];
  
  // Add number and street
  if (this.number && this.street) {
    parts.push(`${this.number} ${this.street}`);
  } else if (this.street) {
    parts.push(this.street);
  }
  
  // Add building name
  if (this.building_name) {
    parts.push(this.building_name);
  }
  
  // Add unit information
  if (this.unit) {
    parts.push(`Unit ${this.unit}`);
  }
  
  // Add city, state, postal code
  const locationParts = [];
  if (this.city) locationParts.push(this.city);
  if (this.state) locationParts.push(this.state);
  if (this.postal_code) locationParts.push(this.postal_code);
  
  if (locationParts.length > 0) {
    parts.push(locationParts.join(', '));
  }
  
  // Add country if not default
  if (this.country) {
    parts.push(this.country);
  }
  
  return parts.join(', ');
});

// Virtual for location string (international-aware)
AddressSchema.virtual('location').get(function(this: IAddress) {
  const parts = [];
  if (this.city) parts.push(this.city);
  if (this.state) parts.push(this.state);
  if (this.country) parts.push(this.country);
  return parts.join(', ');
});

// Static method to normalize field aliases
AddressSchema.statics.normalizeAliases = function(input: any) {
  const normalized = { ...input };
  
  // Unit synonyms
  if (input.puerta) normalized.unit = input.puerta;
  if (input.apartment) normalized.unit = input.apartment;
  if (input.suite) normalized.unit = input.suite;
  if (input.apt) normalized.unit = input.apt;
  if (input.piso) normalized.unit = input.piso;
  
  // Block synonyms
  if (input.bloque) normalized.block = input.bloque;
  if (input.torre) normalized.block = input.torre;
  if (input.tower) normalized.block = input.tower;
  if (input.building) normalized.block = input.building;
  
  // Floor synonyms
  if (input.planta) normalized.floor = input.planta;
  if (input.nivel) normalized.floor = input.nivel;
  if (input.level) normalized.floor = input.level;
  
  // Address line synonyms
  if (input.line1) {
    normalized.address_lines = normalized.address_lines || [];
    normalized.address_lines[0] = input.line1;
  }
  if (input.line2) {
    normalized.address_lines = normalized.address_lines || [];
    normalized.address_lines[1] = input.line2;
  }
  
  // Postal code synonyms
  if (input.zipCode) normalized.postal_code = input.zipCode;
  if (input.zip) normalized.postal_code = input.zip;
  if (input.postcode) normalized.postal_code = input.postcode;
  if (input.codigo_postal) normalized.postal_code = input.codigo_postal;
  
  // Country code normalization
  if (input.country && !input.countryCode) {
    // Simple country to code mapping (extend as needed)
    const countryCodeMap: { [key: string]: string } = {
      'United States': 'US',
      'USA': 'US',
      'Canada': 'CA',
      'United Kingdom': 'GB',
      'Spain': 'ES',
      'France': 'FR',
      'Germany': 'DE',
      'Italy': 'IT',
      'Mexico': 'MX',
      'Brazil': 'BR',
      'Argentina': 'AR',
      'Colombia': 'CO',
      'Chile': 'CL',
      'Peru': 'PE'
    };
    
    normalized.countryCode = countryCodeMap[input.country] || input.country.substring(0, 2).toUpperCase();
  }
  
  return normalized;
};

// Compute normalized key for uniqueness
AddressSchema.methods.computeNormalizedKey = function(this: IAddress): string {
  const keyFields = [
    this.street?.toLowerCase().trim(),
    this.number?.toLowerCase().trim(),
    this.unit?.toLowerCase().trim(),
    this.building_name?.toLowerCase().trim(),
    this.block?.toLowerCase().trim(),
    this.city?.toLowerCase().trim(),
    this.state?.toLowerCase().trim(),
    this.postal_code?.toLowerCase().trim(),
    this.countryCode?.toUpperCase()
  ].filter(field => field && field.length > 0);
  
  const keyString = keyFields.join('|');
  return crypto.createHash('sha1').update(keyString).digest('hex');
};

// Static method to find or create with canonical fields and coordinates
AddressSchema.statics.findOrCreateCanonical = async function(input: any) {
  if (!input.coordinates) {
    throw new Error('Coordinates are required for address creation');
  }
  
  // Normalize aliases first
  const normalizedInput = this.normalizeAliases(input);
  
  // Create a temporary instance to compute the normalized key
  const tempAddress = new this(normalizedInput);
  const normalizedKey = tempAddress.computeNormalizedKey();
  
  // First try to find existing address by normalized key
  let address = await this.findOne({ normalizedKey });
  
  if (address) {
    return address;
  }
  
  // Create new address if not found
  normalizedInput.normalizedKey = normalizedKey;
  address = new this(normalizedInput);
  
  return await address.save();
};

// Pre-save hook to compute normalized key
AddressSchema.pre('save', function(this: IAddress, next) {
  if (this.isModified() || this.isNew) {
    this.normalizedKey = this.computeNormalizedKey();
  }
  next();
});

// Static method to find or create address (legacy compatibility)
AddressSchema.statics.findOrCreate = async function(addressData: any) {
  console.warn('Address.findOrCreate is deprecated. Use findOrCreateCanonical instead.');
  return this.findOrCreateCanonical(addressData);
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

// Define model interface with static methods
interface IAddressModel extends Model<IAddress> {
  normalizeAliases(input: any): any;
  findOrCreateCanonical(addressData: any): Promise<IAddress>;
}

export default model<IAddress, IAddressModel>('Address', AddressSchema);