/**
 * The idempotency constraint is LOAD-BEARING — proved by removing it.
 *
 * Issue #356's last mandatory test is "mutación que elimine unique/idempotency
 * constraint debe fallar", and the reason it is worth a file of its own is that
 * the ordinary dedupe assertion cannot tell two situations apart:
 *
 *  - the unique index refused the second claim (what is supposed to happen), and
 *  - the application never tried to make one (a matcher that skipped the second
 *    event, a fixture that recorded one event twice into a variable, a `for`
 *    loop that ran once).
 *
 * Both produce "one alert" and both look green. So this file DROPS the index,
 * runs the identical scenario, and asserts the duplicate NOW APPEARS. That is
 * the only assertion that distinguishes "the constraint did the work" from "the
 * work never happened", and it is the shape `~/Oxy/AGENTS.md` calls a check that
 * can distinguish success from failure.
 *
 * ## It is a permanent gate rather than a one-off mutation run
 *
 * A mutation performed by hand proves the constraint mattered on the day
 * somebody ran it. This runs in CI, so it also fails the day somebody replaces
 * the index with a read-then-write, or narrows it to `(watch_id, rule_type)`, or
 * quietly adds a column to it.
 *
 * ## Three properties that keep it honest
 *
 * 1. **The mutation is asserted to have LANDED** before the scenario runs. A
 *    `DROP INDEX` that silently matched nothing would leave the index in place,
 *    the duplicate would not appear, and the failure would read as "the app
 *    dedupes on its own" — the opposite of the truth.
 * 2. **The index is restored in `afterAll`**, not merely at the end of the last
 *    case, so a thrown assertion cannot leave the worker's database with the
 *    constraint missing for whatever file jest runs next.
 * 3. **The restore is verified**, for the same reason the drop is.
 */

import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { housingAlerts, savedSearches } from '../../db/schema';
import { claimAlert } from '../../db/watches/alertRepository';
import { alertIdempotencyKey } from '../../db/watches/domainEventRepository';
import type { AlertExplanation } from '@homiio/shared-types';

const INDEX_NAME = 'housing_alerts_idempotency_key';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  // Restored here rather than at the end of the last case: a thrown assertion
  // would otherwise hand the next file in this worker a database with no
  // idempotency constraint, and every dedupe assertion in it would fail for a
  // reason that has nothing to do with the code it is testing.
  await restoreIndex();
  await closePostgres();
});

async function indexExists(): Promise<boolean> {
  const rows = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
    from pg_indexes
    where schemaname = 'public' and indexname = ${INDEX_NAME}
  `);
  return (rows[0]?.count ?? 0) > 0;
}

async function dropIndex(): Promise<void> {
  await db.execute(sql.raw(`drop index if exists "${INDEX_NAME}"`));
}

async function restoreIndex(): Promise<void> {
  await db.execute(
    sql.raw(`create unique index if not exists "${INDEX_NAME}" on "housing_alerts" ("idempotency_key")`),
  );
}

/** A watch to hang the alerts off — the FK is real, so a row has to exist. */
async function createWatch(): Promise<{ watchId: string; oxyUserId: string }> {
  const oxyUserId = `oxy-${uuidv7()}`;
  const [row] = await db
    .insert(savedSearches)
    .values({ oxyUserId, name: `Watch ${uuidv7()}`, query: '' })
    .returning();
  return { watchId: row.id, oxyUserId };
}

function explanationFor(watchId: string): AlertExplanation {
  return {
    watchName: 'Eixample',
    watchId,
    ruleType: 'new_listing',
    ruleVersion: 1,
    detail: { kind: 'new_listing', listingTitle: 'A flat', offering: 'long_term_rent' },
  };
}

/**
 * Claim the same transition twice, exactly as the matcher does.
 *
 * The two calls are byte-identical on purpose: the whole question is whether
 * something OTHER than the caller stops the second one.
 */
async function claimTwice(watch: { watchId: string; oxyUserId: string }): Promise<number> {
  const subjectId = `property-${uuidv7()}`;
  const transition = { title: 'A flat', offering: 'long_term_rent' };
  const idempotencyKey = alertIdempotencyKey({
    watchId: watch.watchId,
    ruleType: 'new_listing',
    subjectType: 'property',
    subjectId,
    transition,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await claimAlert(db, {
      watchId: watch.watchId,
      oxyUserId: watch.oxyUserId,
      eventId: null,
      ruleType: 'new_listing',
      ruleVersion: 1,
      idempotencyKey,
      subjectType: 'property',
      subjectId,
      // NULL, so the COOLDOWN index cannot be the thing doing the deduping — it
      // is `NULLS DISTINCT`, so it constrains nothing here. Without this the
      // experiment would be measuring the wrong index and would report the
      // idempotency key as load-bearing whether or not it was.
      cooldownBucket: null,
      explanation: explanationFor(watch.watchId),
    });
  }

  const rows = await db
    .select()
    .from(housingAlerts)
    .where(eq(housingAlerts.watchId, watch.watchId));
  return rows.length;
}

describe('the idempotency constraint is what prevents the duplicate', () => {
  it('WITH the unique index, a repeated claim produces exactly one alert', async () => {
    expect(await indexExists()).toBe(true);
    const watch = await createWatch();
    expect(await claimTwice(watch)).toBe(1);
    await db.delete(savedSearches).where(eq(savedSearches.id, watch.watchId));
  });

  it('WITHOUT it, the identical scenario produces TWO — so the index is doing the work', async () => {
    // The mutation, and the assertion that it LANDED. A `DROP INDEX` that
    // matched nothing would leave the constraint in place, the duplicate would
    // not appear, and the failure would read as "the application dedupes on its
    // own", which is the opposite of the truth.
    await dropIndex();
    expect(await indexExists()).toBe(false);

    const watch = await createWatch();
    const duplicated = await claimTwice(watch);

    await db.delete(savedSearches).where(eq(savedSearches.id, watch.watchId));
    await restoreIndex();
    expect(await indexExists()).toBe(true);

    // Asserted AFTER the restore, so a failure here still leaves the database
    // usable for whatever runs next.
    expect(duplicated).toBe(2);
  });

  it('is a UNIQUE index, not a plain one — a plain btree would permit both rows', async () => {
    // The half a `pg_indexes` presence check cannot see: an index with this name
    // that is not unique satisfies "the index exists" and constrains nothing.
    const rows = await db.execute<{ isunique: boolean }>(sql`
      select x.indisunique as isunique
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      where i.relname = ${INDEX_NAME}
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].isunique).toBe(true);
  });

  it('covers the idempotency key ALONE, so the transition is the whole identity', async () => {
    // A wider index — `(watch_id, idempotency_key)`, say — would still refuse the
    // duplicate above (the key already contains the watch id) while quietly
    // permitting two watches to share a key, which nothing else here would
    // notice. Reading the catalogue's column list is what pins the shape.
    const rows = await db.execute<{ columns: string }>(sql`
      select string_agg(a.attname, ',' order by k.ord) as columns
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join lateral unnest(x.indkey) with ordinality as k(attnum, ord) on true
      join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
      where i.relname = ${INDEX_NAME}
    `);
    expect(rows[0].columns).toBe('idempotency_key');
  });
});
