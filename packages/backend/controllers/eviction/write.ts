/**
 * Eviction-case write handlers (create / update / delete).
 *
 * Ownership + mass-assignment rules mirror property/lease writes:
 *   - the owner is the session `oxyUserId` (never from the client),
 *   - only `CREATABLE_EVICTION_FIELDS` / `EDITABLE_EVICTION_FIELDS` are picked,
 *   - nested objects are re-whitelisted key-by-key (never deep-spread),
 *   - update/delete resolve the row with `{ _id, oxyUserId }` (non-owner → 404).
 *
 * Privacy: an `approximate` location is rounded server-side before persisting.
 * When the owner reschedules or changes status, a timeline entry is appended
 * and every attendee (except the owner) is notified.
 */

import { EvictionCaseStatus } from '@homiio/shared-types';
import { pickFields } from '../../utils/pickFields';
import { CREATABLE_EVICTION_FIELDS, EDITABLE_EVICTION_FIELDS } from './editableFields';
import { EvictionCase, EvictionComment } from '../../models';
import { toEvictionDTO } from './toEvictionDTO';
import {
  fanOutToAttendees,
  parseDate,
  resolveAgencyId,
  roundApproxCoord,
  sanitizeContactInfo,
  sanitizeCoverImage,
  sanitizeLocation,
  VALID_EVICTION_STATUSES,
  type SanitizedEvictionLocation,
} from './shared';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import { getErrorName, getValidationMessages } from '../../utils/errors';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/** Round an `approximate` location's coordinates in place; leave `exact` as-is. */
function applyPrecisionRounding(location: SanitizedEvictionLocation): void {
  if (location.precision === 'approximate' && location.coordinates) {
    const [lng, lat] = location.coordinates.coordinates;
    location.coordinates = { type: 'Point', coordinates: [roundApproxCoord(lng), roundApproxCoord(lat)] };
  }
}

function handleWriteError(error: unknown, next: ControllerNext): void {
  if (getErrorName(error) === 'ValidationError') {
    const validationError: AppError & { details?: unknown } = new AppError(
      'Eviction case validation failed',
      400,
      'VALIDATION_ERROR',
    );
    validationError.details = getValidationMessages(error);
    return next(validationError);
  }
  next(error);
}

export async function createEviction(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_EVICTION_FIELDS);

    const title = typeof picked.title === 'string' ? picked.title.trim() : '';
    if (!title) return next(new AppError('Title is required', 400, 'INVALID_TITLE'));

    const description = typeof picked.description === 'string' ? picked.description.trim() : '';
    if (!description) return next(new AppError('Description is required', 400, 'INVALID_DESCRIPTION'));

    const location = sanitizeLocation(picked.location);
    if (!location || !location.label || !location.coordinates) {
      return next(new AppError('A location with a label and coordinates is required', 400, 'INVALID_LOCATION'));
    }
    if (!location.precision) location.precision = 'approximate';
    applyPrecisionRounding(location);

    const scheduledAt = parseDate(picked.scheduledAt);
    if (!scheduledAt) return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));

    const doc: Record<string, unknown> = {
      oxyUserId,
      title,
      description,
      location,
      scheduledAt,
      // Status is ALWAYS server-set to `upcoming` at creation — never from the body.
      status: EvictionCaseStatus.UPCOMING,
      updates: [],
      attendees: [],
      attendeeCount: 0,
    };

    const contactInfo = sanitizeContactInfo(picked.contactInfo);
    if (contactInfo) doc.contactInfo = contactInfo;
    const coverImage = sanitizeCoverImage(picked.coverImage);
    if (coverImage) doc.coverImage = coverImage;

    // Dormant until the Agency model ships (parallel reviews branch).
    if (typeof picked.agencyName === 'string' && picked.agencyName.trim()) {
      const agencyId = await resolveAgencyId(picked.agencyName);
      if (agencyId) doc.agencyId = agencyId;
    }

    const created = await new EvictionCase(doc).save();
    res.status(201).json(
      successResponse(
        toEvictionDTO(created, { viewerOxyUserId: oxyUserId, isAttending: false }),
        'Eviction case created',
      ),
    );
  } catch (error) {
    handleWriteError(error, next);
  }
}

export async function updateEviction(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await EvictionCase.findOne({ _id: id, oxyUserId });
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const picked = pickFields<Record<string, unknown>>(req.body, EDITABLE_EVICTION_FIELDS);
    const set: Record<string, unknown> = {};
    const unset: Record<string, unknown> = {};

    if (picked.title !== undefined) {
      const title = typeof picked.title === 'string' ? picked.title.trim() : '';
      if (!title) return next(new AppError('Title cannot be empty', 400, 'INVALID_TITLE'));
      set.title = title;
    }
    if (picked.description !== undefined) {
      const description = typeof picked.description === 'string' ? picked.description.trim() : '';
      if (!description) return next(new AppError('Description cannot be empty', 400, 'INVALID_DESCRIPTION'));
      set.description = description;
    }
    if (picked.location !== undefined) {
      const location = sanitizeLocation(picked.location);
      if (!location || !location.label || !location.coordinates) {
        return next(new AppError('A location with a label and coordinates is required', 400, 'INVALID_LOCATION'));
      }
      location.precision = location.precision ?? evictionCase.location?.precision ?? 'approximate';
      applyPrecisionRounding(location);
      set.location = location;
    }
    if ('contactInfo' in picked) {
      const contactInfo = sanitizeContactInfo(picked.contactInfo);
      if (contactInfo) set.contactInfo = contactInfo;
      else unset.contactInfo = '';
    }
    if ('coverImage' in picked) {
      const coverImage = sanitizeCoverImage(picked.coverImage);
      if (coverImage) set.coverImage = coverImage;
      else unset.coverImage = '';
    }

    // Track lifecycle transitions to auto-append a timeline entry + notify RSVPs.
    let nextScheduledAt: Date | undefined;
    let nextStatus: string | undefined;

    if (picked.scheduledAt !== undefined) {
      const parsed = parseDate(picked.scheduledAt);
      if (!parsed) return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));
      const previous = evictionCase.scheduledAt ? new Date(evictionCase.scheduledAt).getTime() : undefined;
      if (parsed.getTime() !== previous) {
        nextScheduledAt = parsed;
        set.scheduledAt = parsed;
      }
    }
    if (picked.status !== undefined) {
      const status = String(picked.status);
      if (!VALID_EVICTION_STATUSES.has(status)) return next(new AppError('Invalid status', 400, 'INVALID_STATUS'));
      if (status !== evictionCase.status) {
        nextStatus = status;
        set.status = status;
      }
    }

    const updateOps: Record<string, unknown> = {};
    let timelineMessage: string | undefined;
    if (nextScheduledAt || nextStatus) {
      const parts: string[] = [];
      if (nextScheduledAt) parts.push(`Rescheduled to ${nextScheduledAt.toISOString()}`);
      if (nextStatus) parts.push(`Status changed to ${nextStatus}`);
      timelineMessage = parts.join('. ');
      updateOps.$push = {
        updates: {
          message: timelineMessage,
          newScheduledAt: nextScheduledAt,
          newStatus: nextStatus,
          createdAt: new Date(),
        },
      };
    }
    if (Object.keys(set).length) updateOps.$set = set;
    if (Object.keys(unset).length) updateOps.$unset = unset;

    const updated = await EvictionCase.findOneAndUpdate({ _id: id, oxyUserId }, updateOps, {
      new: true,
      runValidators: true,
    });
    if (!updated) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    if (timelineMessage) {
      await fanOutToAttendees(String(id), oxyUserId, {
        type: 'eviction_update',
        title: 'Eviction case updated',
        message: timelineMessage,
        data: { evictionId: String(id) },
      });
    }

    res.json(successResponse(toEvictionDTO(updated, { viewerOxyUserId: oxyUserId }), 'Eviction case updated'));
  } catch (error) {
    handleWriteError(error, next);
  }
}

export async function deleteEviction(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await EvictionCase.findOne({ _id: id, oxyUserId }).select('_id');
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    await EvictionCase.deleteOne({ _id: id, oxyUserId });
    // Cascade the public comment thread.
    await EvictionComment.deleteMany({ caseId: id });

    res.json(successResponse(null, 'Eviction case deleted'));
  } catch (error) {
    next(error);
  }
}
