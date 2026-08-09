/**
 * Schema-wide invariants, asserted against the REAL migrated database rather
 * than against the TypeScript declarations.
 *
 * The distinction matters: drizzle applies casing when it BUILDS SQL, so a
 * declaration can look correct and still emit a column the migration never
 * created. Every check here reads `information_schema` / `pg_catalog` on the
 * throwaway database this worker migrated, so it tests what actually exists.
 *
 * The bulk of the rules come from `@oxyhq/db/assert`, which returns a single
 * violation list with its own vacuity floors folded in — a floor a consumer
 * could forget to assert separately would protect nothing. What is added here is
 * Homiio-specific: the extensions this schema cannot work without, and the
 * agreement between the schema BARREL and the database.
 */

import { getTableName, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { findSchemaInvariantViolations } from '@oxyhq/db/assert';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { REQUIRED_EXTENSIONS } from '../../db/extensions';
import * as schema from '../../db/schema';

/**
 * Traversal floors. Migrations 0000-0007 create SIXTY-ONE tables and 868
 * columns between them (`properties` alone carries 135); a run that finds fewer
 * than this has a broken catalogue query, not a clean schema.
 *
 * Raise them as batches land. They are a MINIMUM, never a target — the column
 * figure sits a little under the measured 868 so that dropping one column is a
 * deliberate edit here rather than a silent pass, while adding one needs no edit
 * at all.
 */
const MINIMUM_TABLES = 61;
const MINIMUM_COLUMNS = 860;

/**
 * Every table the barrel exports, so a new one is covered without an edit here.
 *
 * Widened to `unknown[]` before filtering rather than narrowing the barrel's own
 * union directly: a `value is PgTable` predicate over that union does not
 * type-check the moment the barrel exports anything that is not a table, and it
 * fails with a wall of structural mismatch that says nothing about the actual
 * mistake. The barrel is documented as tables-only; this keeps the failure
 * legible if that is ever violated.
 */
function declaredTables(): PgTable[] {
  const exported: unknown[] = Object.values(schema);
  return exported.filter(
    (value): value is PgTable =>
      typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
  );
}

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('schema invariants', () => {
  it('breaks none of the shared conventions', async () => {
    // One assertion covering snake_case tables and columns, a primary key on
    // every table, `timestamptz` everywhere, no `''` default where NULL means
    // absent, and no `_id` / `__v` artifact — plus the vacuity floors that stop
    // a broken catalogue query passing over nothing.
    const violations = await findSchemaInvariantViolations(db, {
      minimumTables: MINIMUM_TABLES,
      minimumColumns: MINIMUM_COLUMNS,
    });
    expect(violations).toEqual([]);
  });

  it('installs every extension the schema names', async () => {
    // Not a duplicate of `ensureExtensions` succeeding: that ran against the
    // database the migrator connected to. This asserts they are present in the
    // database the SUITE is querying, which is the property that actually
    // matters for a throwaway database created from `template1`.
    const rows = await db.execute<{ extname: string }>(sql`
      select extname from pg_extension order by extname
    `);
    const installed = new Set(rows.map((row) => row.extname));
    const missing = REQUIRED_EXTENSIONS
      .map((extension) => extension.name)
      .filter((name) => !installed.has(name));
    expect(missing).toEqual([]);
    // Vacuity floor: an empty `pg_extension` read would make the filter above
    // pass by comparing against nothing.
    expect(REQUIRED_EXTENSIONS.length).toBeGreaterThanOrEqual(3);
  });

  it('gives every extension a reason', () => {
    // The registry is data precisely so a reader can enumerate it. An entry with
    // no reason is a dependency nobody has justified.
    const unexplained = REQUIRED_EXTENSIONS
      .filter((extension) => extension.reason.trim().length < 40)
      .map((extension) => extension.name);
    expect(unexplained).toEqual([]);
  });

  it('exports every migrated table from the barrel', async () => {
    // The gates in this directory all iterate `declaredTables()`. A table that
    // the migration created but the barrel does not export is a table NO gate
    // checks — it would be absent from the id-column classification, the
    // protected-column scan and every invariant above, and each of them would
    // keep reporting "no offenders".
    // Extension-owned tables are excluded BY DEPENDENCY, not by name: PostGIS
    // creates `spatial_ref_sys` in `public`, and a hardcoded exclusion list
    // would silently need editing every time an extension is added — which is
    // the moment nobody is looking at this file.
    const rows = await db.execute<{ table_name: string }>(sql`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and not exists (
          select 1 from pg_depend d
          where d.objid = c.oid and d.classid = 'pg_class'::regclass and d.deptype = 'e'
        )
      order by 1
    `);
    const migrated = rows.map((row) => row.table_name);
    const declared = declaredTables().map(getTableName).sort();

    expect(migrated.length).toBeGreaterThanOrEqual(MINIMUM_TABLES);
    expect(declared).toEqual(migrated);
  });

  it('has recorded the migrations the harness applied', async () => {
    // The harness applies migrations through the real migrator. If it reported
    // success while leaving work pending, every other suite here would be
    // querying a half-built database and failing for the wrong reason.
    const rows = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from drizzle.__drizzle_migrations`,
    );
    expect(Number(rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });
});
