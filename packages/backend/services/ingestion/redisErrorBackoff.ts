/**
 * What a listing worker does when its queue's Redis refuses commands.
 *
 * **THE LOOP THIS ENDS.** On 2026-10-20 the shared queue node (`noeviction`)
 * filled up and refused every write with `OOM command not allowed`. BullMQ's
 * fetch loop treats a refused script as a NON-connection error and, with
 * `onlyEmitError`, returns at once and asks for the next job — no delay — so
 * each worker called `moveToActive` as fast as Redis could answer. Nothing here
 * listened for `error`, and BullMQ's fallback for an unheard `error` is
 * `console.error(err)`: a full redis-parser stack per attempt. The worker wrote
 * ~30 million log lines an hour (~1.2 GB/hour of CloudWatch ingestion) and did
 * no work at all.
 *
 * So every listing Worker and Queue gets an `error` listener (BullMQ never
 * falls back to `console.error` again), and a Worker that sees an error PAUSES
 * for a bounded, doubling interval before asking again: 1 s, 2 s, 4 s … capped
 * at 5 minutes, back to 1 s as soon as a job is fetched again. A refused write
 * is a property of the node, not of one job, so hammering it changes nothing.
 *
 * **ONE LINE, NOT ONE PER ATTEMPT.** The first error of a burst is logged with
 * its message (never its stack); the rest are counted and summarised at most
 * once a minute. An error that is real stays visible; an error repeating
 * itself a thousand times a second costs one line a minute.
 *
 * `pause(true)`/`resume()` are BullMQ's public controls and touch no Redis key,
 * unlike `Worker.rateLimit`, which SETs one and so fails on the very node that
 * is refusing writes.
 */

/** First pause after an error. */
export const REDIS_ERROR_BASE_DELAY_MS = 1_000;

/** Longest pause: a full node does not drain in seconds, and five minutes is cheap to wait. */
export const REDIS_ERROR_MAX_DELAY_MS = 5 * 60 * 1_000;

/** At most one summary line per this interval while errors keep coming. */
export const REDIS_ERROR_SUMMARY_MS = 60 * 1_000;

/** The slice of a BullMQ Worker this needs. */
export interface PausableWorker {
  readonly name: string;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'active', listener: (...args: unknown[]) => void): unknown;
  on(event: 'closing', listener: (...args: unknown[]) => void): unknown;
  pause(doNotWaitActive?: boolean): Promise<void>;
  resume(): void;
}

/** The slice of a BullMQ Queue this needs. */
export interface ErrorEmitter {
  readonly name: string;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** The logger slice this needs. */
export interface BackoffLogger {
  warn(message: string, data?: Record<string, unknown>): void;
}

export interface RedisErrorBackoffOptions {
  logger: BackoffLogger;
  baseDelayMs?: number;
  maxDelayMs?: number;
  summaryEveryMs?: number;
  now?: () => number;
  /** Returns a timer handle; Node's is `unref`ed so a pause never holds the process open. */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

/**
 * Logs a burst of identical-looking errors as one line plus a periodic count.
 * Shared by a queue's Worker and Queue so one refusing node is one stream of
 * summaries, not two.
 */
export class ErrorSummary {
  private suppressed = 0;
  private lastLoggedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly logger: BackoffLogger,
    private readonly source: string,
    private readonly everyMs: number,
    private readonly now: () => number,
  ) {}

  /** Record one error; logs at most once per interval. Returns whether it logged. */
  record(error: Error, extra?: Record<string, unknown>): boolean {
    const at = this.now();
    if (at - this.lastLoggedAt < this.everyMs) {
      this.suppressed += 1;
      return false;
    }
    this.logger.warn('Listing queue Redis error', {
      source: this.source,
      error: error.message,
      // How many identical-looking errors were folded into this line.
      suppressedSinceLastLine: this.suppressed || undefined,
      ...extra,
    });
    this.suppressed = 0;
    this.lastLoggedAt = at;
    return true;
  }
}

/** Give a Queue an `error` listener so BullMQ never prints a stack per error. */
export function summariseQueueErrors(
  queue: ErrorEmitter,
  options: Pick<RedisErrorBackoffOptions, 'logger' | 'summaryEveryMs' | 'now'>,
): ErrorSummary {
  const summary = new ErrorSummary(
    options.logger,
    `queue:${queue.name}`,
    options.summaryEveryMs ?? REDIS_ERROR_SUMMARY_MS,
    options.now ?? Date.now,
  );
  queue.on('error', (error) => {
    summary.record(error);
  });
  return summary;
}

/**
 * Pause `worker` with a doubling, bounded delay whenever it reports an error,
 * and summarise the errors. Returns a stop function for shutdown.
 */
export function backOffWorkerOnRedisErrors(
  worker: PausableWorker,
  options: RedisErrorBackoffOptions,
): () => void {
  const baseDelayMs = options.baseDelayMs ?? REDIS_ERROR_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? REDIS_ERROR_MAX_DELAY_MS;
  const now = options.now ?? Date.now;
  const setTimer =
    options.setTimer ?? ((callback: () => void, ms: number) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as never));
  const summary = new ErrorSummary(
    options.logger,
    `worker:${worker.name}`,
    options.summaryEveryMs ?? REDIS_ERROR_SUMMARY_MS,
    now,
  );

  let consecutive = 0;
  let resumeTimer: unknown;
  let stopped = false;

  worker.on('active', () => {
    // A job was fetched: the node is taking commands again.
    consecutive = 0;
  });
  worker.on('closing', () => {
    stopped = true;
    if (resumeTimer !== undefined) clearTimer(resumeTimer);
    resumeTimer = undefined;
  });
  worker.on('error', (error) => {
    if (stopped || resumeTimer !== undefined) {
      // Already paused (an in-flight command failing after the pause), or
      // shutting down: count it, do not extend or stack another pause.
      summary.record(error);
      return;
    }
    const delayMs = Math.min(baseDelayMs * 2 ** consecutive, maxDelayMs);
    consecutive += 1;
    summary.record(error, { pausedForMs: delayMs });
    const timer = setTimer(() => {
      resumeTimer = undefined;
      if (!stopped) worker.resume();
    }, delayMs);
    (timer as { unref?: () => void }).unref?.();
    resumeTimer = timer;
    // `true`: do not wait for active jobs — they finish on their own; only new
    // fetches stop. A pause that fails (the worker closing) is not an error.
    worker.pause(true).catch(() => undefined);
  });

  return () => {
    stopped = true;
    if (resumeTimer !== undefined) clearTimer(resumeTimer);
    resumeTimer = undefined;
  };
}
