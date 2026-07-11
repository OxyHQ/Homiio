/**
 * Eviction RSVP toggle.
 *
 * "I'll show up" is a per-user toggle implemented as an atomic two-step so the
 * `attendeeCount` never drifts under concurrency and a user can never be
 * double-counted:
 *   1. try to $push the attendee guarded by `$not $elemMatch` (add if absent),
 *   2. if nothing was added the user was already attending → $pull (remove).
 * Each step also $inc's the denormalized `attendeeCount`.
 *
 * When a fresh RSVP crosses an exact milestone (5/10/25/50/100) the owner gets
 * a "people are showing up" notification (never for the owner's own RSVP).
 */

import { EvictionCase } from '../../models';
import { ATTENDEE_MILESTONES } from './shared';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function toggleAttend(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await EvictionCase.findById(id).select('oxyUserId title');
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    // Step 1: add the attendee only if not already present.
    const added = await EvictionCase.updateOne(
      { _id: id, attendees: { $not: { $elemMatch: { oxyUserId } } } },
      { $push: { attendees: { oxyUserId, at: new Date() } }, $inc: { attendeeCount: 1 } },
    );

    let attending: boolean;
    if (added.modifiedCount === 1) {
      attending = true;
    } else {
      // Step 2: they were already attending → remove them.
      await EvictionCase.updateOne(
        { _id: id, attendees: { $elemMatch: { oxyUserId } } },
        { $pull: { attendees: { oxyUserId } }, $inc: { attendeeCount: -1 } },
      );
      attending = false;
    }

    const refreshed = await EvictionCase.findById(id).select('attendeeCount');
    const attendeeCount = refreshed?.attendeeCount ?? 0;

    // Milestone notification to the owner on a fresh RSVP crossing a threshold.
    if (
      attending &&
      ATTENDEE_MILESTONES.has(attendeeCount) &&
      evictionCase.oxyUserId &&
      evictionCase.oxyUserId !== oxyUserId
    ) {
      await notificationDispatchService.createForUser(evictionCase.oxyUserId, {
        type: 'eviction_rsvp',
        title: 'People are showing up',
        message: `${attendeeCount} people have said they'll show up to "${evictionCase.title}"`,
        data: { evictionId: String(id), attendeeCount },
      });
    }

    res.json(
      successResponse(
        { attending, attendeeCount },
        attending ? 'You are attending this case' : 'You are no longer attending this case',
      ),
    );
  } catch (error) {
    next(error);
  }
}
