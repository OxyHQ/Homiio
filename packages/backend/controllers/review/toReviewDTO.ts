/**
 * Review DTO serializer — the single serialization chokepoint for every review
 * read path.
 *
 * Converts a Review Mongoose document (optionally populated with its `agencyId`
 * and `addressId`) into the flat DTO the frontend consumes:
 *   - `_id` → `id`,
 *   - `helpfulCount` derived from `helpfulVoters.length`,
 *   - `viewerHasVotedHelpful` from the optional requesting viewer,
 *   - an inline `agency { id, name, slug }` projection when `agencyId` is
 *     populated,
 *   - a `populatedAddress` projection when `addressId` is populated.
 *
 * CRITICAL: `helpfulVoters` and `reports` are STRIPPED — they are internal
 * moderation/audit data and must never reach a client.
 *
 * The shape mirrors `ReviewDTO` in `@homiio/shared-types`, which treats the
 * Mongoose schema as the single authority.
 */

const mongoose = require('mongoose');

type Loose = Record<string, unknown>;

interface HasToJSON {
  toJSON(): Loose;
}

function hasToJSON(value: unknown): value is HasToJSON {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  );
}

function plain(value: unknown): Loose {
  if (hasToJSON(value)) {
    return value.toJSON();
  }
  return (value ?? {}) as Loose;
}

function refToId(ref: unknown): string | undefined {
  if (ref === null || ref === undefined) return undefined;
  if (ref instanceof mongoose.Types.ObjectId) return ref.toString();
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'object') {
    const obj = ref as { _id?: unknown; id?: unknown };
    if (obj._id !== undefined && obj._id !== null) return String(obj._id);
    if (obj.id !== undefined && obj.id !== null) return String(obj.id);
  }
  return String(ref);
}

/** Build the inline agency summary, but only when `agencyId` is populated. */
function agencySummary(ref: unknown): { id: string; name: string; slug: string } | undefined {
  if (!ref || typeof ref !== 'object' || ref instanceof mongoose.Types.ObjectId) {
    return undefined;
  }
  const obj = plain(ref);
  if (typeof obj.name !== 'string' || typeof obj.slug !== 'string') {
    return undefined;
  }
  const id = refToId(obj._id ?? obj.id);
  if (!id) return undefined;
  return { id, name: obj.name, slug: obj.slug };
}

/** Return the populated address as a plain object (with `id`), or undefined for a bare id ref. */
function populatedAddress(ref: unknown): Loose | undefined {
  if (!ref || typeof ref !== 'object' || ref instanceof mongoose.Types.ObjectId) {
    return undefined;
  }
  const obj = plain(ref);
  const id = refToId(obj._id ?? obj.id);
  return id ? { ...obj, id } : { ...obj };
}

/**
 * Serialize a review document/lean-object into a `ReviewDTO`.
 *
 * @param reviewDoc  a Review document, `.lean()` object, or `.toJSON()` output.
 * @param viewerOxyUserId  the requesting user (optional) — drives `viewerHasVotedHelpful`.
 */
export function toReviewDTO(reviewDoc: unknown, viewerOxyUserId?: string | null): Loose {
  const review = plain(reviewDoc);

  const helpfulVoters = Array.isArray(review.helpfulVoters)
    ? review.helpfulVoters.map((v) => String(v))
    : [];
  const helpfulCount = helpfulVoters.length;
  const viewerHasVotedHelpful = viewerOxyUserId
    ? helpfulVoters.includes(String(viewerOxyUserId))
    : false;

  const agency = agencySummary(review.agencyId);
  const address = populatedAddress(review.addressId);

  const dto: Loose = {
    ...review,
    id: refToId(review._id ?? review.id),
    addressId: refToId(review.addressId),
    agencyId: refToId(review.agencyId),
    helpfulCount,
    viewerHasVotedHelpful,
  };

  // Strip internal moderation/audit data — never exposed to clients.
  delete dto.helpfulVoters;
  delete dto.reports;

  if (agency) dto.agency = agency;
  if (address) dto.populatedAddress = address;

  return dto;
}

/** ISO-string a Date, or pass through an already-serialized value. */
function toIso(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'string' && value.length) return value;
  return undefined;
}

/** Normalize the embedded `reports` array into the admin-facing report shape. */
function normalizeReports(value: unknown): Loose[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const report = plain(entry);
    const normalized: Loose = {
      oxyUserId: report.oxyUserId != null ? String(report.oxyUserId) : '',
      reason: report.reason,
      createdAt: toIso(report.createdAt) ?? '',
    };
    if (typeof report.details === 'string' && report.details.length) {
      normalized.details = report.details;
    }
    return normalized;
  });
}

/**
 * Admin-only serializer variant. Reuses {@link toReviewDTO} for the full public
 * projection, then re-attaches the `reports` array that the public DTO strips.
 * Used exclusively by the admin moderation queue — do NOT call from a public
 * read path.
 */
export function toAdminReviewDTO(reviewDoc: unknown, viewerOxyUserId?: string | null): Loose {
  const dto = toReviewDTO(reviewDoc, viewerOxyUserId);
  dto.reports = normalizeReports(plain(reviewDoc).reports);
  return dto;
}

export default toReviewDTO;
