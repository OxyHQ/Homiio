/**
 * Jest global setup — Postgres.
 *
 * Creates one throwaway, fully-migrated database PER WORKER and writes their
 * URLs to a manifest file. `jest.setupWorkerDatabase.cjs` runs in each worker
 * before test files load and points `DATABASE_URL` at that worker's own entry,
 * so parallel suites cannot race on shared rows.
 *
 * This runs for EVERY `bun run test`, which makes a reachable Postgres a HARD
 * prerequisite of the suite — deliberately. The alternative (skipping the
 * database tests when no server answers) is a check that cannot tell success
 * from failure: it would report green on a machine where the schema is broken,
 * absent, or never migrated at all. Start one with:
 *
 *   docker compose -f docker-compose.postgres.yml up -d postgres
 *
 * Postgres is the only store this harness prepares. `__tests__/jest.setup.ts`
 * used to boot an in-memory Mongo replica set per worker; that went with
 * `mongoose` and `mongodb-memory-server`, so there is no second harness left to
 * coordinate with.
 */

import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabases } from './db/testDatabase';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { computeMaxWorkers, HOMIIO_JEST_DATABASE_MANIFEST } = require('./jest.workerCount.cjs');

/**
 * Connections one worker's pool may open.
 *
 * **8 is a FLOOR, not a preference, and not a tuning knob.** The runtime default
 * is 20, sized for a long-lived API process; every jest worker opening one of
 * those against the same server is how a suite exhausts `max_connections`.
 *
 * Shrinking it further does not merely slow the suite down — it changes what the
 * suite MEASURES. A pool of 1 serialises every concurrent operation, so the
 * contention branches (a transaction meeting another writer, a retry on a
 * serialization failure) never execute, and every test still passes while
 * covering less. That was measured in the sibling Mention port as a coverage
 * drop from 98.78 to 95.12 with no test turning red.
 *
 * Set BEFORE jest forks, so every worker inherits it; an explicit
 * `PG_MAX_POOL_SIZE` in the environment still wins, for anyone deliberately
 * measuring pool behaviour.
 */
const TEST_MAX_POOL_SIZE = '8';

/**
 * Seconds an unused connection may sit open before postgres.js reaps it.
 *
 * The runtime default is 30, which is right for a long-lived API process and
 * catastrophic here, because **jest abandons a connection pool per test FILE**.
 * Each file gets a fresh module registry AND a fresh VM context, so
 * `db/postgres.ts`'s handles start out null again and `connectPostgres()` opens
 * a NEW pool; the previous file's pool is unreachable from the new context and
 * only the ~22 suites that call `closePostgres()` themselves ever end one.
 * Nothing can share a pool across files — not a module-level `let`, and not
 * `globalThis`, which jest also replaces (both were tried).
 *
 * So abandoned pools are inherent, and the only question is how long their
 * sockets linger. At 30s they outlive the entire run and accumulate: measured
 * 34 connections climbing to 104 against a `max_connections` of 100 within six
 * seconds, then 708 failures — reported as `sorry, too many clients already` in
 * whichever suite happened to ask while the server was saturated, never in the
 * one at fault. At 1s they are reclaimed continuously and the run stays flat.
 *
 * This was latent long before it fired. The suite stayed under the ceiling only
 * because two slow Mongo-booting suites ran first and throttled the early
 * phase; deleting them removed that accidental throttling.
 *
 * It changes nothing a test MEASURES — a reaped connection is reopened on
 * demand, and `PG_MAX_POOL_SIZE` still governs concurrency, which is the knob
 * that would alter behaviour.
 */
const TEST_IDLE_TIMEOUT_SECONDS = '1';

export default async function globalSetup(): Promise<void> {
  process.env.PG_MAX_POOL_SIZE ??= TEST_MAX_POOL_SIZE;
  process.env.PG_IDLE_TIMEOUT_SECONDS ??= TEST_IDLE_TIMEOUT_SECONDS;

  const workerCount = computeMaxWorkers();
  const urls = await createTestDatabases(workerCount);

  // Keyed on this process's pid so two concurrent `bun run test` invocations on
  // one machine cannot read each other's manifest and drop each other's
  // databases.
  const manifestPath = join(tmpdir(), `homiio-jest-databases-${process.pid}.json`);
  writeFileSync(manifestPath, JSON.stringify(urls));
  process.env[HOMIIO_JEST_DATABASE_MANIFEST] = manifestPath;

  // Global setup and teardown share this process; keep a valid URL here for
  // teardown's own guards and for anything that runs before workers fork.
  process.env.DATABASE_URL = urls[0];
}
