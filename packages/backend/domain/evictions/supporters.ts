/**
 * Eviction RSVP, following, supporter confirmation, vouching, revocation and
 * clearing a precautionary hold.
 *
 * ## An RSVP no longer unlocks the organiser's contact
 *
 * ADR 0003 records the previous behaviour as finding F8: any authenticated user
 * who tapped attend received the organiser's phone, email, Telegram and
 * WhatsApp. §7.3.1 requires a SECOND factor, and {@link toggleEvictionAttendance}
 * tries to satisfy it in the same call so the common case still feels like one
 * tap: a supporter with enough Homiio tenure is confirmed immediately. Everybody
 * else gets `contactLocked` with a reason on the detail response.
 *
 * ## The roster is disclosed to nobody, and that shapes the inputs
 *
 * §7.4 is categorical — *"a list of people who turned up to resist an eviction
 * is a target list"* — including for the organiser. So there is no roster read,
 * and {@link revokeEvictionSupporter} takes the person's id rather than offering
 * a list to pick from. A vouch is REQUESTER-initiated for the same reason.
 *
 * ## Following is NOT attending
 *
 * "I will be there" and "tell me if the date moves" are different statements,
 * kept in separate tables. Notifications go to the UNION of the two — see
 * `listFollowerOxyUserIds`.
 */

import { EvictionTimelineEventType } from '@homiio/shared-types';

import {
  appendTimelineEntry,
  clearPrecautionaryHold,
  findEvictionCase,
  findSupporterStanding,
  insertVouch,
  revokeSupporter,
  toggleAttendance,
  toggleFollow,
} from '../../db/evictions/evictionRepository';
import { AppError } from '../../middlewares/errorHandler';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { ATTENDEE_MILESTONES, tryConfirmSupporter } from './shared';

const CASE_NOT_FOUND = () => new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');

/** RSVP to a case, or withdraw the RSVP. */
export async function toggleEvictionAttendance(oxyUserId: string, id: string) {
  // Read the case first so an RSVP against a case that does not exist is a 404
  // rather than a foreign-key violation surfacing as a 500.
  const evictionCase = await findEvictionCase(id);
  if (!evictionCase) throw CASE_NOT_FOUND();

  const { attending, attendeeCount } = await toggleAttendance(id, oxyUserId);

  // Try the second factor in the same call, so a supporter who already
  // qualifies never meets a second step.
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
  return { attending, attendeeCount, confirmed: standing.confirmed, confirmationBasis };
}

/**
 * One confirmed supporter vouches for another person on the same case.
 *
 * The voucher must themselves be confirmed and unrevoked — an unconfirmed
 * supporter vouching for a friend would make the second factor self-issuing.
 */
export async function vouchForEvictionSupporter(
  voucherOxyUserId: string,
  id: string,
  vouchedOxyUserId: string,
) {
  if (vouchedOxyUserId === voucherOxyUserId) {
    throw new AppError('You cannot vouch for yourself', 400, 'INVALID_VOUCH');
  }

  const evictionCase = await findEvictionCase(id);
  if (!evictionCase) throw CASE_NOT_FOUND();

  const voucherStanding = await findSupporterStanding(id, voucherOxyUserId);
  if (!voucherStanding.confirmed) {
    throw new AppError(
      'Only a confirmed supporter of this case can vouch for somebody.',
      403,
      'VOUCHER_NOT_CONFIRMED',
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

  return { vouched: true, confirmed: basis !== undefined };
}

/**
 * The organiser withdraws one supporter's confirmed access.
 *
 * 404 rather than 403 for anybody but the organiser, matching every other
 * ownership gate here: a 403 confirms the case exists to somebody who should
 * not be asking.
 */
export async function revokeEvictionSupporter(oxyUserId: string, id: string, target: string) {
  const evictionCase = await findEvictionCase(id);
  if (!evictionCase || evictionCase.oxyUserId !== oxyUserId) throw CASE_NOT_FOUND();
  return { revoked: await revokeSupporter(id, target) };
}

/** Follow a case's updates, or stop following them. */
export async function toggleEvictionFollow(oxyUserId: string, id: string) {
  const evictionCase = await findEvictionCase(id);
  if (!evictionCase) throw CASE_NOT_FOUND();
  return { following: await toggleFollow(id, oxyUserId) };
}

/**
 * The organiser answers a precautionary hold.
 *
 * The answer is a timeline entry, not a silent flag flip: a case that was held
 * and released has a public record of both. Not theirs and not held both answer
 * 404, for the same reason every other ownership gate here does.
 */
export async function clearEvictionHold(oxyUserId: string, id: string, rawMessage?: unknown) {
  const message =
    typeof rawMessage === 'string' && rawMessage.trim()
      ? rawMessage.trim().slice(0, 500)
      : 'The organiser reviewed the location and description.';

  const cleared = await clearPrecautionaryHold(id, oxyUserId);
  if (!cleared) {
    throw new AppError('Eviction case not found or not on hold', 404, 'EVICTION_NOT_FOUND');
  }

  await appendTimelineEntry(id, {
    eventType: EvictionTimelineEventType.CORRECTION_PUBLISHED,
    actorOxyUserId: oxyUserId,
    message,
  });

  return { precautionaryHold: false };
}
