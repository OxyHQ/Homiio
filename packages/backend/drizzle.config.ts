import { defineConfig } from 'drizzle-kit';
import { DATABASE_CASING } from '@oxyhq/db';

/**
 * drizzle-kit configuration.
 *
 * - `bun run db:generate` diffs `schema` against `out/` and writes a new SQL
 *   migration. It never opens a database for that, and it only ever runs on a
 *   developer's machine.
 * - Migrations are APPLIED by `bun run db:migrate` (`db/migrate.ts`), which uses
 *   drizzle-orm's own migrator over the files in `out/` — not `drizzle-kit
 *   migrate`. drizzle-kit is a devDependency and the shipped image installs
 *   production dependencies only, so the CLI could never apply a migration in
 *   production. A developer, CI, the jest harness and production all run that
 *   one migrator; see its docblock.
 *
 * `casing` decides what the DDL CREATES; the same value passed to `drizzle()` in
 * `db/postgres.ts` decides what queries REFERENCE. Both read it from `@oxyhq/db`
 * (re-exported through `db/casing.ts` for application code) so they cannot drift
 * apart — and if they did, queries would reference columns the migrations never
 * created.
 *
 * `strict: true` makes drizzle-kit confirm before it writes anything it inferred
 * rather than was told.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is required by drizzle-kit. Start a local Postgres with:\n' +
    '  docker compose -f ../../docker-compose.postgres.yml up -d postgres\n' +
    'then set DATABASE_URL in packages/backend/.env (see .env.example).',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './drizzle',
  casing: DATABASE_CASING,
  strict: true,
  verbose: true,
  dbCredentials: { url },
});
