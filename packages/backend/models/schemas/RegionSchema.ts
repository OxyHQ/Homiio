/**
 * Region Schema
 *
 * A first-level administrative division within a country: a province, state or
 * autonomous community (e.g. Catalonia, Community of Madrid). The canonical home
 * of the region's display name; references its country by `_id`. Cities
 * reference a Region by `_id`.
 */

const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema({
  /** Owning country's `_id`. */
  countryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Country',
    required: [true, 'Region must belong to a country']
  },
  /**
   * Region code where well-defined (e.g. ISO-3166-2 subdivision code `ES-CT`).
   * Optional because not every region has a stable code.
   */
  code: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: [10, 'Region code cannot exceed 10 characters']
  },
  /** Canonical display name (e.g. `Catalonia`). */
  name: {
    type: String,
    required: [true, 'Region name is required'],
    trim: true,
    maxlength: [100, 'Region name cannot exceed 100 characters']
  },
  /**
   * The region's cover photo: the `_id` of an Image (`entityType: 'region'`,
   * `entityId` = this region's `_id`).
   */
  coverImageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Image'
  },
  /** All of the region's photos, by Image `_id` (entityType 'region'). */
  imageIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Image'
  }],
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// A region name is unique within its country (handles same-named regions across
// countries, e.g. "Valencia" province vs others).
regionSchema.index({ countryId: 1, name: 1 }, { unique: true });
regionSchema.index({ countryId: 1 });
regionSchema.index({ name: 'text' });

module.exports = mongoose.model('Region', regionSchema);
