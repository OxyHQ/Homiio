/**
 * `moderation_events` — every webhook event CrowdSource has delivered here.
 *
 * Two jobs on purpose: the PRIMARY KEY is the dedupe, and the row is the audit
 * trail of what a third party told this deployment to do.
 *
 * ## Why the dedupe has to live in Postgres and not in the process
 *
 * `@oxyhq/crowdsource-express` defaults to an in-process store and says exactly
 * when that is not enough: two instances behind a load balancer each keep their
 * own, so a redelivery landing on the OTHER instance is not deduplicated at all.
 * Homiio runs an API task and a worker task behind the shared ALB against one
 * database, so this is that case — an in-process store would cover only the task
 * that happened to receive both copies.
 *
 * ## The claim is the INSERT, and the empty `RETURNING` set is the answer
 *
 * `INSERT … ON CONFLICT (id) DO NOTHING … RETURNING id` returns one row when this
 * call took the claim and ZERO rows when somebody else already had it. That is
 * the whole mechanism, and it is deliberately not a caught error: catching a
 * `23505` would mean a dropped connection or a failover — which throws something
 * else entirely — could be read as "already processed", answering 200 and
 * retiring a decision nobody ever handled. Here a real failure still propagates,
 * the middleware answers non-2xx, and the event stays on the sender's retry
 * schedule.
 *
 * The claim/release contract is the store's, and it is the right one. A row
 * inserted BEFORE the handler runs means a concurrent redelivery cannot also run
 * it; deleting that row when the handler THROWS means the sender's retry
 * schedule can still deliver the event later. Recording the id only after
 * success would let two copies run at once; recording it before and never
 * releasing would make a transient failure permanent and lose a decision
 * silently.
 */

import { eq } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { moderationEvents } from '../schema/moderation';

export type ModerationEventRow = typeof moderationEvents.$inferSelect;

/**
 * Retention ceiling for the audit trail, matching the outbox's ninety days.
 *
 * The sweep that enforces it is registered in `db/expiry.ts`. Note
 * `moderation_outbox.event_id` deliberately carries NO foreign key to this
 * table, precisely so this sweep cannot delete work the outbox has not done —
 * see the schema module for that reasoning.
 */
export const MODERATION_EVENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;

/**
 * Take the claim for `eventId`, or report that somebody else has it.
 *
 * @returns `true` when this call inserted the row and may process the event.
 */
export async function claimModerationEvent(
  eventId: string,
  now: Date = new Date(),
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const claimed = await db
    .insert(moderationEvents)
    .values({
      id: eventId,
      state: 'claimed',
      receivedAt: now,
      expiresAt: new Date(now.getTime() + MODERATION_EVENT_RETENTION_SECONDS * 1_000),
    })
    .onConflictDoNothing({ target: moderationEvents.id })
    .returning({ id: moderationEvents.id });
  return claimed.length === 1;
}

/** Give the claim back so a redelivery can be processed. */
export async function releaseModerationEvent(
  eventId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db.delete(moderationEvents).where(eq(moderationEvents.id, eventId));
}

/**
 * Complete a claimed event that carries work.
 *
 * `queued_at` is written in the same statement as the state because
 * `moderation_events_queued_at_check` enforces the biconditional: a `queued` row
 * without a timestamp, or a timestamp on a row in any other state, is refused.
 */
export async function markModerationEventQueued(
  input: {
    readonly eventId: string;
    readonly type: string;
    readonly caseId: string;
    readonly decision: unknown;
    readonly now?: Date;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(moderationEvents)
    .set({
      type: input.type,
      caseId: input.caseId,
      payload: { caseId: input.caseId, decision: input.decision },
      state: 'queued',
      queuedAt: now,
    })
    .where(eq(moderationEvents.id, input.eventId));
}

/**
 * Complete a claimed event there is nothing to do about.
 *
 * `case.created`, `case.escalated`, `case.closed` and any type a newer
 * CrowdSource introduces. No outbox row, because no work — but the row is kept,
 * because "did CrowdSource tell us about this case, and when" is the first
 * question asked when a report looks stuck, and it has to be answerable.
 */
export async function markModerationEventIgnored(
  input: {
    readonly eventId: string;
    readonly type: string;
    readonly caseId?: string;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .update(moderationEvents)
    .set({
      type: input.type,
      ...(input.caseId === undefined ? {} : { caseId: input.caseId }),
      state: 'ignored',
    })
    .where(eq(moderationEvents.id, input.eventId));
}

/** One event by id, for an operator tracing a decision. */
export async function findModerationEvent(
  eventId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationEventRow | undefined> {
  const [row] = await db
    .select()
    .from(moderationEvents)
    .where(eq(moderationEvents.id, eventId))
    .limit(1);
  return row;
}
