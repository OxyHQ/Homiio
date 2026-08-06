/**
 * The unmapped-column registry.
 *
 * `UNMAPPED_COLUMNS` is the claim "the copy will never write this column, and
 * that is correct". A claim naming a column that does not exist protects
 * nothing AND reports nothing — the same silent-no-op shape
 * `protectedColumns.test.ts` guards against — so the whole job of this file is
 * to make an entry answerable.
 *
 * It also pins the two facts that make the entries safe, against the real
 * migrated database rather than against the TypeScript: `views` really does
 * default to 0 and `title` really is nullable. If either drifted — a
 * `NOT NULL title`, say — the backfill would have to invent a value for a
 * column that has no source, which is the over-population failure the
 * column-coverage check exists to catch.
 */

import { getTableColumns, getTableName, sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { UNMAPPED_COLUMNS } from '../../db/schema/unmappedColumns';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('unmapped column registry', () => {
  it('names a real property on its table, for every entry', () => {
    const missing = UNMAPPED_COLUMNS
      .filter((entry) => !(entry.property in getTableColumns(entry.table)))
      .map((entry) => `${getTableName(entry.table)}.${entry.property}`);
    expect(missing).toEqual([]);
  });

  it('gives every entry a reason', () => {
    const unexplained = UNMAPPED_COLUMNS
      .filter((entry) => entry.reason.trim().length < 40)
      .map((entry) => `${getTableName(entry.table)}.${entry.property}`);
    expect(unexplained).toEqual([]);
  });

  it('holds the two columns the census proved have no source', () => {
    // A floor, not a target. Written as an exact set rather than a count so
    // that REMOVING an entry is as visible as adding one — a column quietly
    // dropped from this list is a column the coverage check will start
    // reporting as under-populated, and the reason will be gone.
    const named = UNMAPPED_COLUMNS
      .map((entry) => `${getTableName(entry.table)}.${entry.property}`)
      .sort();
    expect(named).toEqual(['properties.title', 'properties.views']);
  });
});

describe('the declared shape of an unmapped column', () => {
  it('starts `views` at zero rather than NULL', async () => {
    // `NOT NULL DEFAULT 0` is what makes "nothing to copy" an honest answer:
    // the backfill supplies nothing and every listing reads 0, which is the
    // truth. Nullable would make "never viewed" and "we do not know"
    // indistinguishable.
    const rows = await db.execute<{ is_nullable: string; column_default: string | null }>(sql`
      select is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'properties' and column_name = 'views'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].column_default).toContain('0');
  });

  it('leaves `title` nullable rather than defaulting it', async () => {
    // The opposite call from `views`, for a reason: "no headline" is a real
    // state a listing can be in, so an empty-string default would be a value
    // where absence is the fact. (`schemaInvariants` independently rejects a
    // `''` default anywhere in the schema.)
    const rows = await db.execute<{ is_nullable: string; column_default: string | null }>(sql`
      select is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public' and table_name = 'properties' and column_name = 'title'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('YES');
    expect(rows[0].column_default).toBeNull();
  });
});
