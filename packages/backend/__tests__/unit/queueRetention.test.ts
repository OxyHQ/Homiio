/**
 * The listing queues kept every job they had ever finished.
 *
 * BullMQ does not delete a completed or failed job unless the job says so:
 * its hash stays in Redis and its id stays in the `completed` / `failed`
 * sorted set. Nothing in this repository set `removeOnComplete` or
 * `removeOnFail` — `grep` found zero occurrences outside `dist/` — so both
 * listing queues grew monotonically with every pass, successful or not.
 *
 * Measured on the dedicated queue node on 2026-09-22, with the worker at
 * desired-count 0 so nothing was adding anything:
 *
 *     used_memory 317.84M / maxmemory 384.00M   (82.8%, policy noeviction)
 *     listing-fetch     prioritized 64250  completed  6988  failed 17992
 *     listing-discover  prioritized   682  completed 21510  failed 12385
 *
 * 58,875 of 124,506 keys were finished work. `noeviction` does not shed them
 * under pressure — it refuses WRITES, which is what produced 1.6 million
 * `OOM command not allowed` errors across seven services on 2026-09-21.
 *
 * ## What this file can and cannot check
 *
 * It checks the bounds and the builder that carries them. It CANNOT check that
 * `worker.ts` calls the builder, because importing `worker.ts` starts a worker
 * process. That is why the builder exists at all rather than an options literal
 * at each call site: a future queue gets the bounds by using the builder, and
 * the only thing left unguarded is someone writing a fresh literal instead.
 * Stated plainly here rather than implied, because a test whose coverage is
 * overstated is how the original gap survived.
 */

import {
  COMPLETED_JOB_RETENTION,
  FAILED_JOB_RETENTION,
  LISTING_JOB_RETENTION,
  listingQueueOptions,
} from '../../services/ingestion/queues';

describe('finished-job retention', () => {
  it('bounds completed jobs by BOTH age and count', () => {
    // Either alone is unbounded in the other dimension: a count with no age
    // keeps 1,000 jobs from last March, an age with no count keeps however many
    // a burst produced within the window — and a burst is exactly the case.
    expect(COMPLETED_JOB_RETENTION.age).toBeGreaterThan(0);
    expect(COMPLETED_JOB_RETENTION.count).toBeGreaterThan(0);
    expect(Number.isFinite(COMPLETED_JOB_RETENTION.count)).toBe(true);
  });

  it('bounds failed jobs by BOTH age and count', () => {
    expect(FAILED_JOB_RETENTION.age).toBeGreaterThan(0);
    expect(FAILED_JOB_RETENTION.count).toBeGreaterThan(0);
    expect(Number.isFinite(FAILED_JOB_RETENTION.count)).toBe(true);
  });

  it('keeps failures longer than successes, because only failures diagnose', () => {
    // `listing-fetch` was failing 17,992 against 6,988 successes and nothing
    // else in the system recorded that. A success is already recorded — the
    // listing is in Postgres.
    expect(FAILED_JOB_RETENTION.age).toBeGreaterThan(COMPLETED_JOB_RETENTION.age);
    expect(FAILED_JOB_RETENTION.count).toBeGreaterThan(COMPLETED_JOB_RETENTION.count);
  });

  it('stays far below the census that filled the node', () => {
    // The whole point is a ceiling well under what was observed. Both queues at
    // their caps is 12,000 finished jobs against the 58,875 measured.
    const ceiling = 2 * (COMPLETED_JOB_RETENTION.count + FAILED_JOB_RETENTION.count);
    expect(ceiling).toBeLessThan(58_875 / 4);
  });

  it('is what the builder hands every queue', () => {
    const options = listingQueueOptions({ host: 'h', port: 6379 }, 'bull-homiio-listings');

    expect(options.defaultJobOptions).toBe(LISTING_JOB_RETENTION);
    expect(options.defaultJobOptions.removeOnComplete).toBe(COMPLETED_JOB_RETENTION);
    expect(options.defaultJobOptions.removeOnFail).toBe(FAILED_JOB_RETENTION);
  });

  it('passes the connection and prefix through untouched', () => {
    // The builder replaced an options literal. A builder that quietly changed
    // the prefix would point the worker at a different keyspace and look like a
    // queue that had simply gone quiet.
    const connection = { host: 'queue.internal', port: 6380 };
    const options = listingQueueOptions(connection, 'bull-homiio-listings');

    expect(options.connection).toBe(connection);
    expect(options.prefix).toBe('bull-homiio-listings');
  });
});
