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
 * The Mongo side is untouched. `__tests__/jest.setup.ts` still starts an
 * in-memory replica set per worker and connects mongoose to it; both stores are
 * live for the whole dual-run, and the two harnesses share nothing but the
 * process. Note that setup file sets `MONGODB_URI` ONLY — it used to also write
 * `DATABASE_URL`, which would now overwrite this worker's Postgres URL with a
 * `mongodb://` string.
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

export default async function globalSetup(): Promise<void> {
  process.env.PG_MAX_POOL_SIZE ??= TEST_MAX_POOL_SIZE;

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
