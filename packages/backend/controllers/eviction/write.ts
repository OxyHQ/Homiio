/**
 * Eviction-case write handlers (create / update / delete).
 *
 * Ownership + mass-assignment rules mirror property/lease writes:
 *   - the owner is the session `oxyUserId` (never from the client),
 *   - only `CREATABLE_EVICTION_FIELDS` / `EDITABLE_EVICTION_FIELDS` are picked,
 *   - nested objects are re-whitelisted key-by-key (never deep-spread),
 *   - update/delete resolve the row by `(id, oxyUserId)` (non-owner → 404).
 *
 * Privacy: an `approximate` location is rounded server-side BEFORE persisting,
 * so the exact point never reaches the database at all. When the owner
 * reschedules or changes status, a timeline entry is appended and every attendee
 * except the owner is notified.
 *
 * ## Every column this file writes is named, one assignment at a time
 *
 * `location`, `contactInfo` and `coverImage` were nested sub-documents Mongo
 * replaced wholesale with a `$set`; they are thirteen flat columns now, and each
 * one is assigned individually rather than merged in with an `Object.assign` or
 * a spread. That is deliberate and worth the verbosity: `Object.assign` type-
 * checks whatever it is handed, so a key that stopped belonging on the patch
 * would reach the `UPDATE` silently — in the one file whose entire job is
 * keeping a request body away from server-owned columns.
 *
 * Absent handles are written as `null` rather than skipped, which is what
 * reproduces the sub-document REPLACEMENT `$set` performed: a payload naming
 * only `phone` clears a previously stored `email`, exactly as it always did.
 * `sanitizeContactInfo` returning all five columns is that same decision one
 * layer down.
 *
 * ## The Mongoose `ValidationError` branch is deleted, not ported
 *
 * The two things Mongoose validated here are the presence of the title,
 * description, location and date — which these handlers check themselves and
 * answer 400 for — and the coordinate range, which `sanitizeLocation` refuses
 * before an insert can see it. What is left is a `NOT NULL` or a CHECK, and that
 * is a programming error rather than a caller's: it belongs in the error handler
 * as a 500 rather than relabelled a 400 the client cannot act on. Same call, for
 * the same reason, as `notificationController`.
 */

import { pickFields } from '../../utils/pickFields';
import { CREATABLE_EVICTION_FIELDS, EDITABLE_EVICTION_FIELDS } from './editableFields';
import {
  countEvictionAttendees,
  deleteOwnedEvictionCase,
  findOwnedEvictionCase,
  insertEvictionCase,
  listEvictionUpdates,
  updateOwnedEvictionCase,
  type EvictionCaseInsert,
  type EvictionCasePatch,
} from '../../db/evictions/evictionRepository';
import { toEvictionDTO } from './toEvictionDTO';
import {
  fanOutToAttendees,
  parseDate,
  parseEvictionStatus,
  resolveAgencyId,
  roundApproxCoord,
  sanitizeContactInfo,
  sanitizeCoverImage,
  sanitizeLocation,
  type EvictionPrecisionValue,
  type EvictionStatusValue,
} from './shared';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/** The six columns a client-supplied `location` writes. */
type EvictionLocationColumns = Pick<
  EvictionCaseInsert,
  | 'locationLabel'
  | 'locationLongitude'
  | 'locationLatitude'
  | 'locationPrecision'
  | 'locationCity'
  | 'locationCountryCode'
>;

/**
 * A client `location`, as the six columns that store it — or `undefined` when it
 * is not a storable location at all.
 *
 * The privacy rounding happens HERE, on the way in, so an `approximate` case
 * never holds the precise point: masking it on the way out would leave the real
 * coordinates in the row for anything that reads the table directly.
 *
 * `fallbackPrecision` is what a payload that omits `precision` inherits — the
 * privacy-preserving `approximate` on a create, the STORED value on an update.
 * Defaulting an update to `approximate` would silently downgrade an exact
 * location; defaulting it to `exact` would silently publish one.
 */
function locationColumns(
  input: unknown,
  fallbackPrecision: EvictionPrecisionValue,
): EvictionLocationColumns | undefined {
  const location = sanitizeLocation(input);
  if (!location?.label || location.longitude === undefined || location.latitude === undefined) {
    return undefined;
  }
  const precision = location.precision ?? fallbackPrecision;
  const approximate = precision === 'approximate';
  return {
    locationLabel: location.label,
    locationLongitude: approximate ? roundApproxCoord(location.longitude) : location.longitude,
    locationLatitude: approximate ? roundApproxCoord(location.latitude) : location.latitude,
    locationPrecision: precision,
    // A location payload replaces the whole location, so a city the new payload
    // does not name is cleared rather than inherited.
    locationCity: location.city ?? null,
    locationCountryCode: location.countryCode ?? null,
  };
}

export async function createEviction(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_EVICTION_FIELDS);

    const title = typeof picked.title === 'string' ? picked.title.trim() : '';
    if (!title) return next(new AppError('Title is required', 400, 'INVALID_TITLE'));

    const description = typeof picked.description === 'string' ? picked.description.trim() : '';
    if (!description) return next(new AppError('Description is required', 400, 'INVALID_DESCRIPTION'));

    const location = locationColumns(picked.location, 'approximate');
    if (!location) {
      return next(new AppError('A location with a label and coordinates is required', 400, 'INVALID_LOCATION'));
    }

    const scheduledAt = parseDate(picked.scheduledAt);
    if (!scheduledAt) return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));

    const agencyId =
      typeof picked.agencyName === 'string' && picked.agencyName.trim()
        ? await resolveAgencyId(picked.agencyName)
        : undefined;

    const contact = sanitizeContactInfo(picked.contactInfo);
    const coverImage = sanitizeCoverImage(picked.coverImage);

    const created = await insertEvictionCase({
      oxyUserId,
      title,
      description,
      locationLabel: location.locationLabel,
      locationLongitude: location.locationLongitude,
      locationLatitude: location.locationLatitude,
      locationPrecision: location.locationPrecision,
      locationCity: location.locationCity,
      locationCountryCode: location.locationCountryCode,
      scheduledAt,
      // Status is ALWAYS server-set to `upcoming` at creation — never from the body.
      status: 'upcoming',
      agencyId: agencyId ?? null,
      contactPhone: contact.contactPhone,
      contactEmail: contact.contactEmail,
      contactTelegram: contact.contactTelegram,
      contactWhatsapp: contact.contactWhatsapp,
      contactInstructions: contact.contactInstructions,
      coverImageId: coverImage.coverImageId,
      coverImageUrl: coverImage.coverImageUrl,
    });

    res.status(201).json(
      successResponse(
        // A case one statement old has no timeline and no roster; those are not
        // reads that were skipped, they are facts about a row that was just
        // minted.
        toEvictionDTO(
          { evictionCase: created, updates: [], attendeeCount: 0 },
          { viewerOxyUserId: oxyUserId, isAttending: false, includeContact: true },
        ),
        'Eviction case created',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function updateEviction(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    // Read first, for the 404 AND for the previous date/status/precision the
    // change detection below compares against. The write re-checks ownership in
    // its own `WHERE`, so this read is never the authorization.
    const existing = await findOwnedEvictionCase(id, oxyUserId);
    if (!existing) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const picked = pickFields<Record<string, unknown>>(req.body, EDITABLE_EVICTION_FIELDS);
    const patch: EvictionCasePatch = {};

    if (picked.title !== undefined) {
      const title = typeof picked.title === 'string' ? picked.title.trim() : '';
      if (!title) return next(new AppError('Title cannot be empty', 400, 'INVALID_TITLE'));
      patch.title = title;
    }
    if (picked.description !== undefined) {
      const description = typeof picked.description === 'string' ? picked.description.trim() : '';
      if (!description) return next(new AppError('Description cannot be empty', 400, 'INVALID_DESCRIPTION'));
      patch.description = description;
    }
    if (picked.location !== undefined) {
      const location = locationColumns(picked.location, existing.locationPrecision);
      if (!location) {
        return next(new AppError('A location with a label and coordinates is required', 400, 'INVALID_LOCATION'));
      }
      patch.locationLabel = location.locationLabel;
      patch.locationLongitude = location.locationLongitude;
      patch.locationLatitude = location.locationLatitude;
      patch.locationPrecision = location.locationPrecision;
      patch.locationCity = location.locationCity;
      patch.locationCountryCode = location.locationCountryCode;
    }
    if ('contactInfo' in picked) {
      // The Mongo `$unset` has no counterpart: clearing the block and replacing
      // it are the same five writes, and `sanitizeContactInfo` already answers
      // an absent handle with `null`.
      const contact = sanitizeContactInfo(picked.contactInfo);
      patch.contactPhone = contact.contactPhone;
      patch.contactEmail = contact.contactEmail;
      patch.contactTelegram = contact.contactTelegram;
      patch.contactWhatsapp = contact.contactWhatsapp;
      patch.contactInstructions = contact.contactInstructions;
    }
    if ('coverImage' in picked) {
      const coverImage = sanitizeCoverImage(picked.coverImage);
      patch.coverImageId = coverImage.coverImageId;
      patch.coverImageUrl = coverImage.coverImageUrl;
    }

    // Track lifecycle transitions to auto-append a timeline entry + notify RSVPs.
    let nextScheduledAt: Date | undefined;
    let nextStatus: EvictionStatusValue | undefined;

    if (picked.scheduledAt !== undefined) {
      const parsed = parseDate(picked.scheduledAt);
      if (!parsed) return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));
      if (parsed.getTime() !== existing.scheduledAt.getTime()) {
        nextScheduledAt = parsed;
        patch.scheduledAt = parsed;
      }
    }
    if (picked.status !== undefined) {
      const status = parseEvictionStatus(picked.status);
      if (!status) return next(new AppError('Invalid status', 400, 'INVALID_STATUS'));
      if (status !== existing.status) {
        nextStatus = status;
        patch.status = status;
      }
    }

    let timelineMessage: string | undefined;
    if (nextScheduledAt || nextStatus) {
      const parts: string[] = [];
      if (nextScheduledAt) parts.push(`Rescheduled to ${nextScheduledAt.toISOString()}`);
      if (nextStatus) parts.push(`Status changed to ${nextStatus}`);
      timelineMessage = parts.join('. ');
    }

    // One call, one transaction: the patch and the timeline entry it explains
    // commit together or not at all — Mongo got that from a `$set` and a `$push`
    // in one `findOneAndUpdate`, and it is the reason this is not an update
    // followed by an insert.
    const updated = await updateOwnedEvictionCase({
      caseId: id,
      oxyUserId,
      patch,
      timelineEntry: timelineMessage
        ? { message: timelineMessage, newScheduledAt: nextScheduledAt, newStatus: nextStatus }
        : undefined,
    });
    if (!updated) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    if (timelineMessage) {
      await fanOutToAttendees(id, oxyUserId, {
        type: 'eviction_update',
        title: 'Eviction case updated',
        message: timelineMessage,
        data: { evictionId: id },
      });
    }

    const [updates, attendeeCount] = await Promise.all([
      listEvictionUpdates(id),
      countEvictionAttendees(id),
    ]);

    res.json(
      successResponse(
        toEvictionDTO(
          { evictionCase: updated, updates, attendeeCount },
          { viewerOxyUserId: oxyUserId, includeContact: true },
        ),
        'Eviction case updated',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function deleteEviction(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    // One statement, and it is both the ownership check and the delete — the
    // preceding `findOne` Mongo needed was a read a transfer could race. The
    // comment thread, the timeline, the roster and any trust & safety reports go
    // with the case by `ON DELETE CASCADE`, so the explicit second
    // `EvictionComment.deleteMany` is deleted rather than ported: a cascade
    // cannot be forgotten the way that call could.
    const deleted = await deleteOwnedEvictionCase(id, oxyUserId);
    if (!deleted) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    res.json(successResponse(null, 'Eviction case deleted'));
  } catch (error) {
    next(error);
  }
}
