/**
 * The webhook dedupe store, in Postgres.
 *
 * `@oxyhq/crowdsource-express` defaults to an in-process store and says exactly
 * when that is not enough: two instances behind a load balancer each keep their
 * own, so a redelivery landing on the other instance is not deduplicated. Homiio
 * runs behind the shared ALB with an API task and a worker task on the same
 * database, so this is that case — an in-process store would cover only the task
 * that happened to receive both copies of an event.
 *
 * The claim/release contract is the store's, and it is the right one. A row
 * inserted BEFORE the handler runs means a concurrent redelivery cannot also run
 * it; deleting that row when the handler THROWS means the sender's retry
 * schedule can still deliver the event later. Recording the id only after
 * success would let two copies run at once; recording it before and never
 * releasing would make a transient failure permanent and lose a decision
 * silently.
 *
 * The mechanics — why the empty vs one-row `RETURNING` set IS the answer, and
 * why a caught `23505` would be the wrong shape — live in
 * `db/moderation/moderationEventRepository.ts`.
 */

import type { ProcessedEventStore } from '@oxyhq/crowdsource-express';
import {
  claimModerationEvent,
  releaseModerationEvent,
} from '../../db/moderation/moderationEventRepository';

export function postgresProcessedEventStore(): ProcessedEventStore {
  return {
    /** True when this call took the claim. */
    async claim(eventId: string): Promise<boolean> {
      return claimModerationEvent(eventId);
    },

    /** Give the claim back so a redelivery can be processed. */
    async release(eventId: string): Promise<void> {
      await releaseModerationEvent(eventId);
    },
  };
}
