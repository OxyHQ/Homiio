/**
 * Tip Schema
 *
 * A tip/article in the Tips knowledge base (renting guides, safety, legal,
 * inspection, etc.). Surfaced by the `/tips` API: listing with pagination and
 * category/tag filters, lookup by `articleId` or `slug`, by category, featured,
 * and full-text search over title/description/content.
 *
 * `articleId` is the stable human-readable identifier used by the frontend and
 * is distinct from the Mongo `_id`. `slug` is the canonical, unique URL key.
 * `published` gates visibility so drafts can be staged without being served.
 */

const mongoose = require('mongoose');

const tipSchema = new mongoose.Schema({
  /** Stable human-readable identifier (e.g. 'first-time-renting'). */
  articleId: {
    type: String,
    required: [true, 'Tip articleId is required'],
    trim: true,
    unique: true,
    maxlength: [120, 'Tip articleId cannot exceed 120 characters']
  },
  /** Canonical URL slug, unique across the collection. */
  slug: {
    type: String,
    required: [true, 'Tip slug is required'],
    trim: true,
    unique: true,
    maxlength: [200, 'Tip slug cannot exceed 200 characters']
  },
  title: {
    type: String,
    required: [true, 'Tip title is required'],
    trim: true,
    maxlength: [200, 'Tip title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Tip description is required'],
    trim: true,
    maxlength: [1000, 'Tip description cannot exceed 1000 characters']
  },
  content: {
    type: String,
    required: [true, 'Tip content is required']
  },
  category: {
    type: String,
    required: [true, 'Tip category is required'],
    trim: true,
    maxlength: [60, 'Tip category cannot exceed 60 characters']
  },
  readTime: {
    type: String,
    trim: true,
    maxlength: [40, 'Tip readTime cannot exceed 40 characters']
  },
  /** Human-friendly relative publish label (e.g. '2 days ago'). */
  publishDate: {
    type: String,
    trim: true,
    maxlength: [60, 'Tip publishDate cannot exceed 60 characters']
  },
  icon: {
    type: String,
    trim: true,
    maxlength: [60, 'Tip icon cannot exceed 60 characters']
  },
  gradientColors: [{
    type: String,
    trim: true
  }],
  author: {
    type: String,
    trim: true,
    maxlength: [120, 'Tip author cannot exceed 120 characters']
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  featured: {
    type: Boolean,
    default: false
  },
  published: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

tipSchema.index({ category: 1 });
tipSchema.index({ tags: 1 });
tipSchema.index({ published: 1, featured: 1 });
tipSchema.index({ title: 'text', description: 'text', content: 'text' });

module.exports = mongoose.model('Tip', tipSchema);
