/**
 * PostgreSQL Connection
 *
 * Drizzle ORM over postgres.js (`drizzle-orm/postgres-js`). Runtime-agnostic on
 * purpose: the same code path serves the ECS image (which runs `node
 * packages/backend/dist/server.js`), a developer's `bun run dev:backend`, and
 * the jest suite (which runs under **node**). That last pair is the reason this
 * is postgres.js and NOT `drizzle-orm/bun-sql`: `bun-sql` reaches for the `Bun`
 * global and hard-fails the moment anything loads it outside Bun — which is
 * every production process and every test run in this package.
 *
 * Shape mirrors the Mongo setup in `database/connection.ts`: connect once at
 * boot, then read the handle synchronously from anywhere via {@link getDb}.
 * Both stores are live during the dual-run; neither connector knows about the
 * other, and `config.ts` keeps their URLs in separate keys so a `postgres://`
 * string can never reach mongoose (see the comment on `config.database.url`).
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import config from '../config';
import { Logger } from '../utils/logger';
import { DATABASE_CASING } from './casing';
import * as schema from './schema';

const logger = new Logger('Postgres');

/** Seconds {@link closePostgres} waits for in-flight queries before forcing the socket shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * An open transaction on that pool — the handle `db.transaction(async (tx) => …)`
 * passes its callback.
 *
 * DERIVED from {@link Database} rather than written out, so it cannot drift from
 * the schema or from drizzle's generics when either changes.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Either handle. A write that must be able to JOIN a caller's transaction takes
 * this: a `Transaction` is NOT assignable to `Database` (it has no `$client`),
 * so a helper typed only as `Database` silently forces its caller to run OUTSIDE
 * the transaction — which is how a guarded write loses its atomicity with the
 * work it is supposed to be atomic WITH. Homiio's moderation reconciliation and
 * report intake are the paths that will depend on this.
 */
export type DatabaseOrTransaction = Database | Transaction;

let db: Database | null = null;
let client: postgres.Sql | null = null;

/**
 * Open the connection pool. Call once during startup, before serving traffic.
 *
 * Idempotent: a second call returns the existing handle rather than opening a
 * second pool.
 *
 * @throws {Error} When `DATABASE_URL` is unset — a startup misconfiguration;
 *   fail fast and loudly rather than degrade. A caller that must tolerate a
 *   deployment where Postgres is not provisioned yet checks
 *   `config.postgres.url` first.
 */
export async function connectPostgres(): Promise<Database> {
  if (db) return db;

  const url = config.postgres.url;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Start a local Postgres with: ' +
      'docker compose -f docker-compose.postgres.yml up -d postgres',
    );
  }

  const maxPoolSize = config.postgres.maxPoolSize;
  const instanceClient = postgres(url, {
    max: maxPoolSize,
    idle_timeout: config.postgres.idleTimeoutSeconds,
    connect_timeout: config.postgres.connectTimeoutSeconds,
    max_lifetime: config.postgres.maxLifetimeSeconds,
    onnotice: (notice) => logger.debug('Postgres notice', { notice: notice.message }),
  });

  // postgres.js connects LAZILY, so constructing the pool proves nothing. Issue
  // a real round trip here so an unreachable or misconfigured database fails
  // during startup instead of on the first user request — and only publish the
  // handle once that round trip succeeded, so `isPostgresConnected()` can never
  // report a pool that has never spoken to a server.
  try {
    await instanceClient`select 1`;
  } catch (error) {
    await instanceClient.end({ timeout: CLOSE_TIMEOUT_SECONDS });
    throw error;
  }

  client = instanceClient;
  // Drizzle applies `casing` at RUNTIME when building SQL; drizzle-kit applies
  // it at GENERATE time when emitting DDL. They must agree or queries reference
  // columns the migrations never created — so both read the SAME constant, and
  // `db/casing.ts` owns it.
  db = drizzle(instanceClient, { schema, casing: DATABASE_CASING });

  logger.info('Connected to PostgreSQL successfully', { maxPoolSize });
  return db;
}

/**
 * The connection opened by {@link connectPostgres}.
 *
 * @throws {Error} If called before `connectPostgres()` resolved — a programming
 *   error (a query issued before startup finished), not a runtime condition to
 *   recover from.
 */
export function getDb(): Database {
  if (!db) {
    throw new Error(
      'PostgreSQL is not connected. Call connectPostgres() during startup ' +
      'before issuing queries.',
    );
  }
  return db;
}

/**
 * The raw `postgres.js` handle underneath the drizzle instance.
 *
 * Narrow on purpose, with exactly three legitimate kinds of caller — all
 * one-shot or migration paths, never request-path code:
 *
 *  - the migration LEDGER, which lives in the `drizzle` schema and is
 *    deliberately absent from `db/schema`. Drizzle owns those rows, so
 *    modelling them here would invite application code to write to a table the
 *    migrator treats as its own; reading them needs raw SQL.
 *  - the backfill's bulk loader, because drizzle does not wrap `COPY` — it is a
 *    protocol-level operation with no query-builder equivalent.
 *  - `ANALYZE` after a bulk load, which has no builder form either.
 *
 * Everything serving a request goes through {@link getDb}. A caller reaching for
 * this to run ordinary SQL is bypassing the schema types and the casing
 * configuration that keep queries and migrations agreeing on column names.
 *
 * @throws {Error} If called before `connectPostgres()` resolved — the same
 *   programming error {@link getDb} reports, for the same reason.
 */
export function getPostgresClient(): postgres.Sql {
  if (!client) {
    throw new Error(
      'PostgreSQL is not connected. Call connectPostgres() during startup ' +
      'before reaching for the raw client.',
    );
  }
  return client;
}

/**
 * Whether {@link connectPostgres} has published a handle.
 *
 * SYNCHRONOUS and cheap, so a hot synchronous caller can ask "is there a pool at
 * all?" without a round trip. It is deliberately NOT a liveness check: a pool
 * can exist while the server is unreachable. Anything that must know the
 * database ANSWERS — `/health`, a startup gate — uses
 * {@link checkPostgresHealth}, which issues a real query.
 */
export function isPostgresConnected(): boolean {
  return db !== null;
}

/**
 * Whether the database answers a trivial query right now.
 *
 * Never throws: an unreachable database is a health-check RESULT, not an error
 * for the caller to handle. `/health` is the ALB target-group check, so a thrown
 * exception there would 500 the endpoint and drain the task for the wrong
 * reason — it must be able to report "database down" as data.
 */
export async function checkPostgresHealth(): Promise<boolean> {
  const instanceClient = client;
  if (!instanceClient) return false;
  try {
    await instanceClient`select 1`;
    return true;
  } catch (error) {
    logger.error('Postgres health check failed', error);
    return false;
  }
}

/** Close the pool (for shutdown hooks). Safe to call when never connected. */
export async function closePostgres(): Promise<void> {
  const instanceClient = client;
  if (!instanceClient) return;
  client = null;
  db = null;
  await instanceClient.end({ timeout: CLOSE_TIMEOUT_SECONDS });
}
