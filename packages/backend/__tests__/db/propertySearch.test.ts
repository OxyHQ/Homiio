/**
 * `properties.search_vector` — the replacement for Mongo's
 * `{ title: 'text', description: 'text' }` index.
 *
 * Two properties are asserted here and they fail in completely different ways:
 *
 *  1. **It matches through `unaccent`.** Homiio's corpus is portal listings in
 *     German, Spanish, English, French, Dutch, Italian and Catalan — measured,
 *     with GERMAN in front (3,797 of the 7,723 rows carrying a detected
 *     language) and 9,921 rows with no detection at all. So the configuration
 *     is `homiio_simple` (`simple` with `word`/`hword`/`hword_part` rewired
 *     through `unaccent`) rather than a stemmer, and what it buys is that a
 *     search for `malaga` finds `Málaga` — the single most common miss in this
 *     data. That failure is SILENT: searches just stop matching.
 *  2. **It is genuinely GENERATED.** A hook is bypassable and a
 *     `GENERATED ALWAYS … STORED` column is not, so no write path — route,
 *     service, backfill or `psql` — can produce a row whose vector disagrees
 *     with its description. An attempt fails with SQLSTATE `428C9`.
 *
 * `title` is deliberately absent from the expression. It exists on ZERO of the
 * 17,644 production rows (it is not declared in `PropertySchema`, so mongoose
 * strict mode drops it from every write) while Mongo spends 43.51 MiB indexing
 * it — 89% of the collection's whole index footprint. Weighting a field with no
 * data would copy the phantom index into Postgres.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { GENERATED_ALWAYS, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { TEXT_SEARCH_CONFIGURATION } from '../../db/extensions';
import { properties } from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

/** A token unique to this run, so a sibling file's rows cannot satisfy a query. */
const MARKER = `zq${uuidv7().replace(/-/g, '').slice(0, 12)}`;

let db: Database;
let scaffold: PropertyScaffold;
const created: string[] = [];

async function insert(description: string | null): Promise<string> {
  const id = await insertProperty(db, scaffold, { description });
  created.push(id);
  return id;
}

/**
 * Ids whose `search_vector` matches `query`, restricted to this run's rows.
 *
 * A `select()` with a `sql` fragment rather than a bare `db.execute`, per
 * CONVENTIONS.md: `db.execute` bypasses drizzle's column mappers in BOTH
 * directions, and `inArray` on a real column is what turns `created` into a
 * correctly-typed array rather than a bare parameter Postgres reads as a
 * malformed array literal.
 *
 * The configuration is rendered as a LITERAL, not a bound parameter: the first
 * argument of `websearch_to_tsquery` is a `regconfig`, and a `text` parameter
 * does not implicitly cast to one. `TEXT_SEARCH_CONFIGURATION` is a module
 * constant that `db/extensions.ts` already validates against
 * `/^[a-z][a-z0-9_]*$/` before it ever reaches DDL, so there is no runtime
 * value here to escape.
 */
async function matching(query: string): Promise<string[]> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(
      and(
        inArray(properties.id, created),
        sql`${properties.searchVector} @@ websearch_to_tsquery(${sql.raw(`'${TEXT_SEARCH_CONFIGURATION}'`)}, ${query})`,
      ),
    )
    .orderBy(properties.id);
  return rows.map((row) => row.id);
}

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'search');
});

afterEach(async () => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) await db.delete(properties).where(eq(properties.id, id));
  }
});

afterAll(async () => {
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

describe('search_vector', () => {
  it('matches an ACCENTED word through an unaccented query', async () => {
    const accented = await insert(`Piso luminoso en Málaga ${MARKER}`);

    // The property the whole `homiio_simple` configuration exists for. Under
    // the built-in `simple` configuration this returns nothing, and nothing is
    // exactly what a user typing `malaga` would see.
    expect(await matching(`malaga ${MARKER}`)).toEqual([accented]);
  });

  it('matches an UNACCENTED word from an accented query, the other direction', async () => {
    // Both sides of the comparison end at the same `simple` dictionary:
    // `Málaga` parses as `word` → unaccent → simple → `malaga`, while `malaga`
    // parses as `asciiword` → simple → `malaga`. Asserting only the first
    // direction would pass against a configuration that unaccented the DOCUMENT
    // but not the QUERY.
    const plain = await insert(`Bright flat in Malaga ${MARKER}`);

    expect(await matching(`Málaga ${MARKER}`)).toEqual([plain]);
  });

  it('does NOT match an unrelated word', async () => {
    // The negative control. Without it, a `search_vector` that matched
    // everything — say, a broken expression producing an empty tsquery — would
    // satisfy every assertion above.
    await insert(`Piso luminoso en Málaga ${MARKER}`);

    expect(await matching(`reykjavik ${MARKER}`)).toEqual([]);
  });

  it('is EMPTY, not null, for a listing with no description', async () => {
    // 740 of the 17,644 production rows have no `description`. `coalesce(…, '')`
    // in the expression is what keeps their vector an empty tsvector rather
    // than NULL — and a NULL `search_vector` is not merely unmatched, it makes
    // `@@` return NULL, which behaves like false in a WHERE and silently
    // excludes the row from every future NOT-match query too.
    const id = await insert(null);

    const rows = await db.execute<{ vector: string }>(
      sql`select search_vector::text as vector from properties where id = ${id}`,
    );
    expect(rows[0].vector).toBe('');
  });

  it('covers `description` and NOT `title`', async () => {
    // The decision the census forced. If someone later adds `title` to the
    // expression without regenerating the column or updating this file, this
    // goes red and names why.
    const titleOnly = await insert(null);
    await db.update(properties).set({ title: `Ático en Málaga ${MARKER}` })
      .where(eq(properties.id, titleOnly));

    expect(await matching(`malaga ${MARKER}`)).toEqual([]);
  });

  it('cannot be written directly', async () => {
    const id = await insert(`Piso en Málaga ${MARKER}`);

    let caught: unknown;
    try {
      await db.execute(sql`
        update properties
        set search_vector = to_tsvector('simple', 'anything at all')
        where id = ${id}
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(GENERATED_ALWAYS);
  });

  it('cannot be supplied on INSERT either', async () => {
    // A different statement and a different code path from the UPDATE above; a
    // backfill writes INSERTs, not UPDATEs, so this is the one that matters for
    // the copy.
    let caught: unknown;
    try {
      await db.execute(sql`
        insert into properties (id, address_id, search_vector)
        values (${uuidv7()}, ${scaffold.addressId}, to_tsvector('simple', 'anything'))
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(GENERATED_ALWAYS);
  });

  it('is backed by a GIN index', async () => {
    const rows = await db.execute<{ indexname: string }>(sql`
      select i.relname as indexname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_am am on am.oid = i.relam
      where t.relname = 'properties' and am.amname = 'gin'
      order by 1
    `);
    // Three GIN indexes on this table: the two arrays and the search vector.
    // Asserting the whole set rather than membership means dropping one of the
    // others also fails here, where the reason is written down.
    expect(rows.map((row) => row.indexname)).toEqual([
      'properties_amenities_gin',
      'properties_offerings_gin',
      'properties_search_vector_gin',
    ]);
  });
});
