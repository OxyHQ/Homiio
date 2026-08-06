/**
 * The `homiio_simple` text-search configuration, asserted in a FRESHLY CREATED
 * database.
 *
 * That last part is the whole point, and it is why this file cannot be replaced
 * by reading `db/extensions.ts` and believing it. **A text-search configuration
 * is per-database and does NOT travel through `template1`.** Every throwaway
 * database this harness creates is a plain `create database …`, so it inherits
 * nothing — exactly like a new RDS database, and exactly like a database
 * restored from a plain dump. If `ensureExtensions` did not create the
 * configuration on every migrate, this suite would be the first thing to notice,
 * and it would notice here.
 *
 * The failure it guards is silent rather than loud. A missing configuration does
 * not break a query — `to_tsvector('homiio_simple', …)` errors, but a schema
 * that had quietly fallen back to `'simple'` or `'english'` would keep working
 * and merely stop matching accented names, on a corpus that is Spanish-first.
 */

import { sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { TEXT_SEARCH_CONFIGURATION } from '../../db/extensions';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe(`the ${TEXT_SEARCH_CONFIGURATION} text-search configuration`, () => {
  it('exists in this freshly created database', async () => {
    const rows = await db.execute<{ cfgname: string }>(sql`
      select c.cfgname
      from pg_ts_config c
      join pg_namespace n on n.oid = c.cfgnamespace
      where c.cfgname = ${TEXT_SEARCH_CONFIGURATION} and n.nspname = 'public'
    `);
    expect(rows.map((row) => row.cfgname)).toEqual([TEXT_SEARCH_CONFIGURATION]);
  });

  it('matches an unaccented query against an accented document', async () => {
    // The assertion that proves the `unaccent` wiring rather than merely the
    // configuration's existence. A `COPY = simple` configuration with the
    // mapping NOT rewired would answer false here while still passing the
    // existence check above.
    const rows = await db.execute<{ matched: boolean }>(sql`
      select to_tsvector(${TEXT_SEARCH_CONFIGURATION}, 'Piso en Málaga centro')
             @@ websearch_to_tsquery(${TEXT_SEARCH_CONFIGURATION}, 'malaga') as matched
    `);
    expect(rows[0].matched).toBe(true);
  });

  it('matches an accented query against an unaccented document', async () => {
    // The other direction, which is NOT symmetric by construction: an accented
    // query token parses as `word` (rewired through unaccent) while the
    // unaccented document token parses as `asciiword` (not rewired). They meet
    // only because both end at the same `simple` dictionary — a fact worth
    // pinning rather than assuming.
    const rows = await db.execute<{ matched: boolean }>(sql`
      select to_tsvector(${TEXT_SEARCH_CONFIGURATION}, 'Piso en Malaga centro')
             @@ websearch_to_tsquery(${TEXT_SEARCH_CONFIGURATION}, 'Málaga') as matched
    `);
    expect(rows[0].matched).toBe(true);
  });

  it('reduces an accented token to its unaccented lexeme', async () => {
    // Names the actual stored lexeme, so a failure says what went wrong rather
    // than just "false". `simple` lowercases; `unaccent` strips the diacritic.
    const rows = await db.execute<{ lexemes: string }>(sql`
      select to_tsvector(${TEXT_SEARCH_CONFIGURATION}, 'Málaga')::text as lexemes
    `);
    expect(rows[0].lexemes).toBe("'malaga':1");
  });

  it('does NOT stem, which is why it is not the english configuration', async () => {
    // Homiio's corpus is Spanish-first while Mongo applied ENGLISH stemming by
    // default, so a faithful port of Mongo's CONFIG would have carried a bug.
    // `english` reduces `viviendas` to `vivienda`; `simple` keeps the token
    // whole, which is the honest behaviour for a multi-language corpus.
    const rows = await db.execute<{ lexemes: string }>(sql`
      select to_tsvector(${TEXT_SEARCH_CONFIGURATION}, 'viviendas')::text as lexemes
    `);
    expect(rows[0].lexemes).toBe("'viviendas':1");
  });
});
