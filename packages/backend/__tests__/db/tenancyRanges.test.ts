/**
 * The three `tstzrange` GiST indexes migration 0004 adds — and the fact that
 * ONE of them uses different bounds from the other two.
 *
 * `property_availability_windows` already established that a GiST range index is
 * the only thing that answers an overlap query at all (two independent btrees
 * cannot), and `propertyCalendar.test.ts` asserts that on the PLAN. This file
 * asserts the thing that is specific to migration 0004 and that no declaration
 * makes visible: **`leases_term_range_gist` uses CLOSED bounds (`'[]'`) while
 * `reservations_stay_range_gist` and `exchange_requests_requested_window_gist`
 * use half-open (`'[)'`)**.
 *
 * That is not a style difference, it is the source:
 *
 *  - `Lease.findActive` reads `startDate: { $lte: now }, endDate: { $gte: now }`,
 *    so a lease is active THROUGH its end instant. Half-open bounds would end
 *    every tenancy a moment early.
 *  - `AvailabilityWindow` in shared-types specifies `[start, end)` so adjacent
 *    windows do not collide, and `ExchangeRequestSchema` calls its window
 *    "half-open [start, end)" in as many words. Closed bounds would make every
 *    back-to-back booking a conflict.
 *
 * A test that only asked "does an overlap query return the row?" passes with
 * either spelling on both tables. The boundary instant is the ONLY input where
 * they disagree, so every assertion below sits exactly on it.
 */

import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { exchangeRequests, leases, properties, reservations } from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

const oxy = (): string => `oxy-${uuidv7()}`;

const START = new Date(Date.UTC(2026, 2, 1));
const END = new Date(Date.UTC(2026, 8, 1));
/** The instant the two bound conventions disagree about, and the only one. */
const BOUNDARY = END;

let db: Database;
let scaffold: PropertyScaffold;
let propertyId: string;
let leaseId: string;
let reservationId: string;
let exchangeId: string;

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'ranges');
  propertyId = await insertProperty(db, scaffold);

  const [lease] = await db
    .insert(leases)
    .values({
      propertyId,
      landlordOxyUserId: oxy(),
      tenantOxyUserId: oxy(),
      leaseTermsStartDate: START,
      leaseTermsEndDate: END,
      rentDetailsMonthlyRent: 1100,
      status: 'active',
    })
    .returning({ id: leases.id });
  leaseId = lease.id;

  const [reservation] = await db
    .insert(reservations)
    .values({
      propertyId,
      guestOxyUserId: oxy(),
      hostOxyUserId: oxy(),
      checkIn: START,
      checkOut: END,
      guestCount: 2,
      nights: 184,
      nightlyRate: 90,
      subtotal: 16_560,
      total: 16_560,
      cancellationPolicy: 'moderate',
    })
    .returning({ id: reservations.id });
  reservationId = reservation.id;

  const [exchange] = await db
    .insert(exchangeRequests)
    .values({
      propertyId,
      requesterOxyUserId: oxy(),
      hostOxyUserId: oxy(),
      mode: 'host',
      requestedWindowStart: START,
      requestedWindowEnd: END,
    })
    .returning({ id: exchangeRequests.id });
  exchangeId = exchange.id;
});

afterAll(async () => {
  await db.delete(exchangeRequests).where(eq(exchangeRequests.id, exchangeId));
  await db.delete(reservations).where(eq(reservations.id, reservationId));
  await db.delete(leases).where(eq(leases.id, leaseId));
  await db.delete(properties).where(eq(properties.id, propertyId));
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

/**
 * The range expression an index was ACTUALLY built with, read out of the
 * catalogue.
 *
 * This indirection is the whole point of the file and it was added after a
 * mutation test embarrassed the first version: writing
 * `tstzrange(lease_terms_start_date, lease_terms_end_date, '[]')` into the query
 * by hand measures the STRING IN THIS FILE, not the index — so removing `'[]'`
 * from the migration left every behavioural assertion green. Extracting the
 * expression from `pg_get_indexdef` makes the index the thing under test, which
 * is what the assertions claim to be about.
 */
async function rangeExpressionOf(indexName: string): Promise<string> {
  const rows = await db.execute<{ definition: string }>(sql`
    select pg_get_indexdef(x.indexrelid) as definition
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    where i.relname = ${indexName}
  `);
  const definition = rows[0]?.definition ?? '';
  const opening = definition.indexOf('USING gist (');
  const closing = definition.lastIndexOf(')');
  const expression = definition.slice(opening + 'USING gist ('.length, closing);
  // Vacuity floor: a failed extraction returns `''`, and `where '' @> …` is a
  // syntax error rather than a silent pass — but an extraction that returned a
  // COLUMN name would run fine and answer nothing, so the shape is asserted.
  expect(expression.startsWith('tstzrange(')).toBe(true);
  return expression;
}

/** Rows whose INDEXED range contains `instant`, by table. */
async function containing(table: string, indexName: string, instant: Date): Promise<number> {
  const expression = await rangeExpressionOf(indexName);
  const rows = await db.execute<{ hits: string }>(sql`
    select count(*)::text as hits from ${sql.raw(table)}
    where ${sql.raw(expression)} @> ${instant.toISOString()}::timestamptz
  `);
  return Number(rows[0].hits);
}

describe('the bound conventions differ, and the boundary instant proves it', () => {
  it('keeps a lease ACTIVE at its end instant', async () => {
    // `findActive` uses `$gte`, so the last day of a tenancy is still a tenancy.
    // With `'[)'` this reads 0 and every lease would silently end early.
    expect(await containing('leases', 'leases_term_range_gist', BOUNDARY)).toBe(1);
  });

  it('frees a reservation at its checkout instant', async () => {
    // The opposite answer on the SAME instant. A stay that ends on the morning
    // another begins is not a double booking — with `'[]'` this reads 1 and
    // every back-to-back booking would be refused.
    expect(await containing('reservations', 'reservations_stay_range_gist', BOUNDARY)).toBe(0);
  });

  it('frees an exchange window at its end instant', async () => {
    expect(
      await containing('exchange_requests', 'exchange_requests_requested_window_gist', BOUNDARY),
    ).toBe(0);
  });

  it('agrees with all three inside the range, so the cases above are about bounds only', async () => {
    // The vacuity guard. Without it, "reservations reads 0" would also pass if
    // the row were missing, the column names were wrong, or the range were empty
    // — none of which is what the assertion claims to measure.
    const inside = new Date(Date.UTC(2026, 5, 1));
    expect(await containing('leases', 'leases_term_range_gist', inside)).toBe(1);
    expect(await containing('reservations', 'reservations_stay_range_gist', inside)).toBe(1);
    expect(
      await containing('exchange_requests', 'exchange_requests_requested_window_gist', inside),
    ).toBe(1);
  });
});

describe('the indexes exist, and they are GiST over a range', () => {
  it('names all three, with the bound flag visible in the expression', async () => {
    // Reads the CATALOGUE, so it reports what the migration actually created
    // rather than what the schema file declares. The `'[]'` literal appearing in
    // exactly one of the three is the durable record of the decision — a later
    // "consistency" edit that harmonised them would fail here AND in the
    // behavioural cases above, which is the point of having both.
    const rows = await db.execute<{ indexname: string; expression: string }>(sql`
      select i.relname as indexname, pg_get_indexdef(x.indexrelid) as expression
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_am am on am.oid = i.relam
      where t.relname in ('leases', 'reservations', 'exchange_requests')
        and am.amname = 'gist'
      order by 1
    `);
    const byName = new Map(rows.map((row) => [row.indexname, row.expression]));

    expect([...byName.keys()]).toEqual([
      'exchange_requests_requested_window_gist',
      'leases_term_range_gist',
      'reservations_stay_range_gist',
    ]);
    expect(byName.get('leases_term_range_gist')).toContain(`'[]'`);
    expect(byName.get('reservations_stay_range_gist')).not.toContain(`'[]'`);
    expect(byName.get('exchange_requests_requested_window_gist')).not.toContain(`'[]'`);
  });

  it('builds them on an IMMUTABLE expression, which an index requires', async () => {
    // `tstzrange` in both its two- and three-argument forms. Checked against
    // `pg_proc.provolatile` rather than assumed, the same way
    // `propertyCalendar.test.ts` checks the two-argument form: a STABLE function
    // is refused outright by `CREATE INDEX`, so this documents WHY the migration
    // applies rather than merely that it did.
    const rows = await db.execute<{ nargs: number; provolatile: string }>(sql`
      select pronargs as nargs, provolatile
      from pg_proc
      where proname = 'tstzrange' and pronargs in (2, 3)
      order by pronargs
    `);
    expect(rows.map((row) => row.provolatile)).toEqual(['i', 'i']);
  });
});
