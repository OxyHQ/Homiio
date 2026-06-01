/**
 * PlacePoi Schema (persisted nearby-services cache)
 *
 * The DB-backed cache of nearby-points-of-interest lookups. For a coordinate
 * CELL (lat/lng rounded to a fixed precision) at a given search radius, it
 * stores the aggregate per-category result (presence / count / nearest-distance)
 * sourced from OpenStreetMap's Overpass API, plus when it was fetched and when
 * it goes stale.
 *
 * This replaces the previous in-memory-only cache so a fresh cell is served
 * straight from MongoDB without ever calling Overpass — sharing results across
 * processes/instances and surviving restarts. `nearbyServicesService` reads this
 * collection first and only hits Overpass on a miss or a stale row.
 *
 * The result is deliberately aggregate-only and never stores individual place
 * names (consistent with the API contract).
 */

const mongoose = require('mongoose');

/** Stable nearby-service category keys (mirrors `NearbyServiceKey` in shared-types). */
const NEARBY_SERVICE_KEYS = [
  'pharmacy',
  'school',
  'hospital',
  'police',
  'fire_station',
  'supermarket',
  'transit',
  'park',
  'bank',
  'restaurant',
  'gym',
  'spa',
];

/** One persisted per-category presence summary (no place names, by design). */
const categorySchema = new mongoose.Schema({
  key: {
    type: String,
    enum: NEARBY_SERVICE_KEYS,
    required: [true, 'Category key is required']
  },
  /** Whether at least one place of this category exists within the radius. */
  present: {
    type: Boolean,
    required: true,
    default: false
  },
  /** Number of matching places found within the radius (0 when absent). */
  count: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Count cannot be negative']
  },
  /** Straight-line distance, in metres, to the nearest match; null when absent. */
  nearestM: {
    type: Number,
    default: null,
    min: [0, 'Nearest distance cannot be negative']
  }
}, { _id: false });

const placePoiSchema = new mongoose.Schema({
  /**
   * Canonical cache key: `"{lat},{lng}@{radiusM}"` with lat/lng rounded to the
   * service's cell precision. Unique — one row per coordinate cell + radius.
   */
  cellKey: {
    type: String,
    required: [true, 'Cell key is required']
  },
  /** Rounded cell-anchor latitude (the value embedded in `cellKey`). */
  lat: {
    type: Number,
    required: true,
    min: [-90, 'Latitude must be between -90 and 90'],
    max: [90, 'Latitude must be between -90 and 90']
  },
  /** Rounded cell-anchor longitude (the value embedded in `cellKey`). */
  lng: {
    type: Number,
    required: true,
    min: [-180, 'Longitude must be between -180 and 180'],
    max: [180, 'Longitude must be between -180 and 180']
  },
  /** Search radius, in metres, this result was computed for. */
  radiusM: {
    type: Number,
    required: true,
    min: [1, 'Radius must be positive']
  },
  /** One entry per category (every key present; absent ones have present:false). */
  categories: {
    type: [categorySchema],
    required: true,
    default: []
  },
  /** When this snapshot was fetched from Overpass. */
  fetchedAt: {
    type: Date,
    required: true,
    default: Date.now
  },
  /**
   * When this row is considered stale and eligible for deletion. A MongoDB TTL
   * index removes expired rows automatically; the service also treats rows past
   * this instant as a miss and refreshes them.
   */
  expiresAt: {
    type: Date,
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Primary lookup is by the exact cell key.
placePoiSchema.index({ cellKey: 1 }, { unique: true });
// TTL index: MongoDB purges rows once `expiresAt` passes (expireAfterSeconds 0
// means "expire exactly at the stored date").
placePoiSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('PlacePoi', placePoiSchema);
