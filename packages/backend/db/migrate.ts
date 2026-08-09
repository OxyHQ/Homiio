/**
 * Apply the SQL migrations in `drizzle/` to `DATABASE_URL`.
 *
 * This is the ONE migration mechanism for the Postgres side of this package.
 * `bun run db:migrate` runs it, the jest harness (`db/testDatabase.ts`) calls
 * the same function in-process, CI runs the same script, and production will run
 * its COMPILED form (`dist/db/migrate.js`) as a one-shot ECS task. Nothing
 * applies a migration by any other route.
 *
 * The actual apply — journal read, phase-marker read, ledger read, extension
 * setup, `migrate()`, the post-apply re-check — is `runMigrations` from
 * `@oxyhq/db/migrate`; see its own doc comment for the full ordering and why
 * each step comes where it does. This file supplies what that mechanism needs
 * from THIS package: its migrations folder, its extensions, and BOTH guards.
 *
 * ## Two guards, and Homiio carries both because they catch different mistakes
 *
 * `--target-database=<name>` (REQUIRED, on every run, including `DRY_RUN`) is
 * checked against `current_database()` before any other statement. It answers
 * "am I pointed where I think I am?" — and the migration step needs that more
 * than the copy does, because it fails SUCCESS-SHAPED. Aimed at the wrong
 * database the copy dies on a missing table; the migrator finds an empty ledger,
 * applies the whole journal, logs `Applied N migration(s)` and exits 0, leaving
 * the real database untouched while the operator reads a success line.
 *
 * `--phase=pre|post|all` answers a different question: "which side of a
 * deployment is this?" A `post` migration (a DROP, a RENAME, a narrowed CHECK)
 * applied while the previous image is still serving is an outage on that image;
 * a `pre` migration not applied before the new image rolls out is an outage on
 * the new one. Every migration `.sql` declares its side on one line and there is
 * NO DEFAULT — see `@oxyhq/db/migrate`'s `phases.ts` for the incident.
 *
 * Neither is spelled with a default in this file. `package.json`'s `db:migrate`
 * script supplies `--phase=all` because a developer database, the jest harness
 * and a manual dispatch have no previous image to protect; a production one-shot
 * task states its own phase explicitly on the command line.
 *
 * ## What is deliberately NOT here yet
 *
 * No cross-process advisory lock. drizzle's migrator takes no lock of its own —
 * it reads the ledger's high-water mark OUTSIDE its transaction, then replays
 * everything newer inside one — so two concurrent runs both replay the same DDL
 * and the loser fails on an already-applied statement. Homiio has no path that
 * can run two migrators today (nothing in `deploy-aws.yml` runs migrations at
 * all yet). Wiring the deploy to migrate is what makes a deploy race a manual
 * dispatch, so the lock is a PRECONDITION of that change, not of this one. See
 * `db/MIGRATION-CONTRACT.md`.
 *
 * ## Why not `drizzle-kit migrate`
 *
 * drizzle-kit is a CLI that cannot reach production: it is a devDependency and
 * the shipped image installs production dependencies only. `drizzle-orm` — a
 * runtime dependency — ships the migrator itself, so the migrator compiles into
 * the SAME image the service runs and adds no dependency at all.
 *
 * BOTH TOOLS SHARE ONE LEDGER. `drizzle-kit migrate` and `drizzle-orm`'s
 * `migrate()` read the same `meta/_journal.json`, write the same
 * `drizzle.__drizzle_migrations` rows, and apply the same "everything newer than
 * the newest recorded `created_at`" rule — so a database migrated by either is
 * understood by the other. drizzle-kit stays a devDependency for `db:generate`,
 * which only ever runs on a developer's machine.
 *
 * DRY RUN. `DRY_RUN=true` reports what this phase WOULD apply and writes
 * nothing — not even the ledger table, and not the extensions either.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import {
  MIGRATION_RUNS,
  type MigrationRun,
  assertPostgresMigrationsCurrent,
  readJournal,
  readTargetDatabase,
  runMigrations,
} from '@oxyhq/db/migrate';
import { Logger } from '../utils/logger';
import { ensureExtensions } from './extensions';

const logger = new Logger('PostgresMigrate');

/** Seconds to wait for in-flight queries before forcing the socket shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

/** Directory levels to walk up from `__dirname` looking for `drizzle/`. */
const MIGRATIONS_FOLDER_SEARCH_DEPTH = 6;

/**
 * The absolute path of this package's `drizzle/` folder.
 *
 * Found by walking UP from `__dirname` until a `drizzle/meta/_journal.json`
 * appears, rather than by a fixed relative path. A fixed path cannot be right
 * for both callers: this file runs from `db/` under ts-node and from `dist/db/`
 * once compiled, and the two are at different depths relative to the package
 * root the folder actually sits in.
 *
 * Getting this wrong is the quietest failure in the whole mechanism, which is
 * why it THROWS rather than returning a best guess. Handed a folder that does
 * not exist, drizzle's migrator applies nothing, reports success and exits 0 —
 * byte for byte the same output as a correctly up-to-date database. That is
 * exactly what a production one-shot task looks like when the image shipped
 * without its journal, and it is the reason `Dockerfile` copies `drizzle/`
 * alongside `dist/`.
 *
 * @throws {Error} When no `drizzle/meta/_journal.json` is found.
 */
export function findMigrationsFolder(): string {
  let directory = __dirname;
  for (let level = 0; level < MIGRATIONS_FOLDER_SEARCH_DEPTH; level += 1) {
    const candidate = join(directory, 'drizzle');
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(
    `No drizzle/meta/_journal.json found above ${__dirname}. Migrations cannot ` +
    'be applied from a tree that does not contain them — and a missing folder ' +
    'does NOT fail on its own: drizzle applies nothing and exits 0, which is ' +
    'indistinguishable from an up-to-date database. In a container this means ' +
    'the image was built without `COPY … packages/backend/drizzle`.',
  );
}

/** Whether `DRY_RUN` asks for a report instead of an apply. */
function isDryRun(): boolean {
  const value = (process.env.DRY_RUN ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/**
 * The `--phase=<run>` argument.
 *
 * @throws {Error} When absent, repeated, or naming a phase that does not exist.
 *   There is deliberately no default: a run that does not say which side of a
 *   deploy it is on would have to guess, and guessing `pre` silently strands a
 *   drop while guessing `all` silently runs one against a live previous image.
 */
export function readMigrationRun(argv: readonly string[]): MigrationRun {
  const prefix = '--phase=';
  const flags = argv.filter((argument) => argument.startsWith(prefix));

  if (flags.length === 0) {
    throw new Error(
      `--phase is required. Use one of: ${MIGRATION_RUNS.map((run) => `${prefix}${run}`).join(', ')}. ` +
      '`--phase=all` is the right answer for a developer database, the jest ' +
      'harness or a manual dispatch; a deploy states `pre` before the rollout ' +
      'and `post` after it.',
    );
  }
  if (flags.length > 1) {
    throw new Error(`--phase was given ${flags.length} times: ${flags.join(' ')}.`);
  }

  const value = flags[0].slice(prefix.length);
  if (!(MIGRATION_RUNS as readonly string[]).includes(value)) {
    throw new Error(
      `Unrecognised --phase=${value}. Use one of: ${MIGRATION_RUNS.join(', ')}.`,
    );
  }
  return value as MigrationRun;
}

/**
 * Apply every migration this phase may apply.
 *
 * Exported so the jest harness can migrate a throwaway database in-process
 * rather than shelling out to a second copy of this logic — there is one
 * migration mechanism, and a test database is migrated by it.
 *
 * @param databaseUrl The database to migrate.
 * @param target The name `databaseUrl` must resolve to.
 * @param run Which side of a deploy this is.
 * @param dryRun Report and write nothing.
 */
export async function applyMigrations(
  databaseUrl: string,
  target: string,
  run: MigrationRun,
  dryRun: boolean,
): Promise<void> {
  const migrationsFolder = findMigrationsFolder();
  const entries = readJournal(migrationsFolder);

  // Reported on EVERY run, dry or not. The cutover compares this count against
  // `meta/_journal.json` at the pinned SHA, because an image built before a
  // migration existed prints `No migrations to apply`, exits 0, and is otherwise
  // byte-identical to the correct case.
  logger.info('Postgres migration plan', {
    target,
    phase: run,
    dryRun,
    journalEntries: entries.length,
    migrationsFolder,
  });

  if (!dryRun) {
    // Before `runMigrations`, because `homiio_simple` and the three extensions
    // must exist before any DDL that names a `geography` type or that
    // configuration. Asserts the target database itself as its first statement,
    // so it cannot create anything on a database the operator did not name.
    //
    // Deliberately unconditional rather than "only when something is pending":
    // a text-search configuration is per-database and does not survive a
    // restore from a plain dump, so a database that is fully migrated can still
    // be missing it, and that is a silent wrong-answer rather than an error.
    await ensureExtensions(databaseUrl, target);
  }

  await runMigrations({
    databaseUrl,
    migrationsFolder,
    // Already ensured above, on a connection that checked the target first.
    // Passing them again would create them a second time on a DRY RUN, which
    // must write nothing at all.
    extensions: [],
    run,
    expectedDatabase: target,
    dryRun,
    logger: {
      info: (message) => logger.info(message),
      debug: (message) => logger.debug(message),
    },
  });

  // `runMigrations` already re-reads the ledger and refuses to report success
  // over work it undertook and did not complete. This is the stronger claim,
  // and it is only TRUE for `all`: a `pre` run leaves `post` migrations pending
  // on purpose, so asserting "nothing is pending" there would fail a correct
  // deployment.
  if (run === 'all' && !dryRun) {
    const client = postgres(databaseUrl, { max: 1 });
    try {
      await assertPostgresMigrationsCurrent(client, entries);
    } finally {
      await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
    }
  }
}

async function main(): Promise<void> {
  // Argument validation first, before DATABASE_URL and before anything opens a
  // socket: an operator who forgot a flag should learn it instantly rather than
  // after a connection attempt.
  const target = readTargetDatabase(process.argv.slice(2));
  const run = readMigrationRun(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Start a local Postgres with: ' +
      'docker compose -f docker-compose.postgres.yml up -d postgres',
    );
  }

  await applyMigrations(url, target, run, isDryRun());
}

// `require.main === module` rather than an unconditional call: this file is BOTH
// a CLI entrypoint and a module the jest harness imports for `applyMigrations`.
// Without the guard, importing it would start a migration as a side effect of
// the import.
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('Postgres migration failed', error);
    // Not `process.exit`: it would truncate the very message that says what went
    // wrong. The event loop is already free once every pool is closed.
    process.exitCode = 1;
  });
}
