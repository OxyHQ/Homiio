/**
 * The spatial predicates the search runs are INDEX-BACKED — checked against a
 * real planner, not assumed from the schema.
 *
 * #354 asks for the PostGIS indexes for bbox and radius to be verified. The
 * schema declaring `index('addresses_geo_gist').using('gist', table.geo)` is
 * not that verification: a `ST_Distance(...) < r` written into a WHERE clause,
 * or an index on a column the query no longer reads, leave that line untouched
 * and turn every geo search into a sequential scan over every address on the
 * planet. Only a plan can tell you.
 *
 * ## The flake this file already caused, and what actually fixed it
 *
 * An earlier version asserted the DEFAULT plan on a fixture of three addresses
 * ALL SITTING INSIDE the search area. That was flaky and blocked two sibling
 * PRs: it passed here and on `main`, and failed on other branches with three
 * different sequential-scan costs for the same three rows.
 *
 * The tempting diagnosis is row count, and it is wrong. Measured
 * (`postgis/postgis:17-3.5`, 2026-08-10) with the OLD tight fixture — every
 * point inside the 25 km circle — the radius predicate plans a sequential scan
 * at **every** size from 3 to 20,000 rows, analyzed or not. Nothing about
 * seeding more rows rescues it, because a sequential scan is the CORRECT plan
 * there: the predicate matches every row, so there is nothing for an index to
 * narrow. The variable is **SELECTIVITY**, and the fixture had none.
 *
 * With a selective fixture — a handful of matching rows among many that do not
 * — the default plan is an index scan in every condition measured:
 *
 * ```
 *   rows   ANALYZE   bbox default   radius default
 *     50     no          INDEX          INDEX
 *     50     yes         INDEX          INDEX
 *    200     no          INDEX          INDEX
 *    200     yes         INDEX          INDEX
 *   2000     no          INDEX          INDEX
 *   2000     yes         INDEX          INDEX
 *   20k analyzed, then deleted to ~200 with NO re-analyze
 *                        INDEX          INDEX
 * ```
 *
 * That last row is the deliberately-stale-statistics case — grow the table,
 * gather statistics, delete most of it, never re-analyze — because stale
 * `pg_class` numbers were the other proposed explanation. A selective fixture
 * survives it.
 *
 * **So the load-bearing thing in this file is the SHAPE of the seed, not its
 * size and not the `ANALYZE`.** The selectivity precondition below is therefore
 * a real assertion rather than a comment: change the seed back to something
 * uniform and it fails FIRST, naming the cause, instead of leaving the next
 * person to rediscover the plan flake from a red CI job on an unrelated branch.
 *
 * `ANALYZE` stays, and is honestly labelled: measured, it does NOT change any
 * verdict here (every `no` row above matches its `yes`). It is kept so the
 * starting state is pinned rather than depending on autovacuum timing, which
 * makes a future failure attributable to the SQL. Removing it does not turn
 * this file red, and nothing here should be read as claiming otherwise.
 *
 * ## One mutation that proves nothing, measured rather than assumed
 *
 * Deleting the explicit `::geography` from `withinBoundingBox`'s envelope leaves
 * every check here green — and that is CORRECT, not a hole. PostGIS defines an
 * implicit geometry→geography cast, so `ST_Intersects(geography, geometry)`
 * resolves to the geography overload and the semantics are unchanged: probed on
 * a real server, a Fijian point inside the antimeridian strip `170 → -170` is
 * `true` with the cast and `true` without it.
 *
 * The complement bug `propertyGeo.ts` warns about needs the COLUMN to become
 * planar — `geo::geometry` on both sides makes that same point `false`. It is a
 * SEMANTIC failure, so the guard for it is
 * `__tests__/integration/antimeridianBoundingBox.test.ts`, which asserts which
 * rows come back, not which plan produced them.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { addresses } from '../../db/schema';
import { withinBoundingBox, withinCircle } from '../../db/properties/propertyGeo';
import { resetGeoTables, seedGeoChain, type GeoChain } from '../helpers/postgresGeoFixtures';

const GEO_INDEX = 'addresses_geo_gist';

const BARCELONA_BOX = { swLat: 41.32, swLng: 2.05, neLat: 41.47, neLng: 2.23 };
const BARCELONA_CIRCLE = { longitude: 2.1686, latitude: 41.3874, radiusMeters: 25_000 };

/** Rows inside the search area. Few, on purpose — that is the selectivity. */
const MATCHING_ROWS = 3;
/** Rows scattered far outside it. The measured floor is 50; this is margin. */
const SCATTERED_ROWS = 197;
/** No more than this fraction of the table may match, or the plan is not determined. */
const MAX_SELECTIVITY = 0.1;

/**
 * The plan for a statement, as one string.
 *
 * Read inside a transaction with `SET LOCAL`, because the pool hands out a
 * different connection per statement — a session-level `SET` would land on one
 * connection and the `EXPLAIN` on another, and the setting would silently have
 * no effect. That failure reads as "the planner ignored us", which is exactly
 * the answer this test is trying to distinguish.
 */
async function planFor(
  predicate: ReturnType<typeof withinCircle>,
  seqScan: 'on' | 'off',
): Promise<string> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql.raw(`set local enable_seqscan = ${seqScan}`));
    const rows = await tx.execute(
      sql`explain select count(*) from ${addresses} where ${predicate}`,
    );
    return [...rows].map((row) => String(Object.values(row)[0])).join('\n');
  });
}

/** How many rows a predicate actually matches. */
async function matchCount(predicate: ReturnType<typeof withinCircle>): Promise<number> {
  const rows = await getDb().execute(
    sql`select count(*)::int as matched from ${addresses} where ${predicate}`,
  );
  return Number(Object.values([...rows][0])[0]);
}

/** A few addresses inside the Barcelona box and circle. */
async function seedMatching(chain: GeoChain): Promise<void> {
  await getDb().execute(sql`
    insert into addresses (id, street, postal_code, city_id, region_id, country_id, country_code, longitude, latitude)
    select substring(md5(random()::text || 'match' || g::text) from 1 for 24),
           'Carrer ' || g, '08001',
           ${chain.cityId}, ${chain.regionId}, ${chain.countryId}, 'ES',
           ${BARCELONA_CIRCLE.longitude} + g / 10000.0,
           ${BARCELONA_CIRCLE.latitude} + g / 10000.0
    from generate_series(1, ${MATCHING_ROWS}::int) as g
  `);
}

/**
 * Addresses scattered across Europe, none of them in the search area.
 *
 * One statement rather than a loop of `seedAddress` calls: 197 round trips
 * would dominate this file's runtime for no benefit, and the rows exist only to
 * give the predicate something to exclude.
 */
async function seedScattered(chain: GeoChain): Promise<void> {
  await getDb().execute(sql`
    insert into addresses (id, street, postal_code, city_id, region_id, country_id, country_code, longitude, latitude)
    select substring(md5(random()::text || 'far' || g::text) from 1 for 24),
           'Elsewhere ' || g, '00000',
           ${chain.cityId}, ${chain.regionId}, ${chain.countryId}, 'ES',
           -10.0 + (g % 97) * 0.45, 36.0 + (g % 91) * 0.24
    from generate_series(1, ${SCATTERED_ROWS}::int) as g
  `);
}

describe('the geo predicates the search actually ships', () => {
  beforeAll(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({
      cityName: 'Barcelona',
      regionName: 'Catalonia',
      countryCode: 'ES-IDX',
    });
    await seedMatching(chain);
    await seedScattered(chain);
    // Pinned rather than left to autovacuum. Measured NOT to change any verdict
    // below — see the header — so this is about making the starting state the
    // same on every run, not about making the assertions pass.
    await getDb().execute(sql`analyze addresses`);
  });

  it('has a GiST index on the generated geography column', async () => {
    const rows = await getDb().execute(
      sql`select indexdef from pg_indexes where tablename = 'addresses' and indexname = ${GEO_INDEX}`,
    );
    const definitions = [...rows].map((row) => String(Object.values(row)[0]));

    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toContain('USING gist');
    expect(definitions[0]).toContain('geo');
  });

  it.each([
    ['a bounding box', withinBoundingBox(BARCELONA_BOX)],
    ['a centre and radius', withinCircle(BARCELONA_CIRCLE)],
  ])('is asked a SELECTIVE question by %s, which is what determines the plan', async (_label, predicate) => {
    // The precondition every plan assertion below rests on, asserted rather
    // than assumed. A fixture where the predicate matches most of the table
    // makes a sequential scan correct, and the plan tests then fail for a
    // reason that has nothing to do with the SQL — which is exactly how this
    // file went flaky and blocked two other PRs.
    const total = await matchCount(sql`true`);
    const matched = await matchCount(predicate);

    expect(total).toBe(MATCHING_ROWS + SCATTERED_ROWS);
    expect(matched).toBe(MATCHING_ROWS);
    expect(matched / total).toBeLessThan(MAX_SELECTIVITY);
  });

  it.each([
    ['a bounding box', withinBoundingBox(BARCELONA_BOX)],
    ['a centre and radius', withinCircle(BARCELONA_CIRCLE)],
  ])('lets the planner reach that index for %s', async (_label, predicate) => {
    const plan = await planFor(predicate, 'off');

    // Vacuity floor: an empty or unrelated plan would make the assertion below
    // pass or fail for reasons that have nothing to do with the index.
    expect(plan).toContain('addresses');
    expect(plan).toContain(GEO_INDEX);
    expect(plan).toContain('Index Scan');
  });

  it.each([
    ['a bounding box', withinBoundingBox(BARCELONA_BOX)],
    ['a centre and radius', withinCircle(BARCELONA_CIRCLE)],
  ])('and CHOOSES it unprompted for %s', async (_label, predicate) => {
    // The stronger statement, and the one production actually runs: with a
    // selective question the planner reaches for the index on its own. It is
    // deterministic here because the fixture's shape is, which the selectivity
    // test above is what guarantees.
    const plan = await planFor(predicate, 'on');

    expect(plan).toContain('addresses');
    expect(plan).toContain(GEO_INDEX);
  });

  it('does NOT name the geo index for a predicate that cannot use it', async () => {
    // The negative control. Without it, "the plan mentions `addresses_geo_gist`"
    // could be true of every plan on this table for a reason unrelated to the
    // predicate — and every assertion above would pass while measuring nothing.
    const plan = await planFor(sql`${addresses.street} = 'Carrer 1'`, 'off');

    expect(plan).toContain('addresses');
    expect(plan).not.toContain(GEO_INDEX);
  });
});
