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
 * ## Why `enable_seqscan = off` is the ONLY plan assertion here
 *
 * An earlier version of this file also asserted the DEFAULT plan — that the
 * planner reaches for the index unprompted — on the strength of a measurement
 * on three rows. That assertion was **flaky and blocked a sibling PR**: CI ran
 * it against a worker database holding ONE row, where `Seq Scan` is the correct
 * plan and the test went red on code nobody had touched.
 *
 * The measurement had been real. Generalising it was the mistake: **the default
 * plan is a property of the table's statistics, not of the predicate**, so a
 * test asserting it is testing the environment. Re-measured properly
 * (`postgis/postgis:17-3.5`, 2026-08-10), across row count, `ANALYZE` state and
 * fixture spread — `default` is the plan with `enable_seqscan` left alone,
 * `forced` is with it off:
 *
 * ```
 *  rows  ANALYZE  spread   bbox default  radius default   both forced
 *     1    no      —          INDEX          INDEX            INDEX
 *     1    yes     —          SEQ            SEQ              INDEX
 *     3    no      —          SEQ            SEQ              INDEX
 *     3    yes     tight      INDEX          SEQ              INDEX
 *    10 … 20000    tight      INDEX          SEQ              INDEX
 *   200 … 20000    wide       INDEX          INDEX            INDEX
 * ```
 *
 * Three separate things move the default plan and none of them is this
 * codebase: the row count, whether statistics have been gathered, and the
 * fixture's SELECTIVITY. That last one is worth spelling out because it looked
 * like a PostGIS finding and was not: in the `tight` rows every seeded point
 * sits INSIDE the 25 km circle, so `ST_DWithin` matches everything and a
 * sequential scan is genuinely the right plan. Scatter the same 20,000 rows
 * across Europe (`wide`, 0 of them in the circle) and the default plan uses the
 * index for both predicates. "Radius never uses the index" would have been a
 * false statement about PostGIS derived from a badly-shaped fixture.
 *
 * Forcing the sequential scan off asks the question that survives all three:
 * **CAN this predicate reach the index at all?** That is a property of the SQL
 * this repo emits — `INDEX` in 20 of 20 measured combinations — and rewriting
 * `withinCircle` as `ST_Distance(geo, p) < r`, the mistake `propertyGeo.ts`'s
 * own header warns about, turns it RED (mutation-tested).
 *
 * ## One mutation it does NOT catch, measured rather than assumed
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
 * rows come back, not which plan produced them. Worth writing down because the
 * obvious mutation for THIS file is the one that proves nothing.
 *
 * ## What this file therefore does NOT cover, stated so nobody assumes it does
 *
 * That the planner PREFERS the index at production scale. It cannot be asserted
 * here without pinning cost constants and seeding a realistic distribution on
 * every run, and its failures would read as "the environment changed" rather
 * than "the code broke". If that guarantee is wanted it belongs in an EXPLAIN
 * check against production-shaped data, not in this suite.
 *
 * The three checks that remain each catch what the others cannot: the catalogue
 * check sees an index that was never created, the forced-plan checks see an
 * index that exists and cannot be reached, and the negative control sees an
 * assertion that has stopped discriminating.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { addresses } from '../../db/schema';
import { withinBoundingBox, withinCircle } from '../../db/properties/propertyGeo';
import { resetGeoTables, seedAddress, seedGeoChain } from '../helpers/postgresGeoFixtures';

const GEO_INDEX = 'addresses_geo_gist';

const BARCELONA_BOX = { swLat: 41.32, swLng: 2.05, neLat: 41.47, neLng: 2.23 };
const BARCELONA_CIRCLE = { longitude: 2.1686, latitude: 41.3874, radiusMeters: 25_000 };

/**
 * The plan for a statement, as one string.
 *
 * Read inside a transaction with `SET LOCAL`, because the pool hands out a
 * different connection per statement — a session-level `SET` would land on one
 * connection and the `EXPLAIN` on another, and the setting would silently have
 * no effect. That failure reads as "the planner ignored us", which is exactly
 * the answer this test is trying to distinguish.
 */
async function planFor(predicate: ReturnType<typeof withinCircle>, seqScan: 'on' | 'off'): Promise<string> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql.raw(`set local enable_seqscan = ${seqScan}`));
    const rows = await tx.execute(
      sql`explain select count(*) from ${addresses} where ${predicate}`,
    );
    return [...rows].map((row) => String(Object.values(row)[0])).join('\n');
  });
}

describe('the geo predicates the search actually ships', () => {
  beforeAll(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({
      cityName: 'Barcelona',
      regionName: 'Catalonia',
      countryCode: 'ES-IDX',
    });
    // A handful of rows, so the plan is about a table that exists rather than
    // an empty one the planner may shortcut entirely. The COUNT does not matter
    // to what is asserted below — that was the flaw in the version this
    // replaces — but the table not being empty does.
    for (const [index, street] of ['Carrer Gran', 'Carrer Petit', 'Passeig'].entries()) {
      await seedAddress({
        chain,
        street,
        longitude: 2.1686 + index / 1000,
        latitude: 41.3874 + index / 1000,
      });
    }
    // Pin the statistics rather than racing autovacuum. Nothing below depends
    // on them, and that is the point: gathering them makes the starting state
    // the same on every run, so a future failure here means the SQL changed.
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
  ])('lets the planner reach that index for %s', async (_label, predicate) => {
    const plan = await planFor(predicate, 'off');

    // Vacuity floor: an empty or unrelated plan would make the assertion below
    // pass or fail for reasons that have nothing to do with the index.
    expect(plan).toContain('addresses');
    expect(plan).toContain(GEO_INDEX);
    expect(plan).toContain('Index Scan');
  });

  it('does NOT name the geo index for a predicate that cannot use it', async () => {
    // The negative control. Without it, "the plan mentions `addresses_geo_gist`"
    // could be true of every plan on this table for a reason unrelated to the
    // predicate — and every assertion above would pass while measuring nothing.
    const plan = await planFor(sql`${addresses.street} = 'Carrer Gran'`, 'off');

    expect(plan).toContain('addresses');
    expect(plan).not.toContain(GEO_INDEX);
  });
});
