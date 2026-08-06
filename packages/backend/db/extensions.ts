/**
 * Everything that must exist in a database BEFORE the first migration runs.
 *
 * Two kinds of prerequisite, both created here rather than inside a numbered
 * migration: three Postgres extensions, and the `homiio_simple` text-search
 * configuration.
 *
 * The registry is DATA with a reason per entry — the same shape as
 * `schema/deferredForeignKeys.ts` and `schema/protectedColumns.ts`, for the same
 * reason: a rule a reader can enumerate beats a rule spread across the files
 * that happen to need it.
 *
 * ## Why none of this is a numbered migration
 *
 * An extension has to exist BEFORE the first statement that names a type it
 * provides. `addresses.geo` is a generated `geography` column, so migration 0000
 * fails outright on a database with no PostGIS — and it fails only on a FRESH
 * database, which is exactly the shape that passes on a developer's warm machine
 * and then fails in CI or on a new RDS instance.
 *
 * Putting `CREATE EXTENSION` in a numbered migration would answer that only for
 * as long as nobody renumbers, squashes or regenerates the sequence. Schema TS
 * is the source of truth here and migrations get regenerated under whatever
 * number is correct, so anything that must be true before migration 0000 cannot
 * live INSIDE the numbered sequence at all.
 *
 * It is a precondition of the MIGRATOR instead: `db/migrate.ts` runs
 * {@link ensureExtensions} before applying anything, and that is the single
 * migration mechanism in this package — a developer, CI, the jest harness and
 * the production one-shot task all go through it. So there is no environment
 * where the ordering can be wrong.
 *
 * ## `CREATE EXTENSION ... IF NOT EXISTS` is NOT a fallback, and the difference
 * only shows up on a database nobody has prepared
 *
 * PostGIS is not a TRUSTED extension, so on RDS it needs `rds_superuser` —
 * **owning the database is not enough.** `IF NOT EXISTS` short-circuits on the
 * duplicate check BEFORE the privilege check, which means:
 *
 *  - on a database somebody already prepared, this step is a NOTICE and a no-op,
 *    even for an unprivileged role. That is the whole of what the clause buys.
 *  - on a NEW database it is a hard failure:
 *    `ERROR: permission denied to create extension "postgis"`.
 *
 * So a new target database is a two-party job: a privileged role runs
 * `CREATE EXTENSION postgis; unaccent; pg_trgm;` ONCE, and only then can the
 * `homiio` role migrate. `db/MIGRATION-CONTRACT.md` carries that as an infra
 * precondition. A guard of the form `CREATE EXTENSION IF NOT EXISTS` inside
 * application migration code does not cover it and must not be mistaken for
 * cover: it looks like protection and provides none.
 *
 * ## The trap the docker image does NOT cover, and the one a dump does not either
 *
 * `postgis/postgis` seeds PostGIS into `$POSTGRES_DB` and into a
 * `template_postgis` template — NOT into `template1`. Every throwaway test
 * database is a plain `create database "…"`, i.e. from `template1`, so it lands
 * WITHOUT PostGIS. Running the right image is necessary and not sufficient.
 *
 * A **text-search configuration is per-database and does not travel through
 * `template1` either**, and unlike an extension it is not something an operator
 * would think to install by hand. Every throwaway test database therefore needs
 * `homiio_simple` created for it too, which is why this step creates the
 * configuration rather than assuming infrastructure did.
 */

import postgres from 'postgres';
import {
  type RequiredExtension,
  assertMigrationTarget,
  ensureExtensions as ensureRequiredExtensions,
} from '@oxyhq/db/migrate';

/** Seconds the one-shot admin connection waits before forcing itself shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

/**
 * The text-search configuration every Homiio `tsvector` is built with.
 *
 * NOT `'english'`, and not `'simple'` unaided. Homiio's corpus is
 * Spanish-first — property titles and descriptions from Idealista, Fotocasa,
 * Habitaclia and the rest — while Mongo's text index applied ENGLISH stemming
 * by default, so a faithful port of the config would carry a bug rather than a
 * behaviour. `simple` does no stemming at all, which is the honest choice for a
 * multi-language corpus; `unaccent` in front of it is what makes a search for
 * `malaga` find `Málaga`, which is the single most common miss in this data.
 *
 * Referenced as a LITERAL in every generated column: the one-argument
 * `to_tsvector(x)` reads `default_text_search_config` at runtime and is
 * therefore STABLE, which Postgres refuses in a `GENERATED ALWAYS` column.
 */
export const TEXT_SEARCH_CONFIGURATION = 'homiio_simple';

/**
 * Token types whose lexemes are rewired through `unaccent`.
 *
 * Only the non-ASCII-capable token types need it. `asciiword` and friends are
 * ASCII by definition, so `unaccent` would be a no-op on them, and both sides of
 * a comparison still end at the same `simple` dictionary: `Málaga` is parsed as
 * `word` → `unaccent` → `simple` → `malaga`, while `malaga` is parsed as
 * `asciiword` → `simple` → `malaga`. The two meet.
 */
const UNACCENTED_TOKEN_TYPES = ['word', 'hword', 'hword_part'] as const;

/**
 * Extension names are interpolated into DDL (`CREATE EXTENSION` takes no bound
 * parameter), so the vocabulary is constrained to what a real extension name can
 * contain. Every entry below is a literal in this file; the guard exists so a
 * future entry read from anywhere else cannot become an injection site.
 */
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

/**
 * Every extension the schema depends on. An entry here is a claim that some
 * column, index or constraint does not exist without it — not a convenience.
 */
export const REQUIRED_EXTENSIONS: readonly RequiredExtension[] = [
  {
    name: 'postgis',
    reason:
      '`addresses.geo` is a generated `geography` point column with a GiST ' +
      'index, replacing the Mongo `2dsphere` index that every `$near` / ' +
      '`$geoWithin` / `$centerSphere` property search runs against. ' +
      '`geography`, `ST_MakePoint`, `ST_DWithin` and `ST_Distance` all come ' +
      'from PostGIS.',
  },
  {
    name: 'unaccent',
    reason:
      `the \`${TEXT_SEARCH_CONFIGURATION}\` text-search configuration maps its ` +
      'word tokens through the `unaccent` dictionary, so a search for ' +
      '`malaga` matches `Málaga`. Homiio\'s corpus is Spanish-first and ' +
      'accented place names are the norm, not the exception.',
  },
  {
    name: 'pg_trgm',
    reason:
      'the unanchored name typeahead in `cityController.searchCities` and ' +
      '`neighborhoodController` is a `/q/i` regex in Mongo. Its Postgres form ' +
      'is `ILIKE \'%q%\'`, which only uses an index with a `gin_trgm_ops` GIN ' +
      'index — without it every keystroke is a sequential scan of the whole ' +
      'cities table.',
  },
];

/**
 * Create the required extensions and the `homiio_simple` text-search
 * configuration on `databaseUrl`.
 *
 * Idempotent: the extensions are `IF NOT EXISTS` and the configuration is
 * created only when `pg_ts_config` does not already hold it — `CREATE TEXT
 * SEARCH CONFIGURATION` has no `IF NOT EXISTS` clause of its own.
 *
 * @param databaseUrl The database to prepare.
 * @param expectedDatabase The name the caller believes `databaseUrl` resolves
 *   to. Asserted as the FIRST statement issued, before anything is created:
 *   creating an extension on the wrong database is precisely the mistake
 *   `--target-database` exists to catch, and this function writes.
 * @throws {Error} When the connected database is not `expectedDatabase`, when an
 *   extension is unavailable in the server's installation, or when the role may
 *   not create one and nobody has installed it already. All three are
 *   environment faults that must stop the migration rather than let it fail
 *   later with a confusing `type "geography" does not exist`.
 */
export async function ensureExtensions(
  databaseUrl: string,
  expectedDatabase: string,
): Promise<void> {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    // FIRST statement on this connection, before anything is created.
    await assertMigrationTarget(client, expectedDatabase);

    // The extensions next: `homiio_simple` names the `unaccent` dictionary, so
    // it cannot be created before the extension that provides it.
    //
    // `ensureRequiredExtensions` opens its OWN short-lived connection rather
    // than reusing this one. That is the shared package's shape and it is left
    // alone; the target assertion above has already run against the same URL.
    await ensureRequiredExtensions(databaseUrl, REQUIRED_EXTENSIONS);
    await ensureTextSearchConfiguration(client);
  } finally {
    await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
  }
}

/**
 * Create `homiio_simple` if this database does not have it.
 *
 * Split out and given `client` rather than a URL so it runs on the SAME
 * connection that asserted the target database.
 */
async function ensureTextSearchConfiguration(client: postgres.Sql): Promise<void> {
  if (!IDENTIFIER.test(TEXT_SEARCH_CONFIGURATION)) {
    throw new Error(
      `Refusing to create text search configuration "${TEXT_SEARCH_CONFIGURATION}": ` +
      'a configuration name must match /^[a-z][a-z0-9_]*$/.',
    );
  }

  const existing = await client<{ oid: number }[]>`
    select c.oid
    from pg_ts_config c
    join pg_namespace n on n.oid = c.cfgnamespace
    where c.cfgname = ${TEXT_SEARCH_CONFIGURATION}
      and n.nspname = 'public'
  `;
  if (existing.length > 0) return;

  try {
    // `COPY = simple` inherits every token-type mapping from the built-in
    // `simple` configuration; the ALTER below then replaces the mapping for the
    // token types that can carry accents.
    await client.unsafe(
      `create text search configuration public."${TEXT_SEARCH_CONFIGURATION}" (copy = simple)`,
    );
    await client.unsafe(
      `alter text search configuration public."${TEXT_SEARCH_CONFIGURATION}" ` +
      `alter mapping for ${UNACCENTED_TOKEN_TYPES.join(', ')} ` +
      'with unaccent, simple',
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not create the "${TEXT_SEARCH_CONFIGURATION}" text search configuration: ${detail}\n` +
      'It is required because every Homiio `tsvector` names it as a literal ' +
      'configuration, and a text search configuration is PER DATABASE — it does ' +
      'not travel through `template1`, so a database restored from a dump or ' +
      'created fresh needs it created explicitly. On a managed database the ' +
      '`unaccent` extension must exist first, which needs a privileged role.',
    );
  }
}
