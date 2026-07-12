/**
 * Eviction outcome-reminder job.
 *
 * We DELIBERATELY never auto-flip an `upcoming` case to `executed`/`stopped`:
 * doing so would assert an outcome nobody actually reported. Instead, once a
 * case's scheduled date is more than 24h in the past and it is still `upcoming`,
 * we nudge the OWNER exactly once to record what really happened (stopped /
 * postponed / carried out) so the public board stays honest.
 *
 * Idempotency is enforced by claiming each case atomically (an `updateOne`
 * guarded on `outcomeReminderSentAt: null`) BEFORE dispatching — so concurrent
 * cron runs across API tasks can never double-notify, and a re-run simply finds
 * nothing due. The dispatch itself is best-effort (swallow-and-logged inside the
 * notification dispatch service); the domain state (`outcomeReminderSentAt`)
 * having been set is the source of truth for "already reminded".
 */

import { EvictionCaseStatus } from '@homiio/shared-types';
import { EvictionCase } from '../models';
import { notificationDispatchService } from './notificationDispatchService';

/** A case is "stale" once its date is more than this far in the past. */
const REMINDER_STALE_MS = 24 * 60 * 60 * 1000;

/** Cap the work per run so a large backlog is drained gradually, never at once. */
const DEFAULT_REMINDER_LIMIT = 100;

export interface EvictionOutcomeReminderResult {
  /** Number of owners notified this run (claimed + dispatched). */
  processed: number;
}

/**
 * Find `upcoming` cases whose date passed >24h ago without an outcome update and
 * remind each owner once. Returns how many reminders were dispatched.
 */
export async function sendEvictionOutcomeReminders(
  limit: number = DEFAULT_REMINDER_LIMIT,
): Promise<EvictionOutcomeReminderResult> {
  const cutoff = new Date(Date.now() - REMINDER_STALE_MS);

  // `{ outcomeReminderSentAt: null }` matches both an explicit null AND a missing
  // field, so cases that predate this feature are picked up too.
  const due = await EvictionCase.find({
    status: EvictionCaseStatus.UPCOMING,
    scheduledAt: { $lt: cutoff },
    outcomeReminderSentAt: null,
  })
    .select('_id oxyUserId title')
    .limit(limit)
    .lean<Array<{ _id: unknown; oxyUserId?: string; title?: string }>>();

  let processed = 0;
  for (const row of due) {
    // Atomically claim the reminder. If another run already claimed it,
    // `modifiedCount` is 0 and we skip — guaranteeing exactly-once dispatch.
    const claimed = await EvictionCase.updateOne(
      { _id: row._id, outcomeReminderSentAt: null },
      { $set: { outcomeReminderSentAt: new Date() } },
    );
    if (claimed.modifiedCount !== 1) continue;

    const label = typeof row.title === 'string' && row.title.trim() ? row.title : 'your case';
    await notificationDispatchService.createForUser(row.oxyUserId, {
      type: 'eviction_outcome_reminder',
      title: 'How did it go?',
      message: `The date for "${label}" has passed. Let neighbours know what happened — was it stopped, postponed or carried out?`,
      data: { evictionId: String(row._id) },
    });
    processed += 1;
  }

  return { processed };
}
