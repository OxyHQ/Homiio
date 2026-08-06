/**
 * `property_availability_windows` — the GiST range index, asserted on BOTH the
 * answer it gives and the plan it gives it with.
 *
 * Mongo indexed `availabilityWindows.start` and `availabilityWindows.end`
 * separately, and two independent btrees cannot answer an overlap query: the
 * planner narrows on one of them and filters the rest by hand. Those two
 * indexes are deliberately NOT ported, which means this index is not an
 * optimization of the old behaviour — it is the only thing that provides the
 * behaviour at all. A test asserting merely that a row came back would pass
 * against a sequential scan, i.e. against the index not existing.
 *
 * The second half of the file is the half-open (`[)`) contract. Adjacent
 * windows — one ending exactly where the next begins — MUST NOT overlap, or
 * every back-to-back booking collides. `tstzrange(a, b)` defaults to `[)`, so
 * the contract is the default; asserting it is what stops someone "clarifying"
 * the expression into `'[]'` later.
 */

import { eq, sql, type SQL } from 'drizzle-orm';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { properties, propertyAvailabilityWindows } from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

/** Anchor dates. Fixed rather than relative to `now()` so a failure is legible. */
const JUNE = (day: number): Date => new Date(Date.UTC(2026, 5, day));

/**
 * A `timestamptz` literal for hand-written SQL.
 *
 * Interpolating a JS `Date` straight into a `sql` template is the WRITE-side
 * face of the hazard CONVENTIONS.md records on the read side: `db.execute`
 * bypasses drizzle's column mappers, so nothing converts the value and
 * postgres.js rejects it outright (`The "string" argument must be of type
 * string … Received an instance of Date`). An ISO string plus an explicit cast
 * is the conversion drizzle would otherwise have done, written where a reader
 * can see it.
 */
const at = (date: Date): SQL => sql`${date.toISOString()}::timestamptz`;

/**
 * Windows the planner has a reason to use an index for.
 *
 * On a three-row table Postgres picks a sequential scan whatever indexes exist,
 * and `enable_seqscan = off` only makes it expensive rather than impossible —
 * so a plan assertion over a tiny table can pass or fail on cost noise. Filling
 * the table gives the assertion something real to measure.
 */
const FILLER_WINDOWS = 400;

let db: Database;
let scaffold: PropertyScaffold;
let propertyId: string;

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'calendar');
  propertyId = await insertProperty(db, scaffold);
});

afterEach(async () => {
  await db
    .delete(propertyAvailabilityWindows)
    .where(eq(propertyAvailabilityWindows.propertyId, propertyId));
});

afterAll(async () => {
  await db.delete(properties).where(eq(properties.id, propertyId));
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

describe('one table, two calendars', () => {
  it('holds a listing window and an exchange window side by side', async () => {
    // Mongo declared the identical `availabilityWindowSchema` TWICE — on
    // `Property.availabilityWindows` and inside
    // `Property.exchange.availabilityWindows` — so an overlap question had to
    // be asked against two arrays. One table with a `scope` discriminator makes
    // it one query, which is the whole reason the GiST index below can serve
    // both.
    await db.insert(propertyAvailabilityWindows).values([
      { propertyId, scope: 'listing', startsAt: JUNE(1), endsAt: JUNE(10) },
      { propertyId, scope: 'exchange', startsAt: JUNE(20), endsAt: JUNE(25) },
    ]);

    const rows = await db
      .select({ scope: propertyAvailabilityWindows.scope })
      .from(propertyAvailabilityWindows)
      .where(eq(propertyAvailabilityWindows.propertyId, propertyId));
    expect(rows.map((row) => row.scope).sort()).toEqual(['exchange', 'listing']);
  });

  it('refuses a scope outside the two', async () => {
    let caught: unknown;
    try {
      // Raw SQL, because the whole point is a value the TypeScript enum on
      // `scope` will not let the query builder produce — which is exactly the
      // shape a portal value leaking through ingest would have.
      await db.execute(sql`
        insert into property_availability_windows (id, property_id, scope, starts_at, ends_at)
        values (${uuidv7()}, ${propertyId}, 'holiday', ${at(JUNE(1))}, ${at(JUNE(2))})
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_availability_windows_scope_check');
  });

  it('refuses a window that ends before it starts', async () => {
    // Mongo enforced this with a sub-schema validator on `end`
    // (`value > this.start`) which, like every other validator in this package,
    // did not run on an update.
    let caught: unknown;
    try {
      await db
        .insert(propertyAvailabilityWindows)
        .values({ propertyId, scope: 'listing', startsAt: JUNE(10), endsAt: JUNE(1) });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_availability_windows_order_check');
  });

  it('refuses a zero-length window', async () => {
    // `>` and `>=` differ on exactly this input and nothing else, so without
    // this case both spellings pass the file. An empty range is not a window.
    let caught: unknown;
    try {
      await db
        .insert(propertyAvailabilityWindows)
        .values({ propertyId, scope: 'listing', startsAt: JUNE(5), endsAt: JUNE(5) });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_availability_windows_order_check');
  });
});

describe('overlap', () => {
  /** Every window that overlaps `[from, to)`, by id. */
  async function overlapping(from: Date, to: Date): Promise<string[]> {
    const rows = await db.execute<{ id: string }>(sql`
      select id from property_availability_windows
      where property_id = ${propertyId}
        and tstzrange(starts_at, ends_at) && tstzrange(${at(from)}, ${at(to)})
      order by starts_at
    `);
    return rows.map((row) => row.id);
  }

  it('answers an overlap query with the right SET, not merely some rows', async () => {
    const [before, straddling, inside, after] = await db
      .insert(propertyAvailabilityWindows)
      .values([
        { propertyId, scope: 'listing', startsAt: JUNE(1), endsAt: JUNE(5) },
        { propertyId, scope: 'listing', startsAt: JUNE(8), endsAt: JUNE(12) },
        { propertyId, scope: 'listing', startsAt: JUNE(11), endsAt: JUNE(13) },
        { propertyId, scope: 'listing', startsAt: JUNE(20), endsAt: JUNE(25) },
      ])
      .returning({ id: propertyAvailabilityWindows.id });

    // A request for June 10 → June 15 overlaps the straddling window and the
    // fully-contained one, and neither of the two outside it. Asserting the
    // exact set is what distinguishes a working range predicate from one that
    // merely returns something: a `starts_at < to` filter alone would also
    // return `before`.
    expect(await overlapping(JUNE(10), JUNE(15))).toEqual([straddling.id, inside.id]);
    expect(await overlapping(JUNE(1), JUNE(2))).toEqual([before.id]);
    expect(await overlapping(JUNE(21), JUNE(22))).toEqual([after.id]);
    expect(await overlapping(JUNE(26), JUNE(30))).toEqual([]);
    // The whole month: every window, in start order. A predicate that lost the
    // upper bound would pass each narrow case above and fail this one.
    expect(await overlapping(JUNE(1), JUNE(30))).toEqual([
      before.id,
      straddling.id,
      inside.id,
      after.id,
    ]);
  });

  it('treats ADJACENT windows as non-overlapping — the half-open contract', async () => {
    // `[)` bounds. A window ending exactly when the next begins does NOT
    // overlap it, which is what makes back-to-back bookings possible.
    // `tstzrange(a, b)` defaults to `[)`, so this pins the default against
    // someone later "clarifying" the expression to `'[]'`.
    const [june] = await db
      .insert(propertyAvailabilityWindows)
      .values({ propertyId, scope: 'listing', startsAt: JUNE(1), endsAt: JUNE(10) })
      .returning({ id: propertyAvailabilityWindows.id });

    // Starts exactly where it ends: no overlap.
    expect(await overlapping(JUNE(10), JUNE(15))).toEqual([]);
    // One instant earlier: overlap.
    expect(await overlapping(new Date(JUNE(10).getTime() - 1), JUNE(15))).toEqual([june.id]);
  });

  it('is answered BY THE GiST INDEX, not by a sequential scan', async () => {
    // The assertion that makes this table's index worth having. Two separate
    // btrees on `starts_at` and `ends_at` — which is what Mongo had and what is
    // deliberately not ported — cannot serve `&&` at all, so a plan that never
    // names this index is a plan that is filtering the whole table by hand.
    const filler = Array.from({ length: FILLER_WINDOWS }, (_, offset) => ({
      propertyId,
      scope: 'listing' as const,
      startsAt: new Date(Date.UTC(2027, 0, 1) + offset * 86_400_000),
      endsAt: new Date(Date.UTC(2027, 0, 2) + offset * 86_400_000),
    }));
    await db.insert(propertyAvailabilityWindows).values(filler);
    await db.execute(sql`analyze property_availability_windows`);

    const plan = await db.transaction(async (tx) => {
      // `SET LOCAL` needs a transaction, and the point of disabling seqscan is
      // to ask "CAN this index serve the predicate", which is the property
      // under test — not "is it cheapest today", which depends on row counts
      // nobody controls.
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = await tx.execute<{ 'QUERY PLAN': string }>(sql`
        explain (costs off)
        select id from property_availability_windows
        where tstzrange(starts_at, ends_at) && tstzrange(${at(JUNE(10))}, ${at(JUNE(15))})
      `);
      return rows.map((row) => row['QUERY PLAN']).join('\n');
    });

    // Print the whole plan on failure rather than asking a matcher whether it
    // matched: a plan that does not contain the name says nothing about WHY.
    expect(plan).toContain('property_availability_windows_range_gist');
    expect(plan).not.toContain('Seq Scan');
  });
});

describe('the index expression is IMMUTABLE', () => {
  it('confirms tstzrange(timestamptz, timestamptz) really is immutable', async () => {
    // An expression index requires an IMMUTABLE function, and the migration
    // would have failed outright if this were not true — so this assertion is
    // not guarding the migration. It is guarding a FUTURE edit: the three-
    // argument `tstzrange(a, b, bounds)` is also immutable, but the temptation
    // when a window needs different bounds is to reach for a text cast or a
    // `timezone()` call, and both are STABLE. Checked against `pg_proc` rather
    // than assumed, the same way the PostGIS volatility claim was.
    const rows = await db.execute<{ provolatile: string }>(sql`
      select p.provolatile
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pg_catalog'
        and p.proname = 'tstzrange'
        and p.pronargs = 2
    `);
    expect(rows).toHaveLength(1);
    // 'i' = immutable, 's' = stable, 'v' = volatile.
    expect(rows[0].provolatile).toBe('i');
  });
});
