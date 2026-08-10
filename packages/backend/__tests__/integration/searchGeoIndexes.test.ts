/**
 * The spatial predicates the search runs are INDEX-BACKED — checked against a
 * real planner, not assumed from the schema.
 *
 * #354 asks for the PostGIS indexes for bbox and radius to be verified. The
 * schema declaring `index('addresses_geo_gist').using('gist', table.geo)` is
 * not that verification: a `geography` cast dropped from a predicate, a
 * `ST_Distance(...) < r` written into a WHERE clause, or a functional index on
 * a column the query no longer reads all leave that line untouched and turn
 * every geo search into a sequential scan over every address on the planet.
 * Only a plan can tell you.
 *
 * ## Why `enable_seqscan = off`, and why that is not cheating
 *
 * The test tables hold a handful of rows, so the planner correctly prefers a
 * sequential scan — on eight rows an index is slower, and a test asserting
 * "the plan uses the index" against a small table would be asserting something
 * false about a healthy database. Turning the sequential scan off asks the
 * question that actually matters and that scale does not change: **CAN this
 * predicate use the index at all?** A predicate that cannot is invisible until
 * production, where the table is large enough for the answer to hurt.
 *
 * Both halves are needed, and each catches what the other cannot: the
 * catalogue check sees an index that was never created, the plan check sees an
 * index that exists and cannot be used.
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
    // an empty one the planner may shortcut entirely.
    for (const [index, street] of ['Carrer Gran', 'Carrer Petit', 'Passeig'].entries()) {
      await seedAddress({
        chain,
        street,
        longitude: 2.1686 + index / 1000,
        latitude: 41.3874 + index / 1000,
      });
    }
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

  it.each([
    ['a bounding box', withinBoundingBox(BARCELONA_BOX)],
    ['a centre and radius', withinCircle(BARCELONA_CIRCLE)],
  ])('and CHOOSES it unprompted for %s', async (_label, predicate) => {
    // Measured rather than assumed, and it surprised the author: on a table of
    // three rows the planner still prefers the GiST index (cost 20.65 against a
    // sequential scan), so the `enable_seqscan = off` above is a robustness
    // belt rather than the only way to see the index at all. Asserting the
    // DEFAULT plan is the stronger statement — it is the plan production runs —
    // and keeping both means a change that makes the predicate merely
    // index-ABLE, rather than index-PREFERRED, still shows up as one failure
    // instead of none.
    const plan = await planFor(predicate, 'on');
    expect(plan).toContain(GEO_INDEX);
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
