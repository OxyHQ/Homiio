/**
 * `escapeLikePattern`, asserted against a REAL Postgres.
 *
 * The whole point of this helper is a behaviour that only exists inside the
 * database: `%` and `_` are `LIKE` wildcards. A unit test that only compared
 * strings would assert the implementation back to itself and would pass just as
 * happily if the escape character were wrong for this dialect. Every case below
 * therefore runs a real `ILIKE` against real rows.
 */

import { ilike, sql } from 'drizzle-orm';

import { escapeLikePattern } from '../../db/likePattern';
import { getDb } from '../../db/postgres';
import { cities } from '../../db/schema';
import { resetGeoTables, seedGeoChain } from '../helpers/postgresGeoFixtures';

/** City names to match against, each carrying a different LIKE metacharacter. */
const CITY_NAMES = ['100% Villa', '1000 Villas', 'C_2 Town', 'CX2 Town', 'Back\\slash City', 'Backslash City'];

async function namesMatching(term: string, escape: boolean): Promise<string[]> {
  const pattern = `%${escape ? escapeLikePattern(term) : term}%`;
  const rows = await getDb()
    .select({ name: cities.name })
    .from(cities)
    .where(ilike(cities.name, pattern))
    .orderBy(cities.name);
  return rows.map((row) => row.name);
}

beforeEach(async () => {
  await resetGeoTables();
  // One country/region, six cities under it — `(region_id, name)` is unique, so
  // they must share a region for the names to be the only thing that differs.
  const chain = await seedGeoChain({ cityName: CITY_NAMES[0] });
  for (const name of CITY_NAMES.slice(1)) {
    await getDb().insert(cities).values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      name,
    });
  }
});


describe('escapeLikePattern', () => {
  it('makes a typed % match literally instead of as a wildcard', async () => {
    expect(await namesMatching('100%', true)).toEqual(['100% Villa']);
  });

  it('is what stops a typed % from matching everything — the unescaped control', async () => {
    // Without the escape, `%100%%` matches both the literal-percent city AND the
    // one that merely starts with 100. This is the quiet behaviour change the
    // helper exists to prevent, asserted rather than described.
    // Order is the database collation's business, so compare the SET.
    expect([...(await namesMatching('100%', false))].sort()).toEqual(['100% Villa', '1000 Villas']);
  });

  it('makes a typed _ match literally instead of as any single character', async () => {
    expect(await namesMatching('C_2', true)).toEqual(['C_2 Town']);
    // The database's collation decides the order here, so compare the SET —
    // sorting BOTH sides, because JS orders `_` after `X` and Postgres does not.
    expect([...(await namesMatching('C_2', false))].sort()).toEqual(['C_2 Town', 'CX2 Town'].sort());
  });

  it('escapes the escape character itself, so a typed backslash matches literally', async () => {
    expect(await namesMatching('Back\\slash', true)).toEqual(['Back\\slash City']);
  });

  it('leaves regex metacharacters alone — they are not LIKE metacharacters', async () => {
    // `escapeRegExp` escaped `.`, `*`, `+`, `?`, `^`, `$`, `(`, `)`, `|`, `[`,
    // `]`, `{`, `}`. None of them means anything to LIKE, so escaping them would
    // insert stray backslashes that stop matching real text.
    expect(escapeLikePattern('a.b*c+d?e^f$g(h)i|j[k]l{m}')).toBe('a.b*c+d?e^f$g(h)i|j[k]l{m}');
  });

  it('escapes each metacharacter exactly once, backslash included', () => {
    // Escaping `%` before `\` would double an already-escaped backslash; the
    // single character class is what makes the order irrelevant.
    expect(escapeLikePattern('\\%_')).toBe('\\\\\\%\\_');
  });

  it('matches nothing when the escaped term is genuinely absent', async () => {
    // A vacuity floor: every assertion above would also pass against a query
    // that matched nothing at all.
    expect(await namesMatching('no-such-city', true)).toEqual([]);
    const total = await getDb().select({ n: sql<number>`count(*)::int` }).from(cities);
    expect(total[0].n).toBe(CITY_NAMES.length);
  });
});
