/**
 * Pacing for bulk calls to Oxy Files — today the nightly reference
 * reconciliation (`referenceReconcile.ts`), which hands the SDK its pages
 * through {@link OxyCallPacer.slot}; the private-document upload reads
 * {@link retryAfterMs}. (The bulk moves out of Homiio's bucket that it was
 * written for ran to completion and were deleted with the bucket.)
 *
 * Oxy meters an application's calls on per-app budgets shared with the live
 * app — a listing ingest spends from the same upload budget — so a bulk caller
 * that fires as fast as it can has most of its own calls refused with 429, and
 * the live app's with them. So a paced caller:
 *
 * - starts at most `perMinute` metered calls a minute, evenly spaced, leaving
 *   the rest of the budget to everyone else;
 * - on a 429 waits what Oxy says (`Retry-After`, carried as
 *   `details.retryAfterSeconds`) and sends the SAME call again — a rate limit
 *   is never an outcome, and nothing is skipped or restarted;
 * - retries a transport failure or a 5xx a few times before giving up on that
 *   call.
 *
 * `sleep` and `now` are injectable so a test does not wait a minute.
 */

import { oxyErrorStatus } from './oxyFilesClient';

/** What a pacer needs from the outside world. */
export interface OxyCallPacerOptions {
  /** Metered calls started per minute, at most. */
  perMinute: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Told about every wait for a rate limit, for the run's log. */
  onRateLimited?: (waitMs: number) => void;
  /** Retries of a transport failure or a 5xx before the error is thrown. */
  transientRetries?: number;
}

const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_WAIT_MS = 5 * 60_000;
const TRANSIENT_BACKOFF_MS = [5_000, 20_000, 60_000];

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long Oxy asked the caller to wait, from a 429 the SDK rejected with. */
export function retryAfterMs(error: unknown): number {
  const details = (error as { details?: { retryAfterSeconds?: unknown } } | null)?.details;
  const seconds = Number(details?.retryAfterSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RATE_LIMIT_WAIT_MS;
  return Math.min(MAX_RATE_LIMIT_WAIT_MS, Math.ceil(seconds * 1000));
}

function isTransient(error: unknown): boolean {
  const status = oxyErrorStatus(error);
  return status === undefined || status >= 500;
}

export class OxyCallPacer {
  private readonly intervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly onRateLimited?: (waitMs: number) => void;
  private readonly transientRetries: number;
  /** The earliest moment the next call may start. */
  private nextSlot = 0;
  /** Calls refused for the rate limit, then sent again. */
  rateLimited = 0;

  constructor(options: OxyCallPacerOptions) {
    if (!Number.isFinite(options.perMinute) || options.perMinute <= 0) {
      throw new Error('perMinute must be a positive number');
    }
    this.intervalMs = 60_000 / options.perMinute;
    this.sleep = options.sleep ?? realSleep;
    this.now = options.now ?? Date.now;
    this.onRateLimited = options.onRateLimited;
    this.transientRetries = options.transientRetries ?? TRANSIENT_BACKOFF_MS.length;
  }

  /**
   * Wait for the next slot. Slots are handed out in call order. Public for a
   * caller whose metered call is made by someone else — the SDK's
   * reconciliation sends its own pages (`referenceReconcile.ts`).
   */
  async slot(): Promise<void> {
    const now = this.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.intervalMs;
    if (start > now) await this.sleep(start - now);
  }

  /**
   * Run one metered call: paced, sent again after every 429, retried a few
   * times on a transport failure or 5xx. Any other error is the caller's.
   */
  async run<T>(call: () => Promise<T>): Promise<T> {
    let transientFailures = 0;
    for (;;) {
      await this.slot();
      try {
        return await call();
      } catch (error) {
        if (oxyErrorStatus(error) === 429) {
          const wait = retryAfterMs(error);
          this.rateLimited += 1;
          this.onRateLimited?.(wait);
          // Every caller waits it out, not only this one: the budget is shared.
          this.nextSlot = Math.max(this.nextSlot, this.now() + wait);
          continue;
        }
        if (isTransient(error) && transientFailures < this.transientRetries) {
          const wait =
            TRANSIENT_BACKOFF_MS[Math.min(transientFailures, TRANSIENT_BACKOFF_MS.length - 1)];
          transientFailures += 1;
          await this.sleep(wait);
          continue;
        }
        throw error;
      }
    }
  }
}
