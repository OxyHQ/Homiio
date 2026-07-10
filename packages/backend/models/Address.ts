/**
 * Address Model
 *
 * A BUILDING-level record. Administrative geo is NOT stored as free text — it is
 * referenced by id into the DB-owned geo collections (Country / Region / City /
 * Neighborhood). The only denormalized geo field kept here is `countryCode`
 * (ISO-2) for fast filtering without a join.
 *
 * `findOrCreateCanonical` resolves the geo id chain via `geoResolutionService`
 * (from coordinates, falling back to provided place names) and stores the ids;
 * it never persists city/state/country strings.
 */

import { Schema, model, Document, Model, Types, type FilterQuery } from 'mongoose';
import { resolveGeo, type GeoNames } from '../services/geoResolutionService';

import * as crypto from 'crypto';

export interface IAddress extends Document {
  // ---- Relational geo references ----
  countryId: Types.ObjectId;
  regionId: Types.ObjectId;
  cityId: Types.ObjectId;
  neighborhoodId?: Types.ObjectId;
  /** ISO-2 country code — the only denormalized geo field. */
  countryCode: string;

  // ---- Building-level fields ----
  street: string;
  postal_code: string;
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  district?: string;
  address_lines: string[];
  po_box?: string;
  reference?: string;

  land_plot?: {
    block?: string;
    lot?: string;
    parcel?: string;
  };

  extras?: Record<string, unknown>;

  coordinates: {
    type: 'Point';
    coordinates: [number, number];
  };

  normalizedKey?: string;

  // Methods
  getCoordinates(): { longitude: number; latitude: number } | null;
  setLocation(longitude: number, latitude: number): this;
  getAddressLevel(): 'STREET' | 'BUILDING' | 'UNIT';
  /**
   * Project this address down to its street-level twin (no building/unit
   * identifying fields). The returned shape is also valid as a `findOne`
   * filter, so callers use it to find-or-create the parent level row.
   */
  createStreetLevel(): FilterQuery<IAddress>;
  createBuildingLevel(): FilterQuery<IAddress>;
  createUnitLevel(): FilterQuery<IAddress>;
  computeNormalizedKey(): string;
}

/** Input accepted by the static factories: building fields, coordinates and
 *  place NAMES (resolved to ids — never persisted as text) plus legacy aliases. */
export interface AddressCanonicalInput extends GeoNames {
  street: string;
  postal_code?: string;
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  district?: string;
  address_lines?: string[];
  po_box?: string;
  reference?: string;
  land_plot?: { block?: string; lot?: string; parcel?: string };
  extras?: Record<string, unknown>;
  coordinates?: { type?: string; coordinates: [number, number] };
  // Building-level aliases
  zipCode?: string;
  zip?: string;
  postcode?: string;
  codigo_postal?: string;
  puerta?: string;
  apartment?: string;
  suite?: string;
  apt?: string;
  piso?: string;
  bloque?: string;
  torre?: string;
  tower?: string;
  building?: string;
  planta?: string;
  nivel?: string;
  level?: string;
  line1?: string;
  line2?: string;
}

const AddressSchema = new Schema<IAddress, IAddressModel>({
  // ---- Relational geo references ----
  countryId: {
    type: Schema.Types.ObjectId,
    ref: 'Country',
    required: [true, 'Address must reference a country']
  },
  regionId: {
    type: Schema.Types.ObjectId,
    ref: 'Region',
    required: [true, 'Address must reference a region']
  },
  cityId: {
    type: Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'Address must reference a city']
  },
  neighborhoodId: {
    type: Schema.Types.ObjectId,
    ref: 'Neighborhood'
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

  // ---- Building-level fields ----
  street: {
    type: String,
    required: [true, 'Street address is required'],
    trim: true,
    maxlength: [200, 'Street address cannot exceed 200 characters']
  },
  postal_code: {
    type: String,
    required: [true, 'Postal code is required'],
    trim: true,
    maxlength: [20, 'Postal code cannot exceed 20 characters']
  },
  number: { type: String, trim: true, maxlength: [20, 'Building number cannot exceed 20 characters'] },
  building_name: { type: String, trim: true, maxlength: [100, 'Building name cannot exceed 100 characters'] },
  block: { type: String, trim: true, maxlength: [50, 'Block identifier cannot exceed 50 characters'] },
  entrance: { type: String, trim: true, maxlength: [20, 'Entrance identifier cannot exceed 20 characters'] },
  floor: { type: String, trim: true, maxlength: [10, 'Floor cannot exceed 10 characters'] },
  unit: { type: String, trim: true, maxlength: [20, 'Unit number cannot exceed 20 characters'] },
  subunit: { type: String, trim: true, maxlength: [20, 'Subunit cannot exceed 20 characters'] },
  district: { type: String, trim: true, maxlength: [100, 'District name cannot exceed 100 characters'] },
  address_lines: {
    type: [String],
    default: [],
    validate: {
      validator: function(lines: string[]) {
        return lines.length <= 5 && lines.every((line) => line.length <= 200);
      },
      message: 'Address lines must be 5 or fewer, each under 200 characters'
    }
  },
  po_box: { type: String, trim: true, maxlength: [20, 'PO Box cannot exceed 20 characters'] },
  reference: { type: String, trim: true, maxlength: [200, 'Reference cannot exceed 200 characters'] },

  land_plot: {
    block: { type: String, trim: true, maxlength: [50, 'Land block cannot exceed 50 characters'] },
    lot: { type: String, trim: true, maxlength: [50, 'Land lot cannot exceed 50 characters'] },
    parcel: { type: String, trim: true, maxlength: [50, 'Land parcel cannot exceed 50 characters'] }
  },

  extras: {
    type: Schema.Types.Mixed,
    default: {}
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
  },

  normalizedKey: {
    type: String,
    index: true,
    unique: true,
    sparse: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: unknown, ret: Record<string, unknown>) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ---- Indexes ----
AddressSchema.index({ coordinates: '2dsphere' });
AddressSchema.index({ cityId: 1 });
AddressSchema.index({ regionId: 1 });
AddressSchema.index({ countryId: 1 });
AddressSchema.index({ neighborhoodId: 1 });
AddressSchema.index({ postal_code: 1, countryCode: 1 });

// Populate-friendly virtuals for the geo entities (canonical names live there).
AddressSchema.virtual('country', { ref: 'Country', localField: 'countryId', foreignField: '_id', justOne: true });
AddressSchema.virtual('region', { ref: 'Region', localField: 'regionId', foreignField: '_id', justOne: true });
AddressSchema.virtual('city', { ref: 'City', localField: 'cityId', foreignField: '_id', justOne: true });
AddressSchema.virtual('neighborhood', { ref: 'Neighborhood', localField: 'neighborhoodId', foreignField: '_id', justOne: true });

/**
 * Normalize building-level field aliases. Geo NAMES (city/state/country/
 * neighborhood) are left untouched here — they are consumed by `resolveGeo` to
 * derive ids and are never written to the document.
 */
AddressSchema.static('normalizeAliases', function normalizeAliases(input: AddressCanonicalInput): AddressCanonicalInput {
  const normalized: AddressCanonicalInput = { ...input };

  if (input.puerta) normalized.unit = input.puerta;
  if (input.apartment) normalized.unit = input.apartment;
  if (input.suite) normalized.unit = input.suite;
  if (input.apt) normalized.unit = input.apt;
  if (input.piso) normalized.unit = input.piso;

  if (input.bloque) normalized.block = input.bloque;
  if (input.torre) normalized.block = input.torre;
  if (input.tower) normalized.block = input.tower;
  if (input.building) normalized.block = input.building;

  if (input.planta) normalized.floor = input.planta;
  if (input.nivel) normalized.floor = input.nivel;
  if (input.level) normalized.floor = input.level;

  if (input.line1) {
    normalized.address_lines = normalized.address_lines || [];
    normalized.address_lines[0] = input.line1;
  }
  if (input.line2) {
    normalized.address_lines = normalized.address_lines || [];
    normalized.address_lines[1] = input.line2;
  }

  if (input.zipCode) normalized.postal_code = input.zipCode;
  if (input.zip) normalized.postal_code = input.zip;
  if (input.postcode) normalized.postal_code = input.postcode;
  if (input.codigo_postal) normalized.postal_code = input.codigo_postal;

  return normalized;
});

/**
 * Deterministic dedup key for a building. Built from building-level fields plus
 * the resolved `cityId` and `countryCode` (geo is relational, so the city id —
 * not a free-text city string — anchors the building to its place).
 */
AddressSchema.methods.computeNormalizedKey = function(this: IAddress): string {
  const keyFields = [
    this.street?.toLowerCase().trim(),
    this.number?.toLowerCase().trim(),
    this.unit?.toLowerCase().trim(),
    this.building_name?.toLowerCase().trim(),
    this.block?.toLowerCase().trim(),
    this.postal_code?.toLowerCase().trim(),
    this.cityId ? String(this.cityId) : undefined,
    this.countryCode?.toUpperCase()
  ].filter((field): field is string => Boolean(field && field.length > 0));

  const keyString = keyFields.join('|');
  return crypto.createHash('sha1').update(keyString).digest('hex');
};

/**
 * Find or create a canonical building-level Address. Resolves the geo id chain
 * (Country/Region/City/Neighborhood) from coordinates — falling back to the
 * provided place names — via `resolveGeo`, then dedupes the building by its
 * normalized key.
 */
AddressSchema.static('findOrCreateCanonical', async function findOrCreateCanonical(
  this: IAddressModel,
  input: AddressCanonicalInput
): Promise<IAddress> {
  const normalizedInput = this.normalizeAliases(input);
  const coordinates = normalizedInput.coordinates?.coordinates;

  if (!coordinates) {
    throw new Error('Coordinates are required for address creation');
  }

  // Resolve the canonical geo id chain (upserts Country/Region/City/Neighborhood).
  const resolved = await resolveGeo({
    coordinates,
    names: {
      city: normalizedInput.city,
      state: normalizedInput.state,
      country: normalizedInput.country,
      countryCode: normalizedInput.countryCode,
      neighborhood: normalizedInput.neighborhood,
    },
  });

  const docFields = {
    street: normalizedInput.street,
    postal_code: normalizedInput.postal_code,
    number: normalizedInput.number,
    building_name: normalizedInput.building_name,
    block: normalizedInput.block,
    entrance: normalizedInput.entrance,
    floor: normalizedInput.floor,
    unit: normalizedInput.unit,
    subunit: normalizedInput.subunit,
    district: normalizedInput.district,
    address_lines: normalizedInput.address_lines,
    po_box: normalizedInput.po_box,
    reference: normalizedInput.reference,
    land_plot: normalizedInput.land_plot,
    extras: normalizedInput.extras,
    coordinates: {
      type: 'Point' as const,
      coordinates,
    },
    countryId: resolved.countryId,
    regionId: resolved.regionId,
    cityId: resolved.cityId,
    neighborhoodId: resolved.neighborhoodId,
    countryCode: resolved.countryCode,
  };

  const tempAddress = new this(docFields);
  const normalizedKey = tempAddress.computeNormalizedKey();

  const existing = await this.findOne({ normalizedKey });
  if (existing) {
    const [existingLng, existingLat] = existing.coordinates.coordinates;
    const [newLng, newLat] = coordinates;
    const coordDrift =
      Math.abs(existingLng - newLng) > 0.0005 || Math.abs(existingLat - newLat) > 0.0005;
    if (coordDrift) {
      existing.set('coordinates', { type: 'Point', coordinates: [newLng, newLat] });
      await existing.save();
    }
    return existing;
  }

  tempAddress.normalizedKey = normalizedKey;
  return tempAddress.save();
});

// Pre-save hook to (re)compute the normalized key.
AddressSchema.pre('save', function(this: IAddress, next) {
  if (this.isModified() || this.isNew) {
    this.normalizedKey = this.computeNormalizedKey();
  }
  next();
});

// ---- Instance methods ----
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
  this.coordinates = { type: 'Point', coordinates: [longitude, latitude] };
  return this;
};

AddressSchema.methods.getAddressLevel = function(this: IAddress) {
  if (this.floor || this.unit || this.subunit) {
    return 'UNIT';
  }
  if (this.number || this.building_name || this.block || this.entrance) {
    return 'BUILDING';
  }
  return 'STREET';
};

/**
 * Derive a STREET-level variant of this address (street + geo + coordinates,
 * no building/unit detail). Geo is relational, so the canonical
 * countryId/regionId/cityId/neighborhoodId references are carried over verbatim.
 */
AddressSchema.methods.createStreetLevel = function(this: IAddress): FilterQuery<IAddress> {
  return {
    street: this.street,
    postal_code: this.postal_code,
    district: this.district,
    countryId: this.countryId,
    regionId: this.regionId,
    cityId: this.cityId,
    neighborhoodId: this.neighborhoodId,
    countryCode: this.countryCode,
    coordinates: this.coordinates,
  };
};

/** Derive a BUILDING-level variant (street level + building identifiers). */
AddressSchema.methods.createBuildingLevel = function(this: IAddress): FilterQuery<IAddress> {
  return {
    ...this.createStreetLevel(),
    number: this.number,
    building_name: this.building_name,
    block: this.block,
    entrance: this.entrance,
    po_box: this.po_box,
    reference: this.reference,
  };
};

/** Derive a UNIT-level variant (building level + floor/unit/subunit). */
AddressSchema.methods.createUnitLevel = function(this: IAddress): FilterQuery<IAddress> {
  return {
    ...this.createBuildingLevel(),
    floor: this.floor,
    unit: this.unit,
    subunit: this.subunit,
  };
};

export interface IAddressModel extends Model<IAddress> {
  normalizeAliases(input: AddressCanonicalInput): AddressCanonicalInput;
  findOrCreateCanonical(input: AddressCanonicalInput): Promise<IAddress>;
}

export default model<IAddress, IAddressModel>('Address', AddressSchema);
