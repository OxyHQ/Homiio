/**
 * A viewing takes TIME — the schema half (#518 §7.5).
 *
 * Three things, against the real server:
 *
 *  1. **The measurement the whole design rests on.** Every other range in this
 *     schema gets a `tstzrange` GiST index. This one cannot, because
 *     `timestamptz + interval` is STABLE and an expression index requires
 *     IMMUTABLE. That is asserted out of `pg_proc` rather than asserted in a
 *     comment, because the comment is what a later reader would "fix" by adding
 *     the index — and the failure would be a migration that will not apply.
 *  2. **The constraints that make the overlap query exhaustive.** The duration
 *     ceiling is not hygiene: `findOverlappingViewing` bounds its index scan
 *     with it, so widening the CHECK without widening the query silently stops
 *     the conflict check finding the appointments that start furthest back.
 *  3. **The window table's rules**, each asserted on what it REFUSES *and* on
 *     what it permits — a total unique index passes every "rejects a duplicate"
 *     assertion, and the rows it eats are the permits.
 */

import { and, eq, sql } from 'drizzle-orm';
import { CHECK_VIOLATION, UNIQUE_VIOLATION, constraintNameOf, sqlStateOf } from '@oxy.so/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { properties, propertyViewingWindows, viewingRequests } from '../../db/schema';
import { findOverlappingViewing } from '../../db/bookings/viewingReads';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

const OWNER = 'oxy-window-owner';
/** Fixed rather than relative to `now()`, so a failure is legible. */
const JUNE_2 = (hour: number, minute = 0): Date => new Date(Date.UTC(2026, 5, 2, hour, minute));

let db: Database;
let scaffold: PropertyScaffold;
let propertyId: string;

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'viewwin');
  propertyId = await insertProperty(db, scaffold, { oxyUserId: OWNER });
});

afterEach(async () => {
  await db.delete(viewingRequests).where(eq(viewingRequests.propertyId, propertyId));
  await db
    .delete(propertyViewingWindows)
    .where(eq(propertyViewingWindows.propertyId, propertyId));
});

afterAll(async () => {
  await db.delete(properties).where(eq(properties.id, propertyId));
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

/** Insert a pending viewing and return its id. */
async function seedViewing(
  scheduledAt: Date,
  durationMinutes = 30,
  modality: 'in_person' | 'video' = 'in_person',
): Promise<string> {
  const [row] = await db
    .insert(viewingRequests)
    .values({
      propertyId,
      requesterOxyUserId: `oxy-${scheduledAt.getTime()}-${modality}`,
      ownerOxyUserId: OWNER,
      scheduledAt,
      durationMinutes,
      modality,
      status: 'pending',
    })
    .returning({ id: viewingRequests.id });
  return row.id;
}

describe('why there is no GiST index on the viewing range', () => {
  it('measures that `timestamptz + interval` is STABLE, not IMMUTABLE', async () => {
    // Read out of the catalogue rather than restated. `make_interval` IS
    // immutable, so the blocker is specifically the addition — which is the
    // detail a reader trying to add the index needs, and the one a prose
    // comment would get wrong.
    const rows = await db.execute<{ name: string; volatility: string }>(sql`
      select p.proname as name, p.provolatile as volatility
      from pg_proc p
      where p.proname in ('timestamptz_pl_interval', 'make_interval')
      order by p.proname
    `);
    const byName = new Map(rows.map((row) => [row.name, row.volatility]));
    expect(byName.get('make_interval')).toBe('i');
    expect(byName.get('timestamptz_pl_interval')).toBe('s');
  });

  it('refuses the index outright, so the btree is not a preference', async () => {
    // The exact statement somebody would write, and the exact refusal. `42P17`
    // is `invalid_object_definition`.
    let caught: unknown;
    try {
      await db.execute(sql`
        create index viewing_requests_range_gist_probe on viewing_requests
        using gist (tstzrange(scheduled_at, scheduled_at + make_interval(mins => duration_minutes)))
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe('42P17');
  });
});

describe('findOverlappingViewing', () => {
  it('finds an appointment that STARTED earlier and is still running', async () => {
    // The case the old `scheduled_at = scheduled_at` rule could not see at all.
    await seedViewing(JUNE_2(10), 60);
    const conflict = await findOverlappingViewing(db, propertyId, JUNE_2(10, 30), 30);
    expect(conflict).toBeDefined();
  });

  it('finds an appointment that starts INSIDE the one being asked about', async () => {
    await seedViewing(JUNE_2(10, 15), 30);
    const conflict = await findOverlappingViewing(db, propertyId, JUNE_2(10), 60);
    expect(conflict).toBeDefined();
  });

  it('PERMITS a back-to-back appointment — the bounds are half-open', async () => {
    // Asserting the permit as well as the refusal: a check written with `>=`
    // would pass every conflict case above and quietly refuse every legitimate
    // consecutive viewing, which is the failure an owner notices and nobody
    // debugs.
    await seedViewing(JUNE_2(10), 30);
    expect(await findOverlappingViewing(db, propertyId, JUNE_2(10, 30), 30)).toBeUndefined();
    expect(await findOverlappingViewing(db, propertyId, JUNE_2(9, 30), 30)).toBeUndefined();
  });

  it('ignores declined and cancelled appointments', async () => {
    const id = await seedViewing(JUNE_2(10), 30);
    await db
      .update(viewingRequests)
      .set({ status: 'cancelled', cancelledBy: 'requester' })
      .where(eq(viewingRequests.id, id));
    expect(await findOverlappingViewing(db, propertyId, JUNE_2(10), 30)).toBeUndefined();
  });

  it('excludes the row being rescheduled, so it cannot conflict with itself', async () => {
    const id = await seedViewing(JUNE_2(10), 30);
    expect(
      await findOverlappingViewing(db, propertyId, JUNE_2(10), 30, { excludeId: id }),
    ).toBeUndefined();
  });

  it('is exhaustive at the far edge of its index bound', async () => {
    // A 240-minute appointment — the ceiling the CHECK allows — starting four
    // hours before the instant asked about, i.e. exactly the row the scan's
    // lower bound is sized for. If the bound and the CHECK ever disagree, this
    // is the case that goes red.
    await seedViewing(JUNE_2(6), 240);
    expect(await findOverlappingViewing(db, propertyId, JUNE_2(9, 59), 30)).toBeDefined();
    // And one minute later it genuinely has ended.
    expect(await findOverlappingViewing(db, propertyId, JUNE_2(10), 30)).toBeUndefined();
  });

  it('does not confuse one listing with another', async () => {
    const other = await insertProperty(db, scaffold, { oxyUserId: OWNER });
    await seedViewing(JUNE_2(10), 30);
    expect(await findOverlappingViewing(db, other, JUNE_2(10), 30)).toBeUndefined();
    await db.delete(properties).where(eq(properties.id, other));
  });
});

describe('the constraints on viewing_requests', () => {
  it('refuses a duration outside the bound the overlap query depends on', async () => {
    for (const duration of [0, 9, 241]) {
      let caught: unknown;
      try {
        await seedViewing(JUNE_2(12), duration);
      } catch (error) {
        caught = error;
      }
      expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
      expect(constraintNameOf(caught)).toBe('viewing_requests_duration_check');
    }
    // And the two ends of the range are accepted, so the CHECK is a bound
    // rather than a wall.
    await expect(seedViewing(JUNE_2(12), 10)).resolves.toBeDefined();
    await expect(seedViewing(JUNE_2(20), 240)).resolves.toBeDefined();
  });

  it('refuses an undeclared modality', async () => {
    let caught: unknown;
    try {
      await db.execute(sql`
        insert into viewing_requests
          (id, property_id, requester_oxy_user_id, owner_oxy_user_id, scheduled_at, modality)
        values ('vr-modality-probe', ${propertyId}, 'oxy-x', ${OWNER},
                ${JUNE_2(12).toISOString()}::timestamptz, 'in_the_metaverse')
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('viewing_requests_modality_check');
  });

  it('refuses an owner response on a request nobody has answered', async () => {
    const id = await seedViewing(JUNE_2(12), 30);
    let caught: unknown;
    try {
      await db
        .update(viewingRequests)
        .set({ ownerResponse: 'I can do Thursday instead' })
        .where(eq(viewingRequests.id, id));
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('viewing_requests_owner_response_status_check');
  });

  it('PERMITS a decision with words, and a decision without them', async () => {
    // The one-way half of the rule. `cancelled_by` is an EQUIVALENCE and this
    // deliberately is not: a decline with nothing said is an ordinary decline,
    // so a test that only proved the refusal above would pass against a
    // constraint that had been tightened into an equivalence and broken every
    // silent decline.
    const withWords = await seedViewing(JUNE_2(12), 30);
    await db
      .update(viewingRequests)
      .set({ status: 'declined', ownerResponse: 'Sorry, it went yesterday' })
      .where(eq(viewingRequests.id, withWords));

    const silent = await seedViewing(JUNE_2(14), 30);
    await db
      .update(viewingRequests)
      .set({ status: 'declined' })
      .where(eq(viewingRequests.id, silent));

    const rows = await db
      .select({ id: viewingRequests.id, ownerResponse: viewingRequests.ownerResponse })
      .from(viewingRequests)
      .where(eq(viewingRequests.propertyId, propertyId));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === withWords)?.ownerResponse).toBe(
      'Sorry, it went yesterday',
    );
    expect(rows.find((row) => row.id === silent)?.ownerResponse).toBeNull();
  });
});

describe('property_viewing_windows', () => {
  const window = {
    propertyId: '',
    weekday: 2,
    startMinute: 17 * 60,
    endMinute: 19 * 60,
    slotMinutes: 30,
    modality: 'in_person' as const,
  };

  it('refuses a weekday outside 0–6', async () => {
    let caught: unknown;
    try {
      await db.insert(propertyViewingWindows).values({ ...window, propertyId, weekday: 7 });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_viewing_windows_weekday_check');
  });

  it('refuses a window that ends before it begins', async () => {
    let caught: unknown;
    try {
      await db
        .insert(propertyViewingWindows)
        .values({ ...window, propertyId, startMinute: 19 * 60, endMinute: 17 * 60 });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    // A backwards window violates BOTH `_order_check` and `_holds_a_slot_check`
    // — a negative width cannot hold a slot either — and Postgres names
    // whichever it evaluated first, which is not a guarantee. Asserting the
    // pair says what is actually promised instead of pinning an evaluation
    // order that a future `ALTER TABLE` could reorder with no warning.
    expect([
      'property_viewing_windows_order_check',
      'property_viewing_windows_holds_a_slot_check',
    ]).toContain(constraintNameOf(caught));
  });

  it('refuses a window too short to hold one of its own appointments', async () => {
    // The silent one. Without this CHECK the row inserts, the generator emits
    // nothing, and the screen says the owner has published no times — which is
    // both plausible and false.
    let caught: unknown;
    try {
      await db.insert(propertyViewingWindows).values({
        ...window,
        propertyId,
        startMinute: 17 * 60,
        endMinute: 17 * 60 + 20,
        slotMinutes: 60,
      });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_viewing_windows_holds_a_slot_check');
  });

  it('PERMITS a window exactly one slot long', async () => {
    // The boundary the CHECK above is written `>=` for. A `>` would refuse "one
    // appointment on Tuesday evening", which is a perfectly ordinary thing to
    // publish.
    await expect(
      db.insert(propertyViewingWindows).values({
        ...window,
        propertyId,
        startMinute: 17 * 60,
        endMinute: 17 * 60 + 30,
        slotMinutes: 30,
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a duplicate window', async () => {
    await db.insert(propertyViewingWindows).values({ ...window, propertyId });
    let caught: unknown;
    try {
      await db.insert(propertyViewingWindows).values({ ...window, propertyId });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);
    expect(constraintNameOf(caught)).toBe('property_viewing_windows_slot_key');
  });

  it('PERMITS two overlapping windows of different modality', async () => {
    // The permit the unique index exists to leave open. An owner who can show
    // the flat in person 17:00–20:00 and take video calls 18:00–19:00 on the
    // same evening means both, and this table has no standing to decide
    // otherwise.
    await db.insert(propertyViewingWindows).values([
      { ...window, propertyId, modality: 'in_person' },
      { ...window, propertyId, startMinute: 18 * 60, endMinute: 19 * 60, modality: 'video' },
    ]);
    const rows = await db
      .select({ id: propertyViewingWindows.id })
      .from(propertyViewingWindows)
      .where(eq(propertyViewingWindows.propertyId, propertyId));
    expect(rows).toHaveLength(2);
  });

  it('is deleted WITH its listing, and does not hold the listing hostage', async () => {
    // CASCADE, not RESTRICT. `properties` is hard-deleted by the expiry sweep,
    // and a RESTRICT here would abort sweep batches on a schedule — silently,
    // growing the table the sweep exists to reap.
    const doomed = await insertProperty(db, scaffold, { oxyUserId: OWNER });
    await db.insert(propertyViewingWindows).values({ ...window, propertyId: doomed });

    await db.delete(properties).where(eq(properties.id, doomed));

    const left = await db
      .select({ id: propertyViewingWindows.id })
      .from(propertyViewingWindows)
      .where(eq(propertyViewingWindows.propertyId, doomed));
    expect(left).toHaveLength(0);
  });

  it('carries NO expiry column, because a recurrence has no deadline', async () => {
    // `db/expiry.ts` says a table ported without a sweep grows forever with no
    // error and no failing test. The inverse is worth pinning too: this table
    // deliberately has no `expires_at`, so a later reader adding one — and a
    // sweep with it — would be putting a deadline on a weekly schedule and
    // quietly taking a home off the market on a date nobody chose.
    const columns = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_name = 'property_viewing_windows'
    `);
    expect(columns.map((row) => row.column_name)).not.toContain('expires_at');
  });

  it('refuses a window on a listing that does not exist', async () => {
    let caught: unknown;
    try {
      await db
        .insert(propertyViewingWindows)
        .values({ ...window, propertyId: 'no-such-listing' });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe('23503');
  });
});

describe('the schedule and the appointments are scoped to one listing', () => {
  it('keeps windows per property', async () => {
    const other = await insertProperty(db, scaffold, { oxyUserId: OWNER });
    await db.insert(propertyViewingWindows).values({
      propertyId,
      weekday: 2,
      startMinute: 600,
      endMinute: 660,
      slotMinutes: 30,
      modality: 'in_person',
    });

    const mine = await db
      .select({ id: propertyViewingWindows.id })
      .from(propertyViewingWindows)
      .where(and(eq(propertyViewingWindows.propertyId, other)));
    expect(mine).toHaveLength(0);
    await db.delete(properties).where(eq(properties.id, other));
  });
});
