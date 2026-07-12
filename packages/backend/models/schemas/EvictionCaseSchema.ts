/**
 * EvictionCase Schema
 *
 * A PUBLIC, community-visible notice of an upcoming eviction (desalojo /
 * desahucio) so neighbours and activists can show up to help. Privacy-minimal
 * by design: NO tenant identity, NO unit-level address, and — when the reporter
 * marks the location `approximate` — the controller rounds the coordinates
 * before persisting so the exact home is never pinpointed.
 *
 * `attendees` (people who RSVP'd) are stored with `select: false` and are NEVER
 * serialized to the public DTO; only the aggregate `attendeeCount` is exposed.
 * `updates` is an owner-authored timeline (reschedules, status changes, notes).
 */

const mongoose = require('mongoose');
const validator = require('validator');
const { EvictionCaseStatus } = require('@homiio/shared-types');

const MAX_TITLE_LENGTH = 140;
const MAX_DESCRIPTION_LENGTH = 8000;
const MAX_LABEL_LENGTH = 200;
const MAX_CONTACT_FIELD_LENGTH = 100;
const MAX_INSTRUCTIONS_LENGTH = 1000;
const MAX_UPDATE_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;
const MAX_CITY_LENGTH = 120;

/** Owner-authored timeline entry. Keeps its own `_id` so it can be referenced. */
const evictionUpdateSchema = new mongoose.Schema({
  message: {
    type: String,
    required: [true, 'Update message is required'],
    trim: true,
    maxlength: [MAX_UPDATE_LENGTH, `Update message cannot exceed ${MAX_UPDATE_LENGTH} characters`]
  },
  newScheduledAt: { type: Date },
  newStatus: {
    type: String,
    enum: Object.values(EvictionCaseStatus)
  },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

/** One RSVP row. Never serialized publicly (`attendees` is `select: false`). */
const evictionAttendeeSchema = new mongoose.Schema({
  oxyUserId: { type: String, required: true },
  at: { type: Date, default: Date.now }
}, { _id: false });

const evictionContactInfoSchema = new mongoose.Schema({
  phone: { type: String, trim: true, maxlength: [MAX_CONTACT_FIELD_LENGTH, 'Phone is too long'] },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: [MAX_CONTACT_FIELD_LENGTH, 'Email is too long'],
    validate: {
      validator: (value: string) => !value || validator.isEmail(value),
      message: 'Invalid contact email'
    }
  },
  telegram: { type: String, trim: true, maxlength: [MAX_CONTACT_FIELD_LENGTH, 'Telegram handle is too long'] },
  whatsapp: { type: String, trim: true, maxlength: [MAX_CONTACT_FIELD_LENGTH, 'WhatsApp is too long'] },
  instructions: { type: String, trim: true, maxlength: [MAX_INSTRUCTIONS_LENGTH, 'Instructions are too long'] }
}, { _id: false });

const evictionLocationSchema = new mongoose.Schema({
  label: {
    type: String,
    required: [true, 'Location label is required'],
    trim: true,
    maxlength: [MAX_LABEL_LENGTH, `Location label cannot exceed ${MAX_LABEL_LENGTH} characters`]
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
        // GeoJSON [longitude, latitude] with valid ranges (copied from Address).
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
  precision: {
    type: String,
    enum: ['exact', 'approximate'],
    default: 'approximate'
  },
  city: { type: String, trim: true, maxlength: [MAX_CITY_LENGTH, 'City is too long'] },
  countryCode: {
    type: String,
    trim: true,
    uppercase: true,
    validate: {
      validator: (value: string) => !value || /^[A-Z]{2}$/.test(value),
      message: 'Country code must be a valid ISO-2 code (e.g., US, ES, GB)'
    }
  }
}, { _id: false });

const evictionCaseSchema = new mongoose.Schema({
  oxyUserId: {
    type: String,
    required: [true, 'Oxy user ID is required'],
    index: true
  },
  title: {
    type: String,
    required: [true, 'Title is required'],
    trim: true,
    maxlength: [MAX_TITLE_LENGTH, `Title cannot exceed ${MAX_TITLE_LENGTH} characters`]
  },
  description: {
    type: String,
    required: [true, 'Description is required'],
    trim: true,
    maxlength: [MAX_DESCRIPTION_LENGTH, `Description cannot exceed ${MAX_DESCRIPTION_LENGTH} characters`]
  },
  location: {
    type: evictionLocationSchema,
    required: [true, 'Location is required']
  },
  scheduledAt: {
    type: Date,
    required: [true, 'Scheduled date is required']
  },
  status: {
    type: String,
    enum: Object.values(EvictionCaseStatus),
    default: EvictionCaseStatus.UPCOMING,
    index: true
  },
  // Ref by NAME only — the Agency model is registered by the reviews branch.
  // Mongoose refs-by-name don't require the model at compile time, so this
  // stays dependency-free until both features merge.
  agencyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Agency',
    index: true
  },
  contactInfo: { type: evictionContactInfoSchema },
  coverImage: {
    imageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Image' },
    url: { type: String, trim: true, maxlength: [MAX_URL_LENGTH, 'Cover image URL is too long'] }
  },
  updates: { type: [evictionUpdateSchema], default: [] },
  // RSVP roster — never serialized to the public DTO.
  attendees: { type: [evictionAttendeeSchema], default: [], select: false },
  attendeeCount: { type: Number, default: 0, min: 0 },
  // Server-only bookkeeping for the once-per-case outcome-reminder nudge (set by
  // evictionOutcomeReminderService when a case's date is >24h past and still
  // `upcoming`). Never client-settable — absent from CREATABLE/EDITABLE fields.
  outcomeReminderSentAt: { type: Date }
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

// Public board queries: filter by status, order by scheduled date.
evictionCaseSchema.index({ status: 1, scheduledAt: 1 });
// Geospatial board queries (bbox / nearby).
evictionCaseSchema.index({ 'location.coordinates': '2dsphere' });
// "My cases" lookups.
evictionCaseSchema.index({ oxyUserId: 1, createdAt: -1 });

module.exports = mongoose.model('EvictionCase', evictionCaseSchema);
