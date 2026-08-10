/**
 * Following a case, and clearing a precautionary hold.
 *
 * ## Following is NOT attending, and conflating them costs somebody a notice
 *
 * "I will be there" and "tell me if the date moves" are different statements.
 * A board that treats an RSVP as a subscription spams people who only wanted to
 * watch; one that treats a follow as an RSVP inflates the turnout number the
 * whole page exists to report. They are separate tables and separate endpoints.
 *
 * Notifications go to the UNION of the two, because somebody who said they will
 * be there has asked to know the date at least as loudly as somebody watching —
 * see `listFollowerOxyUserIds`.
 */

import { EvictionTimelineEventType } from '@homiio/shared-types';
import {
  appendTimelineEntry,
  clearPrecautionaryHold,
  findEvictionCase,
  toggleFollow,
} from '../../db/evictions/evictionRepository';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function toggleFollowEviction(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    // Read first so following a case that does not exist is a 404 rather than a
    // foreign-key violation surfacing as a 500.
    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const following = await toggleFollow(id, oxyUserId);
    res.json(
      successResponse(
        { following },
        following ? 'You are following this case' : 'You are no longer following this case',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * The organiser answers a precautionary hold.
 *
 * The answer is a timeline entry, not a silent flag flip: a case that was held
 * and released has a public record of both, so a reader can see that somebody
 * raised a concern and that it was addressed. The organiser is expected to have
 * edited the location or the description first — this endpoint does not check
 * that, because "did you actually fix it" is not a question a threshold can
 * answer, and the reporters can report again if it was not.
 */
export async function clearHold(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);
    const message =
      typeof req.body?.message === 'string' && req.body.message.trim()
        ? req.body.message.trim().slice(0, 500)
        : 'The organiser reviewed the location and description.';

    const cleared = await clearPrecautionaryHold(id, oxyUserId);
    if (!cleared) {
      // Either not theirs, or not held. Both answer 404 for the same reason
      // every other ownership gate here does: a distinguishable error confirms
      // the case exists to somebody who should not be asking.
      return next(new AppError('Eviction case not found or not on hold', 404, 'EVICTION_NOT_FOUND'));
    }

    await appendTimelineEntry(id, {
      eventType: EvictionTimelineEventType.CORRECTION_PUBLISHED,
      actorOxyUserId: oxyUserId,
      message,
    });

    res.json(successResponse({ precautionaryHold: false }, 'Hold cleared'));
  } catch (error) {
    next(error);
  }
}
