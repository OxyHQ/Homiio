/**
 * Eviction RSVP, supporter confirmation, vouching and revocation.
 *
 * ## An RSVP no longer unlocks the organiser's contact
 *
 * ADR 0003 records the previous behaviour as finding F8: any authenticated user
 * who tapped attend received the organiser's phone, email, Telegram and
 * WhatsApp. That is a one-tap contact harvest aimed at *"the person a landlord's
 * agent would most like to reach"* — the one place in this schema where a leak is
 * a physical-safety problem rather than a privacy one.
 *
 * §7.3.1 requires a SECOND factor, and {@link toggleAttend} tries to satisfy it
 * in the same request so the common case still feels like one tap: a supporter
 * with enough Homiio tenure is confirmed immediately and never sees a second
 * step. Everybody else gets `contactLocked` with a reason that says what would
 * change it.
 *
 * ## The roster is still disclosed to nobody, and that shapes the endpoints
 *
 * §7.4 is categorical — *"a list of people who turned up to resist an eviction is
 * a target list"* — including for the organiser. So there is no
 * `GET /:id/attendees`, and {@link revokeAttendee} takes the id in the PATH
 * rather than offering a list to pick from: the organiser can only revoke
 * somebody whose id they already hold, which means somebody who contacted them.
 *
 * That is also why a vouch is REQUESTER-initiated ({@link vouchForSupporter}
 * names the person being vouched for): the voucher learns one identity, the
 * person who asked them, and nobody learns the list.
 */

import {
  findEvictionCase,
  findSupporterStanding,
  insertVouch,
  revokeSupporter,
  toggleAttendance,
} from '../../db/evictions/evictionRepository';
import { ATTENDEE_MILESTONES, tryConfirmSupporter } from './shared';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

export async function toggleAttend(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    // Read the case first so an RSVP against a case that does not exist is a 404
    // rather than a foreign-key violation surfacing as a 500. The owner, the
    // title and the case's own tenure bar come from the same read.
    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const { attending, attendeeCount } = await toggleAttendance(id, oxyUserId);

    // Try the second factor in the same request, so a supporter who already
    // qualifies never meets a second step. A failure here is not an error: it is
    // the ordinary state of a new account, answered by `contactLocked` with a
    // reason on the detail response.
    let confirmationBasis: string | undefined;
    if (attending) {
      confirmationBasis = await tryConfirmSupporter({
        caseId: id,
        oxyUserId,
        minTenureDays: evictionCase.contactUnlockMinTenureDays,
      });
    }

    // Milestone notification to the owner on a FRESH RSVP crossing a threshold.
    // The COUNT only — never who.
    if (attending && ATTENDEE_MILESTONES.has(attendeeCount) && evictionCase.oxyUserId !== oxyUserId) {
      await notificationDispatchService.createForUser(evictionCase.oxyUserId, {
        type: 'eviction_rsvp',
        title: 'People are showing up',
        message: `${attendeeCount} people have said they'll show up to "${evictionCase.title}"`,
        data: { evictionId: id, attendeeCount },
      });
    }

    const standing = await findSupporterStanding(id, oxyUserId);

    res.json(
      successResponse(
        {
          attending,
          attendeeCount,
          confirmed: standing.confirmed,
          confirmationBasis,
        },
        attending ? 'You are attending this case' : 'You are no longer attending this case',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * One confirmed supporter vouches for another person on the same case.
 *
 * The voucher must themselves be confirmed and unrevoked — an unconfirmed
 * supporter vouching for a friend would make the second factor self-issuing, and
 * a chain of newcomers vouching for each other is not a second factor at all.
 */
export async function vouchForSupporter(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id, oxyUserId: vouchedOxyUserId } = req.params;
    const voucherOxyUserId = requireSessionOxyUserId(req);

    if (vouchedOxyUserId === voucherOxyUserId) {
      return next(new AppError('You cannot vouch for yourself', 400, 'INVALID_VOUCH'));
    }

    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const voucherStanding = await findSupporterStanding(id, voucherOxyUserId);
    if (!voucherStanding.confirmed) {
      return next(
        new AppError(
          'Only a confirmed supporter of this case can vouch for somebody.',
          403,
          'VOUCHER_NOT_CONFIRMED',
        ),
      );
    }

    await insertVouch({ caseId: id, voucherOxyUserId, vouchedOxyUserId });

    // Try to confirm them straight away, so the vouch takes effect without the
    // vouched person having to re-tap attend.
    const basis = await tryConfirmSupporter({
      caseId: id,
      oxyUserId: vouchedOxyUserId,
      minTenureDays: evictionCase.contactUnlockMinTenureDays,
    });

    res.json(
      successResponse({ vouched: true, confirmed: basis !== undefined }, 'Vouch recorded'),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * The organiser withdraws one supporter's confirmed access.
 *
 * ADR 0003 §7.3.1 gives the organiser this power explicitly, and §7.4 refuses to
 * give them the list — so the id is a path parameter. That is not an oversight
 * in the API design: it is the only shape that satisfies both.
 */
export async function revokeAttendee(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id, oxyUserId: target } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }
    if (evictionCase.oxyUserId !== oxyUserId) {
      // 404 rather than 403, matching every other ownership gate here: a 403
      // confirms the case exists to somebody who should not be asking.
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const revoked = await revokeSupporter(id, target);
    res.json(successResponse({ revoked }, revoked ? 'Access revoked' : 'Nothing to revoke'));
  } catch (error) {
    next(error);
  }
}
