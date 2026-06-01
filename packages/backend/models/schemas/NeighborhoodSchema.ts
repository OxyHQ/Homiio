/**
 * Neighborhood Schema
 *
 * A neighborhood (quarter / suburb / barrio) within a city. The canonical home
 * of the neighborhood's display name; references its city by `_id`. An Address
 * may reference a Neighborhood by `_id` when geo-resolution finds a match.
 * `popularNeighborhoods` on a city is DERIVED from this collection (not a
 * free-text array).
 */

const mongoose = require('mongoose');

const neighborhoodSchema = new mongoose.Schema({
  /** Owning city's `_id`. */
  cityId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'City',
    required: [true, 'Neighborhood must belong to a city']
  },
  name: {
    type: String,
    required: [true, 'Neighborhood name is required'],
    trim: true,
    maxlength: [120, 'Neighborhood name cannot exceed 120 characters']
  },
  /** Optional centroid for map framing. */
  centroid: {
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
  /** Optional bounding box, GeoJSON-style [west, south, east, north]. */
  bbox: {
    type: [Number],
    validate: {
      validator: function(v: number[]) {
        return v === undefined || v.length === 0 || v.length === 4;
      },
      message: 'bbox must be [west, south, east, north]'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// A neighborhood name is unique within its city.
neighborhoodSchema.index({ cityId: 1, name: 1 }, { unique: true });
neighborhoodSchema.index({ cityId: 1 });

module.exports = mongoose.model('Neighborhood', neighborhoodSchema);
