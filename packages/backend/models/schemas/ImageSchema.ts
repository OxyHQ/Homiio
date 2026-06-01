/**
 * Image Schema
 *
 * The single, reusable image collection backing every photo in the product —
 * property listings, geo entities (city / region / country) and profiles. Each
 * stored photo is processed once through the Sharp pipeline (see
 * `services/imageUploadService`) into four variants (small / medium / large /
 * original) and uploaded to object storage; this document is the canonical
 * record of those variants, their bucket-relative storage keys, their public
 * URLs and the source metadata.
 *
 * An image is scoped to its owner via `{ entityType, entityId }`. Listing an
 * entity's photos is `Image.find({ entityType, entityId }).sort({ order: 1 })`,
 * served by the `{ entityType, entityId, order }` index.
 *
 * Property photos additionally keep a denormalized `{ url, caption, isPrimary }`
 * projection embedded on `Property.images` (preserving the historical read
 * shape) — this collection remains the source of truth for variants and keys.
 */

const mongoose = require('mongoose');

/** Entity kinds an image can belong to (mirrors `ImageEntityType` in shared-types). */
const IMAGE_ENTITY_TYPES = ['property', 'city', 'region', 'country', 'profile'];

/**
 * Per-variant string map (storage keys, then public URLs). Stored as a nested
 * object with the four fixed variant names so reads are a plain property access
 * (`image.urls.medium`) with no array scan. `_id: false` keeps it inline.
 */
const variantStringsSchema = new mongoose.Schema({
  original: { type: String, required: true, trim: true },
  small: { type: String, required: true, trim: true },
  medium: { type: String, required: true, trim: true },
  large: { type: String, required: true, trim: true }
}, { _id: false });

const imageSchema = new mongoose.Schema({
  /** Which kind of entity this image belongs to. */
  entityType: {
    type: String,
    enum: IMAGE_ENTITY_TYPES,
    required: [true, 'Image entityType is required'],
    index: true
  },
  /**
   * The owning entity's `_id` (Property / City / Region / Country / Profile).
   * Kept untyped-ref (no `ref`) because the collection it points at depends on
   * `entityType`; resolution is always scoped by the `{ entityType, entityId }`
   * pair rather than a single populate target.
   */
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: [true, 'Image entityId is required'],
    index: true
  },
  /** Bucket-relative object-storage keys for each processed variant. */
  keys: {
    type: variantStringsSchema,
    required: [true, 'Image storage keys are required']
  },
  /** Publicly resolvable URLs for each processed variant. */
  urls: {
    type: variantStringsSchema,
    required: [true, 'Image variant URLs are required']
  },
  /** Pixel width of the source image, when known. */
  width: {
    type: Number,
    min: [0, 'Image width cannot be negative']
  },
  /** Pixel height of the source image, when known. */
  height: {
    type: Number,
    min: [0, 'Image height cannot be negative']
  },
  /** Source image format (e.g. `jpeg`, `png`, `webp`). */
  format: {
    type: String,
    required: [true, 'Image format is required'],
    trim: true,
    lowercase: true,
    maxlength: [16, 'Image format cannot exceed 16 characters']
  },
  /** Byte size of the stored original variant. */
  bytes: {
    type: Number,
    required: [true, 'Image byte size is required'],
    min: [0, 'Image byte size cannot be negative']
  },
  /** Optional human caption. */
  caption: {
    type: String,
    trim: true,
    maxlength: [200, 'Image caption cannot exceed 200 characters']
  },
  /** Whether this is the entity's primary/cover image. */
  isPrimary: {
    type: Boolean,
    default: false
  },
  /** Sort order within the entity's image list (ascending). */
  order: {
    type: Number,
    default: 0,
    min: [0, 'Image order cannot be negative']
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Primary access pattern: an entity's ordered photo list.
imageSchema.index({ entityType: 1, entityId: 1, order: 1 });

module.exports = mongoose.model('Image', imageSchema);
