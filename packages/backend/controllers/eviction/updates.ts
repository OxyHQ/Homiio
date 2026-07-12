/**
 * Eviction timeline updates.
 *
 * Owner-only: append a note to a case's timeline (a reschedule, a status
 * change, or a plain message). When the update carries a new schedule/status
 * the case root fields are updated too. Every attendee (except the owner) is
 * notified best-effort.
 */

import { pickFields } from '../../utils/pickFields';
import { EvictionCase } from '../../models';
import { toEvictionDTO } from './toEvictionDTO';
import { fanOutToAttendees, parseDate, VALID_EVICTION_STATUSES } from './shared';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const MAX_UPDATE_LENGTH = 2000;

const CREATABLE_UPDATE_FIELDS: readonly string[] = ['message', 'newScheduledAt', 'newStatus'];

export async function createUpdate(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await EvictionCase.findOne({ _id: id, oxyUserId }).select('_id');
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_UPDATE_FIELDS);

    const message = typeof picked.message === 'string' ? picked.message.trim() : '';
    if (!message) return next(new AppError('An update message is required', 400, 'INVALID_MESSAGE'));
    if (message.length > MAX_UPDATE_LENGTH) {
      return next(new AppError('Update message is too long', 400, 'MESSAGE_TOO_LONG'));
    }

    const set: Record<string, unknown> = {};
    let newScheduledAt: Date | undefined;
    let newStatus: string | undefined;

    if (picked.newScheduledAt !== undefined) {
      const parsed = parseDate(picked.newScheduledAt);
      if (!parsed) return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));
      newScheduledAt = parsed;
      set.scheduledAt = parsed;
    }
    if (picked.newStatus !== undefined) {
      const status = String(picked.newStatus);
      if (!VALID_EVICTION_STATUSES.has(status)) return next(new AppError('Invalid status', 400, 'INVALID_STATUS'));
      newStatus = status;
      set.status = status;
    }

    const updateOps: Record<string, unknown> = {
      $push: {
        updates: { message, newScheduledAt, newStatus, createdAt: new Date() },
      },
    };
    if (Object.keys(set).length) updateOps.$set = set;

    const updated = await EvictionCase.findOneAndUpdate({ _id: id, oxyUserId }, updateOps, {
      new: true,
      runValidators: true,
    });
    if (!updated) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    await fanOutToAttendees(String(id), oxyUserId, {
      type: 'eviction_update',
      title: 'Eviction case update',
      message,
      data: { evictionId: String(id) },
    });

    res.status(201).json(
      successResponse(
        toEvictionDTO(updated, { viewerOxyUserId: oxyUserId, includeContact: true }),
        'Update posted',
      ),
    );
  } catch (error) {
    next(error);
  }
}
