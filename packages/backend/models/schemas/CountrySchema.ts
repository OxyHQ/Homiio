/**
 * Country Schema
 *
 * Top of the DB-owned geo hierarchy. The canonical home of a country's display
 * name and default currency, keyed by its ISO-3166-1 alpha-2 code. Regions and
 * cities reference a Country by `_id`; an Address denormalizes only the
 * `countryCode` for fast filtering.
 */

const mongoose = require('mongoose');

const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'FAIR'];

const countrySchema = new mongoose.Schema({
  /** ISO-3166-1 alpha-2 code, uppercase (e.g. `ES`). Unique. */
  code: {
    type: String,
    required: [true, 'Country code is required'],
    trim: true,
    uppercase: true,
    unique: true,
    validate: {
      validator: function(v: string) {
        return /^[A-Z]{2}$/.test(v);
      },
      message: 'Country code must be a valid ISO-2 code (e.g. ES, US, GB)'
    }
  },
  /** Canonical English display name (e.g. `Spain`). */
  name: {
    type: String,
    required: [true, 'Country name is required'],
    trim: true,
    maxlength: [100, 'Country name cannot exceed 100 characters']
  },
  /** Default currency for the country. */
  currency: {
    type: String,
    enum: CURRENCY_CODES,
    default: 'EUR'
  },
  /** Optional emoji flag (e.g. `🇪🇸`). */
  flag: {
    type: String,
    trim: true,
    maxlength: [16, 'Flag cannot exceed 16 characters']
  },
  /** Optional BCP-47 default locale (e.g. `es-ES`). */
  defaultLocale: {
    type: String,
    trim: true,
    maxlength: [16, 'Default locale cannot exceed 16 characters']
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

countrySchema.index({ name: 'text' });

module.exports = mongoose.model('Country', countrySchema);
