/**
 * Throwaway Test Database
 *
 * Creates a uniquely-named, fully-migrated database per jest worker and drops
 * them again. `jest.globalSetup.ts` calls {@link createTestDatabases}; each
 * worker then points `DATABASE_URL` at its own entry
 * (`jest.setupWorkerDatabase.cjs`), so parallel suites cannot race on shared
 * rows.
 *
 * ## One migration mechanism, not two
 *
 * The schema is applied by calling `applyMigrations` from `db/migrate.ts`
 * DIRECTLY — the same function `bun run db:migrate` runs, over the same
 * `drizzle/` files, with the same phase planner and the same extension
 * prerequisites. There is deliberately no second migrator and no `spawn` of a
 * package script: a harness that builds its schema by a different route is a
 * harness that can pass against a schema production will never have.
 *
 * `@oxyhq/db/testing` owns create and drop; this module owns the migrate hook
 * and the safety assertion below.
 *
 * ## The drop guard
 *
 * `dropTestDatabase` refuses any name that is not one `createTestDatabase`
 * minted. That guard is what stops a stray `DATABASE_URL` — a developer's,
 * production's — from being handed to `DROP DATABASE` by a teardown that reads
 * its target from the environment. It is checked BEFORE any connection is
 * opened, so a wrong name never reaches a server at all.
 *
 * **The prefix is `oxydb_test_`, not `homiio_test_`.** `@oxyhq/db/testing` mints
 * the name and hard-codes that prefix, and it is not configurable. The safety
 * PROPERTY is identical either way — an affirmative pattern match against a
 * name this process generated — so the shared implementation is used rather than
 * forked for a cosmetic difference. {@link assertDroppableTestDatabase} restates
 * the same pattern locally so the rule is greppable from this package and so a
 * future change to the shared prefix fails here rather than silently widening
 * what teardown may drop.
 */

import { createTestDatabase as createSharedTestDatabase, dropTestDatabase as dropSharedTestDatabase } from '@oxyhq/db/testing';
import { applyMigrations } from './migrate';

/**
 * The name shape `@oxyhq/db/testing` mints, restated here as a local guard.
 *
 * If the shared package ever changes its prefix, this assertion fails loudly on
 * the first test run instead of quietly accepting a wider set of droppable
 * names.
 */
const TEST_DATABASE_NAME = /^oxydb_test_[0-9a-f]{16}$/;

/**
 * The Postgres server throwaway databases are created on.
 *
 * `TEST_DATABASE_URL` first so CI can point the suite at its service container
 * without disturbing a developer's own `DATABASE_URL`. There is NO fallback to a
 * guessed local server: a reachable Postgres is a hard prerequisite of this
 * suite, and inventing one would create throwaway databases somewhere nobody
 * intended.
 *
 * @throws {Error} When neither variable is set.
 */
function adminUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL (or DATABASE_URL) must point at a Postgres server so a ' +
      'throwaway test database can be created on it. Start one with:\n' +
      '  docker compose -f docker-compose.postgres.yml up -d postgres\n' +
      'A reachable Postgres is a HARD prerequisite of this suite — skipping the ' +
      'database tests when it is absent would be a check that cannot tell ' +
      'success from failure.',
    );
  }
  return url;
}

/**
 * Refuse a database name this module did not mint.
 *
 * @throws {Error} When `databaseUrl` does not name a throwaway database.
 */
export function assertDroppableTestDatabase(databaseUrl: string): void {
  const name = new URL(databaseUrl).pathname.replace(/^\//, '');
  if (!TEST_DATABASE_NAME.test(name)) {
    throw new Error(
      `Refusing to drop "${name}": only throwaway databases created by ` +
      `createTestDatabase (${TEST_DATABASE_NAME.source}) may be dropped.`,
    );
  }
}

/**
 * Create one throwaway database and apply every migration to it.
 *
 * @returns The throwaway database's own connection string.
 */
export async function createTestDatabase(): Promise<string> {
  return createSharedTestDatabase({
    adminUrl: adminUrl(),
    // `--phase=all`: a throwaway database has no previous image to protect, so
    // every pending migration applies. `target` is the database's own name,
    // which is what the affirmative target check compares against
    // `current_database()`.
    migrate: async (url) => {
      const name = new URL(url).pathname.replace(/^\//, '');
      await applyMigrations(url, name, 'all', false);
    },
  });
}

/**
 * Create `count` independent, fully-migrated throwaway databases — one per jest
 * worker.
 *
 * Sequential rather than concurrent on purpose: `CREATE DATABASE` takes a lock
 * on the template it copies, so parallel creates serialise on the server anyway
 * and only make a failure harder to attribute.
 */
export async function createTestDatabases(count: number): Promise<string[]> {
  const urls: string[] = [];
  for (let index = 0; index < count; index += 1) {
    urls.push(await createTestDatabase());
  }
  return urls;
}

/**
 * Drop a database created by {@link createTestDatabase}.
 *
 * @throws {Error} If `databaseUrl` does not name a throwaway database — checked
 *   before any connection is opened.
 */
export async function dropTestDatabase(databaseUrl: string): Promise<void> {
  assertDroppableTestDatabase(databaseUrl);
  await dropSharedTestDatabase(databaseUrl);
}
