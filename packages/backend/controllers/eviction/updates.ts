/**
 * Eviction timeline updates.
 *
 * Owner-only: append a note to a case's timeline (a reschedule, a status change,
 * or a plain message). When the update carries a new schedule/status the case
 * row is updated too. Every attendee except the owner is notified best-effort.
 *
 * The timeline is `eviction_case_updates` now, not an array on the case, so the
 * entry and the case columns it announces live in two tables — and they are
 * still written by ONE call (`updateOwnedEvictionCase`, one transaction). That
 * matters more here than anywhere: a status change visible on the case but
 * missing from the timeline is a change nobody can account for, and a timeline
 * entry announcing a change that did not commit is worse. `insertEvictionUpdate`
 * exists for a note that stands alone; this handler never uses it, because a
 * message with no lifecycle change and a message with one must not take
 * different write paths.
 */

import { pickFields } from '../../utils/pickFields';
import {
  countEvictionAttendees,
  findOwnedEvictionCase,
  listEvictionUpdates,
  updateOwnedEvictionCase,
  type EvictionCasePatch,
} from '../../db/evictions/evictionRepository';
import { toEvictionDTO } from './toEvictionDTO';
import { fanOutToAttendees, parseDate, parseEvictionStatus, type EvictionStatusValue } from './shared';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const MAX_UPDATE_LENGTH = 2000;

const CREATABLE_UPDATE_FIELDS: readonly string[] = ['message', 'newScheduledAt', 'newStatus'];

export async function createUpdate(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const owned = await findOwnedEvictionCase(id, oxyUserId);
    if (!owned) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_UPDATE_FIELDS);

    const message = typeof picked.message === 'string' ? picked.message.trim() : '';
    if (!message) return next(new AppError('An update message is required', 400, 'INVALID_MESSAGE'));
    if (message.length > MAX_UPDATE_LENGTH) {
      return next(new AppError('Update message is too long', 400, 'MESSAGE_TOO_LONG'));
    }

    const patch: EvictionCasePatch = {};
    let newScheduledAt: Date | undefined;
    let newStatus: EvictionStatusValue | undefined;

    if (picked.newScheduledAt !== undefined) {
      const parsed = parseDate(picked.newScheduledAt);
      if (!parsed) return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));
      newScheduledAt = parsed;
      patch.scheduledAt = parsed;
    }
    if (picked.newStatus !== undefined) {
      const status = parseEvictionStatus(picked.newStatus);
      if (!status) return next(new AppError('Invalid status', 400, 'INVALID_STATUS'));
      newStatus = status;
      patch.status = status;
    }

    const updated = await updateOwnedEvictionCase({
      caseId: id,
      oxyUserId,
      patch,
      timelineEntry: { message, newScheduledAt, newStatus },
    });
    if (!updated) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    await fanOutToAttendees(id, oxyUserId, {
      type: 'eviction_update',
      title: 'Eviction case update',
      message,
      data: { evictionId: id },
    });

    const [updates, attendeeCount] = await Promise.all([
      listEvictionUpdates(id),
      countEvictionAttendees(id),
    ]);

    res.status(201).json(
      successResponse(
        toEvictionDTO(
          { evictionCase: updated, updates, attendeeCount },
          { viewerOxyUserId: oxyUserId, includeContact: true },
        ),
        'Update posted',
      ),
    );
  } catch (error) {
    next(error);
  }
}
