/**
 * A listing worker whose queue's Redis refuses commands backs off and says so
 * in one line a minute — instead of the 2026-10-20 loop that asked a full
 * `noeviction` node for the next job as fast as it could answer and printed a
 * full stack for every refusal (~30 million lines an hour).
 */

import { EventEmitter } from 'node:events';
import {
  backOffWorkerOnRedisErrors,
  REDIS_ERROR_MAX_DELAY_MS,
  summariseQueueErrors,
} from '../../services/ingestion/redisErrorBackoff';

const OOM = () =>
  new Error("OOM command not allowed when used memory > 'maxmemory'. script: 6c4c…");

class FakeWorker extends EventEmitter {
  readonly name = 'listing-fetch';
  pauses = 0;
  resumes = 0;
  pause(): Promise<void> {
    this.pauses += 1;
    return Promise.resolve();
  }
  resume(): void {
    this.resumes += 1;
  }
}

function harness() {
  const clock = { now: 0 };
  const timers: Array<{ at: number; run: () => void; cleared: boolean }> = [];
  const lines: Array<{ message: string; data?: Record<string, unknown> }> = [];
  const worker = new FakeWorker();
  const stop = backOffWorkerOnRedisErrors(worker, {
    logger: { warn: (message, data) => lines.push({ message, data }) },
    now: () => clock.now,
    setTimer: (run, ms) => {
      const timer = { at: clock.now + ms, run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  /** Move the clock and fire every timer that came due. */
  const advance = (ms: number) => {
    clock.now += ms;
    for (const timer of timers) {
      if (!timer.cleared && timer.at <= clock.now) {
        timer.cleared = true;
        timer.run();
      }
    }
  };
  const pending = () => timers.filter((timer) => !timer.cleared);
  return { clock, worker, lines, stop, advance, pending, timers };
}

describe('backOffWorkerOnRedisErrors', () => {
  it('pauses on an error and resumes after the delay', () => {
    const { worker, advance } = harness();
    worker.emit('error', OOM());
    expect(worker.pauses).toBe(1);
    expect(worker.resumes).toBe(0);
    advance(999);
    expect(worker.resumes).toBe(0);
    advance(1);
    expect(worker.resumes).toBe(1);
  });

  it('does not stack pauses for the errors of one burst', () => {
    // BullMQ reports in-flight commands failing after the pause; each must not
    // start a pause of its own, or the delays would multiply.
    const { worker, pending } = harness();
    for (let i = 0; i < 1_000; i += 1) worker.emit('error', OOM());
    expect(worker.pauses).toBe(1);
    expect(pending()).toHaveLength(1);
  });

  it('doubles the delay while the node keeps refusing, up to the cap', () => {
    const { clock, worker, timers, advance } = harness();
    const delays: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      worker.emit('error', OOM());
      const timer = timers[timers.length - 1];
      delays.push(timer.at - clock.now);
      advance(timer.at - clock.now);
    }
    expect(delays.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(Math.max(...delays)).toBe(REDIS_ERROR_MAX_DELAY_MS);
    expect(delays.at(-1)).toBe(REDIS_ERROR_MAX_DELAY_MS);
  });

  it('starts again from the base delay once a job is fetched', () => {
    const { clock, worker, timers, advance } = harness();
    worker.emit('error', OOM());
    advance(1_000);
    worker.emit('error', OOM());
    advance(2_000);
    worker.emit('active');
    worker.emit('error', OOM());
    const timer = timers[timers.length - 1];
    expect(timer.at - clock.now).toBe(1_000);
  });

  it('logs one line a minute, with the count it folded in, and never a stack', () => {
    const { worker, lines, advance } = harness();
    worker.emit('error', OOM());
    for (let i = 0; i < 5_000; i += 1) worker.emit('error', OOM());
    expect(lines).toHaveLength(1);
    expect(lines[0].data).toMatchObject({ source: 'worker:listing-fetch', pausedForMs: 1_000 });
    expect(JSON.stringify(lines[0])).not.toContain('parser.js');

    advance(60_000);
    worker.emit('error', OOM());
    expect(lines).toHaveLength(2);
    expect(lines[1].data).toMatchObject({ suppressedSinceLastLine: 5_000 });
  });

  it('stops resuming once the worker is closing', () => {
    const { worker, advance, pending } = harness();
    worker.emit('error', OOM());
    worker.emit('closing');
    expect(pending()).toHaveLength(0);
    advance(10_000);
    expect(worker.resumes).toBe(0);
    worker.emit('error', OOM());
    expect(worker.pauses).toBe(1);
  });

  it('stops on shutdown', () => {
    const { worker, stop, advance } = harness();
    worker.emit('error', OOM());
    stop();
    advance(10_000);
    expect(worker.resumes).toBe(0);
  });
});

describe('summariseQueueErrors', () => {
  it('listens for errors so BullMQ never falls back to printing them', () => {
    // An EventEmitter with no `error` listener throws; BullMQ's QueueBase
    // catches that and `console.error`s the error — the stack-per-attempt
    // flood. A listener is what stops it.
    const queue = Object.assign(new EventEmitter(), { name: 'listing-discover' });
    const lines: unknown[] = [];
    let now = 0;
    summariseQueueErrors(queue, {
      logger: { warn: (...args) => lines.push(args) },
      now: () => now,
    });
    expect(queue.listenerCount('error')).toBe(1);
    expect(() => queue.emit('error', OOM())).not.toThrow();
    queue.emit('error', OOM());
    expect(lines).toHaveLength(1);
    now = 60_000;
    queue.emit('error', OOM());
    expect(lines).toHaveLength(2);
  });
});
