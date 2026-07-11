/**
 * Agency Schema
 *
 * A property-management / landlord agency that reviews (and external listings)
 * can be attributed to, reviucasa-style. Agencies are DERIVED entities — they
 * are never created by an authenticated write endpoint. The ONLY write path is
 * the `findOrCreateByName` static, called when:
 *   - a tenant submits a review naming their managing agency, or
 *   - an external listing's portal contact AJAX exposes an agency name.
 *
 * Dedup is by `normalizedName` (diacritics-stripped, case-folded, whitespace-
 * collapsed) so trivially different spellings resolve to one agency. Each
 * agency is addressed publicly by a URL-safe, collision-suffixed `slug`.
 */

const mongoose = require('mongoose');
const { normalizeAgencyName, slugifyAgencyName } = require('../../utils/agencyName');

const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 120;
/** Bounded slug-suffix search before falling back to a timestamp suffix. */
const MAX_SLUG_ATTEMPTS = 50;

const agencySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Agency name is required'],
    trim: true,
    minlength: [MIN_NAME_LENGTH, 'Agency name must be at least 2 characters'],
    maxlength: [MAX_NAME_LENGTH, 'Agency name cannot exceed 120 characters']
  },
  // Canonical dedup key — one agency per normalized name. `unique` already
  // creates the backing index.
  normalizedName: {
    type: String,
    required: true,
    unique: true
  },
  // URL-safe public identifier (collision-suffixed: base, base-2, base-3, …).
  slug: {
    type: String,
    required: true,
    unique: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

/** True for a MongoDB duplicate-key error (either unique index). */
function isDuplicateKeyError(error: unknown): boolean {
  const code = (error as { code?: number } | null)?.code;
  return code === 11000 || code === 11001;
}

/**
 * Resolve a raw agency name to a persisted Agency, creating it on first sight.
 * The SOLE write path for the collection.
 *
 * Returns `null` when the name is empty / too short to identify an agency (the
 * caller simply skips agency attribution). Concurrency-safe: a `normalizedName`
 * race reuses the winner; a `slug` collision advances to the next suffix.
 */
agencySchema.statics.findOrCreateByName = async function findOrCreateByName(
  rawName: unknown
) {
  if (typeof rawName !== 'string') return null;
  const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
  const normalizedName = normalizeAgencyName(name);
  if (normalizedName.length < MIN_NAME_LENGTH) return null;

  const existing = await this.findOne({ normalizedName });
  if (existing) return existing;

  const baseSlug = slugifyAgencyName(name) || 'agency';

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
    try {
      return await this.create({ name, normalizedName, slug });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // A concurrent writer may have created the SAME agency (normalizedName
      // race) — reuse it. Otherwise it was only a slug collision: try the next
      // suffix.
      const raced = await this.findOne({ normalizedName });
      if (raced) return raced;
    }
  }

  // Deterministic suffixes exhausted (pathological): last-resort unique slug.
  return this.create({ name, normalizedName, slug: `${baseSlug}-${Date.now()}` });
};

module.exports = mongoose.model('Agency', agencySchema);
