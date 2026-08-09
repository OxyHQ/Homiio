/**
 * Eviction outcome-reminder job.
 *
 * We DELIBERATELY never auto-flip an `upcoming` case to `executed`/`stopped`:
 * doing so would assert an outcome nobody actually reported. Instead, once a
 * case's scheduled date is more than 24h in the past and it is still `upcoming`,
 * we nudge the OWNER exactly once to record what really happened (stopped /
 * postponed / carried out) so the public board stays honest.
 *
 * Idempotency is enforced by CLAIMING each case before dispatching:
 * `claimEvictionOutcomeReminder` is an `UPDATE … WHERE outcome_reminder_sent_at
 * IS NULL … RETURNING`, so concurrent cron runs across ECS tasks cannot both
 * take it — exactly one gets a row back and notifies, and a re-run simply finds
 * nothing due. The claim commits BEFORE the notification is sent, which is the
 * right way round: the dispatch is best-effort (swallow-and-logged inside the
 * notification dispatch service), so a missed nudge is better than a repeated
 * one, and `outcome_reminder_sent_at` remains the source of truth for "already
 * reminded".
 *
 * The due-set predicate — `upcoming`, past the cutoff, never claimed — lives in
 * `listEvictionCasesAwaitingOutcome` rather than here, so the query the sweep
 * scans and the claim it then takes cannot describe two different sets.
 */

import {
  claimEvictionOutcomeReminder,
  listEvictionCasesAwaitingOutcome,
} from '../db/evictions/evictionRepository';
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
  const due = await listEvictionCasesAwaitingOutcome({
    before: new Date(Date.now() - REMINDER_STALE_MS),
    limit,
  });

  let processed = 0;
  for (const row of due) {
    // Sequential on purpose: each iteration is a claim another task may already
    // hold, and the loop's whole job is to lose that race quietly.
    const claimed = await claimEvictionOutcomeReminder(row.id);
    if (!claimed) continue;

    const label = row.title.trim() ? row.title : 'your case';
    await notificationDispatchService.createForUser(row.oxyUserId, {
      type: 'eviction_outcome_reminder',
      title: 'How did it go?',
      message: `The date for "${label}" has passed. Let neighbours know what happened — was it stopped, postponed or carried out?`,
      data: { evictionId: row.id },
    });
    processed += 1;
  }

  return { processed };
}
