/**
 * Eviction DTO serializers.
 *
 * Convert an EvictionCase / EvictionComment (Mongoose document OR `.lean()`
 * plain object) into the shape the frontend consumes (mirrors `EvictionCase` /
 * `EvictionComment` in `@homiio/shared-types`):
 *   - `_id` → `id` (on the case and on every `updates` subdocument),
 *   - dates → ISO strings,
 *   - `attendees` STRIPPED (never exposed publicly),
 *   - `isAttending` / `isOwner` derived for a signed-in viewer.
 */

const mongoose = require('mongoose');
import {
  EvictionCaseStatus,
  type EvictionCase,
  type EvictionComment,
  type EvictionContactInfo,
  type EvictionLocation,
  type EvictionUpdate,
} from '@homiio/shared-types';

type Loose = Record<string, unknown>;

interface ToEvictionDTOOptions {
  /** The signed-in viewer, if any — drives `isOwner` / `isAttending`. */
  viewerOxyUserId?: string | null;
  /**
   * Explicit attendance for the viewer, computed by the caller (attendees are
   * `select: false`, so list/detail handlers resolve this with a separate
   * `$elemMatch` query). When omitted, the DTO falls back to an in-memory scan
   * of a loaded `attendees` array (present only when explicitly selected).
   */
  isAttending?: boolean;
}

/** Convert a Mongoose document or lean object into a plain field bag. */
function toLoose(value: unknown): Loose {
  if (value && typeof value === 'object') {
    const maybeDoc = value as { toObject?: () => Loose };
    if (typeof maybeDoc.toObject === 'function') {
      return maybeDoc.toObject();
    }
    return value as Loose;
  }
  return {};
}

/** Reference (ObjectId | string | populated doc) → string id. */
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

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
}

function asOptString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : undefined;
  }
  return undefined;
}

/** Date | ISO string → ISO string (handles both Mongoose Date and lean output). */
function toIso(value: unknown): string | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === 'string' && value.length) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return undefined;
}

function asStatus(value: unknown): EvictionCaseStatus {
  const status = asString(value);
  return (Object.values(EvictionCaseStatus) as string[]).includes(status)
    ? (status as EvictionCaseStatus)
    : EvictionCaseStatus.UPCOMING;
}

function toLocation(value: unknown): EvictionLocation {
  const src = (value ?? {}) as Loose;
  const coordSrc = (src.coordinates ?? {}) as Loose;
  const rawCoords = Array.isArray(coordSrc.coordinates) ? coordSrc.coordinates : [];
  const lng = Number(rawCoords[0]);
  const lat = Number(rawCoords[1]);
  return {
    label: asString(src.label),
    coordinates: {
      type: 'Point',
      coordinates: [Number.isFinite(lng) ? lng : 0, Number.isFinite(lat) ? lat : 0],
    },
    precision: src.precision === 'exact' ? 'exact' : 'approximate',
    city: asOptString(src.city),
    countryCode: asOptString(src.countryCode),
  };
}

function toContactInfo(value: unknown): EvictionContactInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const src = value as Loose;
  const contact: EvictionContactInfo = {
    phone: asOptString(src.phone),
    email: asOptString(src.email),
    telegram: asOptString(src.telegram),
    whatsapp: asOptString(src.whatsapp),
    instructions: asOptString(src.instructions),
  };
  const hasAny = Object.values(contact).some((entry) => entry !== undefined);
  return hasAny ? contact : undefined;
}

function toCoverImage(value: unknown): { imageId?: string; url?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const src = value as Loose;
  const imageId = refToId(src.imageId);
  const url = asOptString(src.url);
  if (!imageId && !url) return undefined;
  return { imageId, url };
}

function toUpdates(value: unknown): EvictionUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const src = (entry ?? {}) as Loose;
    return {
      id: refToId(src._id ?? src.id) ?? '',
      message: asString(src.message),
      newScheduledAt: toIso(src.newScheduledAt),
      newStatus: src.newStatus ? asStatus(src.newStatus) : undefined,
      createdAt: toIso(src.createdAt) ?? '',
    };
  });
}

export function toEvictionDTO(caseDoc: unknown, options: ToEvictionDTOOptions = {}): EvictionCase {
  const src = toLoose(caseDoc);
  const viewer = options.viewerOxyUserId ?? undefined;

  let isAttending: boolean | undefined;
  if (typeof options.isAttending === 'boolean') {
    isAttending = options.isAttending;
  } else if (viewer && Array.isArray(src.attendees)) {
    isAttending = (src.attendees as Loose[]).some(
      (attendee) => asString(attendee?.oxyUserId) === viewer,
    );
  }

  return {
    id: refToId(src._id ?? src.id) ?? '',
    oxyUserId: asString(src.oxyUserId),
    title: asString(src.title),
    description: asString(src.description),
    location: toLocation(src.location),
    scheduledAt: toIso(src.scheduledAt) ?? '',
    status: asStatus(src.status),
    agencyId: refToId(src.agencyId),
    contactInfo: toContactInfo(src.contactInfo),
    coverImage: toCoverImage(src.coverImage),
    updates: toUpdates(src.updates),
    attendeeCount: typeof src.attendeeCount === 'number' ? src.attendeeCount : 0,
    isAttending,
    isOwner: viewer ? asString(src.oxyUserId) === viewer : undefined,
    createdAt: toIso(src.createdAt) ?? '',
    updatedAt: toIso(src.updatedAt) ?? '',
  };
}

export function toEvictionCommentDTO(commentDoc: unknown): EvictionComment {
  const src = toLoose(commentDoc);
  return {
    id: refToId(src._id ?? src.id) ?? '',
    caseId: refToId(src.caseId) ?? '',
    oxyUserId: asString(src.oxyUserId),
    body: asString(src.body),
    createdAt: toIso(src.createdAt) ?? '',
    updatedAt: toIso(src.updatedAt) ?? '',
  };
}
