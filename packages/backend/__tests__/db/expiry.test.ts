/**
 * The expiry registry — the replacement for Homiio's Mongo TTL indexes, and
 * the risk this migration ranks FIRST because it fails more quietly than
 * anything else in it.
 *
 * Mongo reaps; Postgres does not. A table ported without a registry entry grows
 * forever, with no error, no failing test and no symptom of any kind until
 * disk — and it is invisible in review, because the thing doing the work was
 * never in Homiio's code to be missed. There is no deleted call site to notice.
 *
 * `properties.expires_at` is the first entry, and the most consequential one
 * this migration will produce: the census measured it as populated on **100% of
 * production rows**, so the entire external-listing inventory is under an
 * active scythe today and stops being reaped the moment the cutover lands.
 *
 * ## What this file does NOT prove
 *
 * That the sweep RUNS. `EXPIRY_SWEEP_TARGETS` is data; `services/cron.ts` has
 * to call `sweepAllExpiredRows` with it, and that wiring is a later batch. The
 * registry makes the omission visible, it does not close it — stated here so a
 * green run is not mistaken for a working sweep.
 */

import { getTableName, sql } from 'drizzle-orm';
import { findUnsupportedExpiryColumns } from '@oxyhq/db/assert';
import { sqlColumnName } from '../../db/casing';
import { EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE, EXPIRY_SWEEP_TARGETS } from '../../db/expiry';
import { getCronStatus, initCronJobs, runExpirySweepNow, stopCronJobs } from '../../services/cron';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/**
 * A listing with a deadline, and the geo chain a listing cannot exist without.
 *
 * Written out rather than pulled from a factory because the point of the sweep
 * test is the FK cascade: deleting the property must take its `property_images`
 * with it, and a fixture that skips the parents would test a table in isolation
 * that never exists in isolation.
 */
async function seedProperty(db: Database, expiresAt: Date): Promise<string> {
  // The deadline goes in as an ISO string with an explicit cast: `db.execute`
  // is raw SQL, so none of drizzle's column mappers run and postgres.js has no
  // type to bind a JS `Date` to.
  const suffix = Math.random().toString(36).slice(2, 10);
  const countryId = `c-${suffix}`;
  const regionId = `r-${suffix}`;
  const cityId = `y-${suffix}`;
  const addressId = `a-${suffix}`;
  const propertyId = `p-${suffix}`;

  // One statement per `execute`: a parameterised query cannot carry multiple
  // commands, and batching them reads as a schema fault rather than as the
  // protocol limit it is.
  await db.execute(sql`insert into countries (id, code, name)
    values (${countryId}, ${suffix.slice(0, 2).toUpperCase()}, ${`Country ${suffix}`})`);
  await db.execute(sql`insert into regions (id, country_id, name)
    values (${regionId}, ${countryId}, ${`Region ${suffix}`})`);
  await db.execute(sql`insert into cities (id, name, country_id, region_id)
    values (${cityId}, ${`City ${suffix}`}, ${countryId}, ${regionId})`);
  await db.execute(sql`insert into addresses
      (id, country_id, region_id, city_id, country_code, street, postal_code, longitude, latitude)
    values (${addressId}, ${countryId}, ${regionId}, ${cityId}, 'ES', 'Carrer Test', '08001', 2.1686, 41.3985)`);
  await db.execute(sql`insert into properties
      (id, address_id, source_url, expires_at, offerings, long_term_rent_monthly_amount)
    values (${propertyId}, ${addressId}, 'https://example.test/ad',
            ${expiresAt.toISOString()}::timestamptz, '{long_term_rent}', 1000)`);
  return propertyId;
}

async function propertyExists(db: Database, id: string): Promise<boolean> {
  const rows = await db.execute<{ found: number }>(
    sql`select count(*)::int as found from properties where id = ${id}`,
  );
  return (rows[0]?.found ?? 0) > 0;
}

describe('expiry sweep registry', () => {
  it('backs every registered column with a leading btree index', async () => {
    // Against the REAL catalogue, not the declarations: the sweep's predicate
    // is `column <= now() - retention`, which is a range scan, and Mongo's TTL
    // index carried the same obligation implicitly. Without the index the sweep
    // is a full scan of the largest table in the schema, on a schedule.
    const violations = await findUnsupportedExpiryColumns(db, EXPIRY_SWEEP_TARGETS);
    expect(violations).toEqual([]);
  });

  it('registers exactly the five columns that mean "delete this row"', async () => {
    // A vacuity floor with teeth: `findUnsupportedExpiryColumns` over an EMPTY
    // registry returns `[]` and passes the assertion above while checking
    // nothing at all. Naming the entries is what makes that assertion mean
    // something.
    //
    // The set is CLOSED and this is the whole census: `grep -rn
    // expireAfterSeconds models/` returns FIVE TTL indexes, and the fifth —
    // `conversations.sharing_expires_at` — is the one that must never be swept.
    // Asserting the exact list in both directions is what makes "five in the
    // source, four here, one refused" a checked statement rather than an
    // arithmetic claim in a comment.
    //
    // `housing_domain_events.expires_at` (#356) is the FIFTH entry and has no
    // Mongo ancestor at all — it was registered when the table was created
    // rather than found by that census. That is the shape this registry wants
    // every future table to arrive in, and it is why the count in this test's
    // NAME is now the registry's size rather than the census's: the two stopped
    // being the same number the moment a table was born on Postgres.
    const registered = EXPIRY_SWEEP_TARGETS.map(
      (target) => `${getTableName(target.table)}.${sqlColumnName(target.column)}`,
    ).sort();
    expect(registered).toEqual([
      'housing_domain_events.expires_at',
      'moderation_events.expires_at',
      'moderation_outbox.expires_at',
      'place_pois.expires_at',
      'properties.expires_at',
    ]);
  });

  it('never sweeps a TTL column whose deletion would destroy user content', () => {
    // The rule `db/expiry.ts` states as data. Without this check, a later reader
    // comparing the source's five TTL indexes against the four registered above
    // finds the registry one short and closes the gap — which is precisely the
    // change that would start deleting people's conversations, because
    // `Conversation.sharing.expiresAt` is a SHARE LINK's deadline and its TTL
    // takes the whole transcript with it.
    const registered = new Set(
      EXPIRY_SWEEP_TARGETS.map(
        (target) => `${getTableName(target.table)}.${sqlColumnName(target.column)}`,
      ),
    );
    const forbidden = EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE.map(
      (entry) => `${getTableName(entry.table)}.${sqlColumnName(entry.column)}`,
    );

    // Vacuity floor: an empty forbidden list would make the filter below pass
    // over nothing, which is indistinguishable from a registry that respects it.
    //
    // `eviction_cases.archived_at` joined it with #358: the column is a STAMP
    // recording when a case left the public board, and the row must survive it
    // (ADR 0003 §7.5 keeps the anonymised outcome deliberately). Registering it
    // as a sweep target would delete a notice ninety days after its last edit
    // and would read as housekeeping in the diff.
    expect(forbidden).toEqual([
      'conversations.sharing_expires_at',
      'eviction_cases.archived_at',
    ]);
    expect(forbidden.filter((label) => registered.has(label))).toEqual([]);

    const unexplained = EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE.filter(
      (entry) => entry.reason.trim().length < 40,
    ).map((entry) => getTableName(entry.table));
    expect(unexplained).toEqual([]);
  });

  it('gives every target a retention and a reason', () => {
    // A registry entry with no note reads as "unconditionally safe to sweep",
    // which is exactly the reading that ports a destructive TTL faithfully. The
    // one Homiio has that is NOT safe — `Conversation.sharing.expiresAt`, which
    // deletes the whole conversation — must never appear here as a delete.
    const unexplained = EXPIRY_SWEEP_TARGETS
      .filter((target) => target.reason.trim().length < 40)
      .map((target) => getTableName(target.table));
    expect(unexplained).toEqual([]);

    const negative = EXPIRY_SWEEP_TARGETS.filter((target) => target.retentionSeconds < 0);
    expect(negative).toEqual([]);
  });

  it('is SCHEDULED — the call this registry says nothing makes', () => {
    // The gap this closes, stated as a test rather than as a comment. The
    // registry was complete and correct for weeks and nothing ran it, so every
    // registered table grew forever — no error, no failing test, no symptom of
    // any kind until disk. Measured in production hours after the property
    // cutover: 124 listings past their deadline, 121 already reaped from Mongo,
    // all still being served.
    //
    // A registry entry cannot detect its own absence from the scheduler. This
    // can.
    initCronJobs();
    try {
      expect(Object.keys(getCronStatus())).toContain('expirySweep');
    } finally {
      stopCronJobs();
    }
  });

  it('reaps a row through the REGISTRY the cron job actually passes', async () => {
    // Through the CRON's own sweep, not `sweepAllExpiredRows` directly. "The
    // mechanism works" and "the mechanism is pointed at the right tables" are
    // different claims, and only the second was ever in doubt — a job wired to
    // an empty target list satisfies the first perfectly. Calling the registry
    // here instead let exactly that mutation survive.
    const expired = await seedProperty(db, new Date(Date.now() - 86_400_000));
    const live = await seedProperty(db, new Date(Date.now() + 86_400_000));

    await runExpirySweepNow();

    expect(await propertyExists(db, expired)).toBe(false);
    expect(await propertyExists(db, live)).toBe(true);
  });

  it('sweeps a deadline that has passed and spares one that has not', async () => {
    // The registry is a claim about SEMANTICS — "delete where the column is
    // more than N seconds in the past" — and `retentionSeconds: 0` on a column
    // that already holds the deadline is the shape Mongo's
    // `expireAfterSeconds: 0` meant. Asserting the predicate against real
    // timestamps is what distinguishes that reading from the other one
    // (`0` meaning "never expire"), and they are indistinguishable from the
    // registry entry alone.
    const [target] = EXPIRY_SWEEP_TARGETS;
    // `make_interval(secs => …)` takes the retention as a BOUND PARAMETER.
    // Building an `interval '<n> seconds'` literal by string concatenation
    // would put the registry's own number into SQL text, which is both an
    // injection shape and — as this file found the hard way — one unbalanced
    // quote away from a syntax error that reads like a schema fault.
    const rows = await db.execute<{ expired: boolean; live: boolean }>(sql`
      select
        (now() - interval '1 day' <= now() - make_interval(secs => ${target.retentionSeconds})) as expired,
        (now() + interval '1 day' <= now() - make_interval(secs => ${target.retentionSeconds})) as live
    `);
    expect(rows[0].expired).toBe(true);
    expect(rows[0].live).toBe(false);
  });
});
