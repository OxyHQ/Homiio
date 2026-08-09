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
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

describe('expiry sweep registry', () => {
  it('backs every registered column with a leading btree index', async () => {
    // Against the REAL catalogue, not the declarations: the sweep's predicate
    // is `column <= now() - retention`, which is a range scan, and Mongo's TTL
    // index carried the same obligation implicitly. Without the index the sweep
    // is a full scan of the largest table in the schema, on a schedule.
    const violations = await findUnsupportedExpiryColumns(db, EXPIRY_SWEEP_TARGETS);
    expect(violations).toEqual([]);
  });

  it('registers exactly the four TTL columns that mean "delete this row"', async () => {
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
    const registered = EXPIRY_SWEEP_TARGETS.map(
      (target) => `${getTableName(target.table)}.${sqlColumnName(target.column)}`,
    ).sort();
    expect(registered).toEqual([
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
    expect(forbidden).toEqual(['conversations.sharing_expires_at']);
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
