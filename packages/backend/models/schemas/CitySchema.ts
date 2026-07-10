/**
 * City Schema
 *
 * A city in the DB-owned geo hierarchy. References its country and region by
 * `_id`; canonical country/region NAMES live on the Country/Region docs and are
 * read via populate (never duplicated here). Properties are counted by their
 * Address `cityId`. The set of neighborhoods is the Neighborhood collection
 * filtered by `cityId` (no free-text `popularNeighborhoods` array).
 */

const mongoose = require('mongoose');

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'];

const citySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'City name is required'],
    trim: true,
    maxlength: [100, 'City name cannot exceed 100 characters']
  },
  /** Owning country's `_id`. Canonical country name lives on the Country doc. */
  countryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Country',
    required: [true, 'City must belong to a country']
  },
  /** Owning region's `_id`. Canonical region name lives on the Region doc. */
  regionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Region',
    required: [true, 'City must belong to a region']
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
  averageRent: {
    type: Number,
    min: [0, 'Average rent must be positive']
  },
  currency: {
    type: String,
    enum: CURRENCY_CODES,
    default: 'EUR'
  },
  /**
   * The city's cover photo: the `_id` of an existing Image document (typically
   * a re-hosted listing photo linked by `cityCoverSyncService.ensureCover`).
   */
  coverImageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Image'
  },
  /** All of the city's photos, by Image `_id` (entityType 'city'). */
  imageIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Image'
  }],
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

// A city name is unique within its region.
citySchema.index({ regionId: 1, name: 1 }, { unique: true });
citySchema.index({ countryId: 1 });
citySchema.index({ regionId: 1 });
citySchema.index({ isActive: 1 });
citySchema.index({ propertiesCount: -1 });
citySchema.index({ name: 'text' });

// Virtual: neighborhoods belonging to this city (populate on demand).
citySchema.virtual('neighborhoods', {
  ref: 'Neighborhood',
  localField: '_id',
  foreignField: 'cityId'
});

// Static method to get popular cities (only those with a linked cover image).
citySchema.statics.getPopularCities = function(limit = 10) {
  return this.find({
    isActive: true,
    coverImageId: { $exists: true, $ne: null },
  })
    .sort({ propertiesCount: -1, name: 1 })
    .limit(limit);
};

/**
 * Recompute and persist this city's `propertiesCount` from the count of
 * published properties whose Address resolves to this city. Geo is relational,
 * so this counts by `Address.cityId` (no free-text city matching).
 */
citySchema.methods.updatePropertiesCount = async function() {
  const Property = mongoose.model('Property');
  const Address = mongoose.model('Address');

  const addresses = await Address.find({ cityId: this._id }).select('_id').lean();
  const addressIds = addresses.map((a: { _id: unknown }) => a._id);

  const count = addressIds.length === 0
    ? 0
    : await Property.countDocuments({ addressId: { $in: addressIds } });

  this.propertiesCount = count;
  this.lastUpdated = new Date();
  return this.save();
};

module.exports = mongoose.model('City', citySchema);
