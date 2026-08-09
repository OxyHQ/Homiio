/**
 * The dispatch LOOP and the retry POLICY for moderation outbox events.
 *
 * At-least-once: handlers MUST make every downstream effect idempotent using the
 * event id, because an expired lease is reclaimable and a worker can die
 * mid-delivery.
 *
 * What is unusual here is where retrying STOPS — see
 * {@link failModerationOutboxEvent}. A delivery failure the SDK marks as not
 * retryable is a defect in the payload, not a blip, and retrying a defect
 * forever hides it behind an attempt count nobody reads.
 *
 * ## Where the SQL went
 *
 * Every statement this module used to issue now lives in
 * `db/moderation/moderationOutboxRepository.ts`; what stays here is the part
 * that is a POLICY rather than a query — the backoff curve, the attempt ceiling,
 * the retryability verdict, the lease heartbeat and the bounded drain.
 *
 * The split is not tidiness. `enqueueModerationOutboxEvent` is deliberately NOT
 * re-exported from this module: it is the one call that must carry a caller's
 * transaction, and the repository refuses the root connection at runtime. A
 * convenience re-export here would put it one import away from every service
 * that has no transaction to give it, which is exactly the mistake the guard
 * exists to catch. Callers import it from the repository, or they do not get it.
 */

import { randomUUID } from 'crypto';
import {
  claimModerationOutboxEvent,
  completeModerationOutboxEvent,
  releaseModerationOutboxEvent,
  renewModerationOutboxEvent,
  type ModerationOutboxEvent,
} from '../../db/moderation/moderationOutboxRepository';
import { logger } from '../../middlewares/logging';

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 500;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1_000;
const MIN_LEASE_RENEW_INTERVAL_MS = 250;

/**
 * Attempts after which a retryable failure is treated as permanent.
 *
 * Generous on purpose: a retryable failure means CrowdSource might still accept
 * this exact payload, and with the backoff capped at six hours this is several
 * days of trying. A report that has not landed by then needs a human, not
 * another attempt.
 */
const MAX_RETRYABLE_ATTEMPTS = 25;

/**
 * The event id for delivering a report.
 *
 * Derived from the report, never from the request: a transaction retry or two
 * concurrent submissions upsert the SAME event rather than queueing two
 * deliveries. There is exactly one delivery event per report for the life of the
 * report, which is also what keeps the CrowdSource-side idempotency key stable.
 */
export function reportSubmitEventId(reportId: string): string {
  return `moderation:report.submit:${reportId}`;
}

/**
 * The event id for applying an inbound decision.
 *
 * The webhook event id is the key, so a redelivery of the same event cannot
 * queue the work twice even if the dedupe claim were somehow released.
 */
export function decisionApplyEventId(eventId: string): string {
  return `moderation:decision.apply:${eventId}`;
}

function nextAttemptAt(attempts: number, now: Date): Date {
  const exponent = Math.max(0, Math.min(attempts - 1, 20));
  return new Date(now.getTime() + Math.min(1_000 * 2 ** exponent, MAX_BACKOFF_MS));
}

/**
 * A failure that says whether trying the same payload again could ever work.
 *
 * Every error `@oxyhq/crowdsource` throws carries `retryable`, which is the only
 * thing a delivery worker needs from it. Anything else — a bug in this code, a
 * Mongo error — is treated as retryable, because assuming a defect is permanent
 * is how a recoverable outage becomes lost moderation work.
 */
export function isRetryableDeliveryError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'retryable' in error) {
    const retryable: unknown = (error as { retryable: unknown }).retryable;
    if (typeof retryable === 'boolean') return retryable;
  }
  return true;
}

export interface ModerationOutboxFailure {
  released: boolean;
  deadLettered: boolean;
}

/**
 * Release a failed claim, with backoff — or stop.
 *
 * Stopping is not an optimisation. A 409 means this `externalReportId` already
 * exists at CrowdSource with a different body, and no number of retries turns
 * two payloads into one report; a rejected envelope is not processable. Both
 * need the payload to change, so they become `dead_letter` immediately and stay
 * visible with their error rather than accumulating attempts nobody reads.
 */
export async function failModerationOutboxEvent(
  event: Pick<ModerationOutboxEvent, 'id' | 'attempts'>,
  leaseOwner: string,
  error: unknown,
  now: Date = new Date(),
): Promise<ModerationOutboxFailure> {
  const message = error instanceof Error ? error.message : String(error);
  const retryable = isRetryableDeliveryError(error);
  const deadLettered = !retryable || event.attempts >= MAX_RETRYABLE_ATTEMPTS;

  const released = await releaseModerationOutboxEvent({
    eventId: event.id,
    leaseOwner,
    deadLettered,
    availableAt: deadLettered ? now : nextAttemptAt(event.attempts, now),
    error: message,
    now,
  });
  return { released, deadLettered };
}

export type ModerationOutboxHandler = (event: ModerationOutboxEvent) => Promise<void>;

interface LeaseHeartbeatResult {
  lost: boolean;
  error?: unknown;
}

function startLeaseHeartbeat(options: {
  eventId: string;
  leaseOwner: string;
  leaseMs: number;
}): { stop: () => Promise<LeaseHeartbeatResult> } {
  const renewIntervalMs = Math.max(
    MIN_LEASE_RENEW_INTERVAL_MS,
    Math.floor(options.leaseMs / 3),
  );
  let stopped = false;
  let lost = false;
  let renewalError: unknown;
  let renewalInFlight: Promise<void> | null = null;

  const renew = (): void => {
    if (stopped || lost || renewalInFlight) return;
    const renewal = renewModerationOutboxEvent(
      options.eventId,
      options.leaseOwner,
      options.leaseMs,
    )
      .then((stillOwner) => {
        if (!stillOwner) lost = true;
      })
      .catch((error: unknown) => {
        lost = true;
        renewalError = error;
      })
      .finally(() => {
        if (renewalInFlight === renewal) renewalInFlight = null;
      });
    renewalInFlight = renewal;
  };

  // `unref` so a housekeeping timer can never hold a Jest run or a graceful
  // shutdown open — the convention every module-level interval in this codebase
  // follows.
  const timer = setInterval(renew, renewIntervalMs);
  timer.unref?.();

  return {
    async stop(): Promise<LeaseHeartbeatResult> {
      stopped = true;
      clearInterval(timer);
      await renewalInFlight;
      return { lost, error: renewalError };
    },
  };
}

export interface ModerationDispatchResult {
  processed: number;
  failed: number;
  deadLettered: number;
}

/** Drain up to `batchSize` due events. Bounded, at-least-once, lease-protected. */
export async function dispatchModerationOutbox(options: {
  handler: ModerationOutboxHandler;
  leaseOwner?: string;
  batchSize?: number;
  leaseMs?: number;
  signal?: AbortSignal;
}): Promise<ModerationDispatchResult> {
  const leaseOwner = options.leaseOwner ?? `moderation:${process.pid}:${randomUUID()}`;
  const batchSize = Math.min(
    Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );
  const leaseMs = Math.max(1_000, options.leaseMs ?? DEFAULT_LEASE_MS);
  let processed = 0;
  let failed = 0;
  let deadLettered = 0;

  for (let index = 0; index < batchSize; index += 1) {
    // Shutdown stops claiming new work but lets the event already in flight
    // reach a durable state.
    if (options.signal?.aborted) break;

    const event = await claimModerationOutboxEvent({ leaseOwner, leaseMs });
    if (!event) break;

    const heartbeat = startLeaseHeartbeat({ eventId: event.id, leaseOwner, leaseMs });
    let deliveryError: unknown;
    try {
      await options.handler(event);
    } catch (error: unknown) {
      deliveryError = error;
    }

    // No completion/failure transition may race an owner-checked renewal.
    const heartbeatResult = await heartbeat.stop();
    if (heartbeatResult.lost) {
      failed += 1;
      logger.warn('[CrowdSource] outbox lease lost during delivery', {
        eventId: event.id,
        kind: event.kind,
        attempts: event.attempts,
        error:
          heartbeatResult.error instanceof Error
            ? heartbeatResult.error.message
            : heartbeatResult.error
              ? String(heartbeatResult.error)
              : 'owner or lease expiry changed',
      });
      continue;
    }

    if (deliveryError) {
      failed += 1;
      const outcome = await failModerationOutboxEvent(event, leaseOwner, deliveryError);
      const context = {
        eventId: event.id,
        kind: event.kind,
        attempts: event.attempts,
        error:
          deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
      };
      // A dead letter is moderation work that will not happen without a human,
      // so it must not be discoverable only by reading a warn-level line.
      if (outcome.deadLettered) {
        deadLettered += 1;
        logger.error('[CrowdSource] outbox event dead-lettered', context);
      } else {
        logger.warn('[CrowdSource] outbox delivery failed, will retry', context);
      }
      if (!outcome.released) {
        logger.warn('[CrowdSource] lease lost before failure release', {
          eventId: event.id,
          kind: event.kind,
        });
      }
      continue;
    }

    const completed = await completeModerationOutboxEvent(event.id, leaseOwner);
    if (!completed) {
      failed += 1;
      logger.warn('[CrowdSource] lease lost before completion', {
        eventId: event.id,
        kind: event.kind,
        attempts: event.attempts,
      });
      continue;
    }
    processed += 1;
  }

  return { processed, failed, deadLettered };
}
