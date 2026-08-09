/**
 * Eviction RSVP toggle.
 *
 * "I'll show up" is a per-user toggle, and it is now ONE repository call.
 *
 * ## The read-then-write is gone, and that is the point of the port
 *
 * Mongo could not express "one RSVP per person per case", so this handler asked
 * whether the user was already attending and then wrote — two concurrent taps
 * from one phone could both pass the guard, and each `$inc`'d a denormalized
 * `attendeeCount` that was a second representation of the roster. Both drifts
 * landed on the number the public board shows as TURNOUT, which is the whole
 * reason anybody reads this page.
 *
 * `toggleAttendance` inverts that: the insert IS the check
 * (`eviction_case_attendees_case_user_key` answers "already attending?" as a
 * `23505`), and the count that comes back is `count(*)` over the roster rather
 * than a counter that has to be kept true. Re-implementing an "are they on the
 * list?" read here would put the race back.
 *
 * When a fresh RSVP crosses an exact milestone (5/10/25/50/100) the owner gets a
 * "people are showing up" notification — never for the owner's own RSVP, and
 * never on the way back down.
 */

import {
  findEvictionCase,
  toggleAttendance,
} from '../../db/evictions/evictionRepository';
import { ATTENDEE_MILESTONES } from './shared';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function toggleAttend(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    // Read the case first so a RSVP against a case that does not exist is a 404
    // rather than a foreign-key violation surfacing as a 500. The owner and the
    // title come from the same read, for the milestone notification below.
    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const { attending, attendeeCount } = await toggleAttendance(id, oxyUserId);

    // Milestone notification to the owner on a FRESH RSVP crossing a threshold.
    if (attending && ATTENDEE_MILESTONES.has(attendeeCount) && evictionCase.oxyUserId !== oxyUserId) {
      await notificationDispatchService.createForUser(evictionCase.oxyUserId, {
        type: 'eviction_rsvp',
        title: 'People are showing up',
        message: `${attendeeCount} people have said they'll show up to "${evictionCase.title}"`,
        data: { evictionId: id, attendeeCount },
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
