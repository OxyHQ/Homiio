/**
 * Shared Jest worker-count computation for `jest.config.js` and
 * `jest.globalSetup.ts`.
 *
 * Both must agree on the same ceiling, because global setup provisions exactly
 * one throwaway Postgres database per worker and each worker then picks its own
 * by `JEST_WORKER_ID`. If setup provisioned fewer than jest forks, the extra
 * workers would index past the end of the manifest and fail on a database that
 * was never created.
 */

const { cpus, totalmem } = require('node:os');

/** Env var global setup writes and each worker reads to pick its database. */
const HOMIIO_JEST_DATABASE_MANIFEST = 'HOMIIO_JEST_DATABASE_MANIFEST';

/**
 * Every worker opens its OWN Postgres pool against the test server. With
 * `PG_MAX_POOL_SIZE = 8` (see `jest.globalSetup.ts`, where 8 is a FLOOR rather
 * than a preference), 10 workers ask for at most 80 connections against a
 * default `max_connections` of 100 — under the ceiling with room for the
 * migrator's own session and a psql.
 *
 * Exceeding it does not fail where the fault is: the server refuses whichever
 * worker happens to ask while it is saturated, so a DIFFERENT and entirely
 * innocent suite goes red on each run. That makes a real regression
 * indistinguishable from noise, which is the state a suite is least useful in.
 */
const POSTGRES_WORKER_CEILING = 10;

/**
 * Memory budget. This package's existing `jest.config.js` pinned
 * `maxWorkers: 2`, which is well inside every ceiling here — the computation
 * exists so the number cannot silently exceed the Postgres ceiling as the
 * config is tuned, not to raise the current value.
 *
 * The ceiling must only ever LOWER the worker count, never raise it: a bare
 * `maxWorkers: 10` written as a constant did both in a sibling repository, and
 * on a 4-vCPU GitHub runner it raised the count past the machine's memory and
 * the kernel took the run down mid-suite — which reads like a hung test rather
 * than an exhausted machine.
 */
const WORKER_BYTES = 1_000_000_000;
const JEST_BASE_BYTES = 2_000_000_000;
const MEMORY_BUDGET_FRACTION = 0.75;

/**
 * The declared worker count for this package.
 *
 * Kept at the value `jest.config.js` already used. Raising it is a deliberate
 * decision that has to be taken together with `PG_MAX_POOL_SIZE`, because the
 * product of the two is what the Postgres server sees.
 */
const DECLARED_MAX_WORKERS = 2;

/**
 * @returns {number} Jest `maxWorkers` — the smallest of the declared, Postgres,
 *   CPU and memory ceilings.
 */
function computeMaxWorkers() {
  return Math.min(
    DECLARED_MAX_WORKERS,
    POSTGRES_WORKER_CEILING,
    Math.max(1, cpus().length - 1),
    Math.max(
      1,
      Math.floor((totalmem() * MEMORY_BUDGET_FRACTION - JEST_BASE_BYTES) / WORKER_BYTES),
    ),
  );
}

module.exports = {
  HOMIIO_JEST_DATABASE_MANIFEST,
  computeMaxWorkers,
};
