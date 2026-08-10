/**
 * The partial unique indexes, asserted against a REAL server.
 *
 * `CONVENTIONS.md` maps Mongo's `sparse` / `partialFilterExpression` onto a
 * Postgres partial unique index in one line. That line hides two things a
 * declaration cannot tell you and only a server can:
 *
 *  1. **The partiality has to be real.** A PLAIN unique index passes every
 *     "rejects a duplicate" test — the assertions that fail are the ones about
 *     what it must PERMIT. `roommate_requests` must accept a second request
 *     after the first was declined; `listing_reports` must accept a re-file
 *     after the first was resolved. Those are the rows a full unique index eats,
 *     silently, months later, as "you already reported this" on a listing that
 *     is still wrong.
 *  2. **NULL is DISTINCT in Postgres and was not in Mongo's `sparse`.** A
 *     sparse-unique column must be written NULL and never `''` — an empty string
 *     is a VALUE, so it collides for real. Asserting that N NULLs coexist and
 *     that two `''`s do not is what makes the difference visible.
 *
 * Every case below therefore checks BOTH directions. A one-direction test here
 * cannot tell a correct index from a wrong one.
 */

import { eq, sql } from 'drizzle-orm';
import { UNIQUE_VIOLATION, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  billing,
  conversations,
  listingReports,
  properties,
  roommateRelationships,
  roommateRequests,
  savedPropertyFolders,
  savedSearches,
} from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyScaffold,
} from './propertyFixtures';

/** A distinct Oxy id per assertion, so no two cases can collide with each other. */
const oxy = (): string => `oxy-${uuidv7()}`;

let db: Database;
let scaffold: PropertyScaffold;
let propertyId: string;

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'partial-uniques');
  propertyId = await insertProperty(db, scaffold);
});

afterAll(async () => {
  await db.delete(listingReports).where(eq(listingReports.propertyId, propertyId));
  await db.delete(properties).where(eq(properties.id, propertyId));
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

describe('listing_reports — one OPEN report per reporter per property', () => {
  it('refuses a second open report from the same reporter', async () => {
    const reporter = oxy();
    await db
      .insert(listingReports)
      .values({ propertyId, reporterOxyUserId: reporter, reason: 'scam' });

    let caught: unknown;
    try {
      await db
        .insert(listingReports)
        .values({ propertyId, reporterOxyUserId: reporter, reason: 'inaccurate' });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);
  });

  it('ACCEPTS a re-file once the first report is resolved', async () => {
    // The half a plain unique index would break. Mongo's
    // `partialFilterExpression: { status: 'open' }` exists precisely so a listing
    // that is still wrong after a dismissal can be reported again — without this
    // assertion, dropping `.where(...)` from the index passes the whole file.
    const reporter = oxy();
    const [first] = await db
      .insert(listingReports)
      .values({ propertyId, reporterOxyUserId: reporter, reason: 'scam' })
      .returning({ id: listingReports.id });

    await db
      .update(listingReports)
      .set({ status: 'dismissed' })
      .where(eq(listingReports.id, first.id));

    await expect(
      db
        .insert(listingReports)
        .values({ propertyId, reporterOxyUserId: reporter, reason: 'scam' }),
    ).resolves.toBeDefined();
  });
});

describe('roommate_requests — one PENDING request per ordered pair', () => {
  it('refuses a second pending request', async () => {
    const from = oxy();
    const to = oxy();
    await db.insert(roommateRequests).values({ fromOxyUserId: from, toOxyUserId: to });

    let caught: unknown;
    try {
      await db.insert(roommateRequests).values({ fromOxyUserId: from, toOxyUserId: to });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);

    await db.delete(roommateRequests).where(eq(roommateRequests.fromOxyUserId, from));
  });

  it('ACCEPTS a new request after the first was declined', async () => {
    const from = oxy();
    const to = oxy();
    const [first] = await db
      .insert(roommateRequests)
      .values({ fromOxyUserId: from, toOxyUserId: to })
      .returning({ id: roommateRequests.id });
    await db
      .update(roommateRequests)
      .set({ status: 'declined' })
      .where(eq(roommateRequests.id, first.id));

    await expect(
      db.insert(roommateRequests).values({ fromOxyUserId: from, toOxyUserId: to }),
    ).resolves.toBeDefined();

    await db.delete(roommateRequests).where(eq(roommateRequests.fromOxyUserId, from));
  });
});

describe('roommate_relationships — one ACTIVE relationship per sorted pair', () => {
  /** Sorted, because the CHECK requires it and the unique index assumes it. */
  const sortedPair = (): [string, string] => {
    const [a, b] = [oxy(), oxy()].sort();
    return [a, b];
  };

  it('refuses a second active relationship for the same pair', async () => {
    const [one, two] = sortedPair();
    await db.insert(roommateRelationships).values({
      oxyUser1Id: one,
      oxyUser2Id: two,
      startDate: new Date(Date.UTC(2026, 0, 1)),
    });

    let caught: unknown;
    try {
      await db.insert(roommateRelationships).values({
        oxyUser1Id: one,
        oxyUser2Id: two,
        startDate: new Date(Date.UTC(2026, 5, 1)),
      });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);

    await db.delete(roommateRelationships).where(eq(roommateRelationships.oxyUser1Id, one));
  });

  it('ACCEPTS a new relationship after the previous one ended', async () => {
    // Two people who lived together, parted, and moved back in. A plain unique
    // index would make that unrepresentable forever.
    const [one, two] = sortedPair();
    const [first] = await db
      .insert(roommateRelationships)
      .values({ oxyUser1Id: one, oxyUser2Id: two, startDate: new Date(Date.UTC(2024, 0, 1)) })
      .returning({ id: roommateRelationships.id });
    await db
      .update(roommateRelationships)
      .set({ status: 'ended', endDate: new Date(Date.UTC(2025, 0, 1)) })
      .where(eq(roommateRelationships.id, first.id));

    await expect(
      db.insert(roommateRelationships).values({
        oxyUser1Id: one,
        oxyUser2Id: two,
        startDate: new Date(Date.UTC(2026, 0, 1)),
      }),
    ).resolves.toBeDefined();

    await db.delete(roommateRelationships).where(eq(roommateRelationships.oxyUser1Id, one));
  });
});

describe('sparse uniques permit many NULLs and exactly one of any value', () => {
  it('lets every unshared conversation coexist, and refuses a duplicate token', async () => {
    // `sharing_share_token` is Mongo's `unique: true, sparse: true`. The NULL
    // half is the one that matters: without it, the SECOND conversation anybody
    // creates fails to insert.
    const owner = oxy();
    await db.insert(conversations).values([
      { oxyUserId: owner, title: 'a', analyticsLastActivity: new Date() },
      { oxyUserId: owner, title: 'b', analyticsLastActivity: new Date() },
      { oxyUserId: owner, title: 'c', analyticsLastActivity: new Date() },
    ]);

    const rows = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.oxyUserId, owner));
    expect(rows).toHaveLength(3);

    const token = `tok-${uuidv7()}`;
    const shared = {
      sharingIsShared: true,
      sharingShareToken: token,
      sharingSharedAt: new Date(),
      sharingExpiresAt: new Date(Date.now() + 86_400_000),
    };
    await db
      .update(conversations)
      .set(shared)
      .where(eq(conversations.id, rows[0].id));

    let caught: unknown;
    try {
      await db
        .update(conversations)
        .set(shared)
        .where(eq(conversations.id, rows[1].id));
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);

    await db.delete(conversations).where(eq(conversations.oxyUserId, owner));
  });

  it('collides on an EMPTY STRING, which is why it must be written NULL', async () => {
    // The trap `CONVENTIONS.md` records, made visible. `''` is a VALUE under a
    // partial unique index, so writing it instead of NULL turns a non-problem
    // into a live 500 on the second row — and the code that does it looks
    // perfectly reasonable.
    const account = oxy();
    await db.insert(billing).values({ oxyUserId: account, plusStripeSubscriptionId: '' });

    let caught: unknown;
    try {
      await db.insert(billing).values({ oxyUserId: oxy(), plusStripeSubscriptionId: '' });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);

    // …while NULL, the correct spelling, coexists any number of times.
    await expect(
      db.insert(billing).values([{ oxyUserId: oxy() }, { oxyUserId: oxy() }]),
    ).resolves.toBeDefined();

    await db.delete(billing).where(eq(billing.oxyUserId, account));
  });
});

describe('saved_property_folders — one name per person, case-INSENSITIVELY', () => {
  it('refuses a folder whose name differs only in case', async () => {
    // Mongo expressed this as `collation: { locale: 'en', strength: 2 }`, which
    // Postgres has no per-index equivalent for. A functional unique index on
    // `lower(name)` is the port — and a plain `UNIQUE(oxy_user_id, name)` would
    // pass every test that only inserts differently-spelled names.
    const owner = oxy();
    await db.insert(savedPropertyFolders).values({ oxyUserId: owner, name: 'Barcelona' });

    let caught: unknown;
    try {
      await db.insert(savedPropertyFolders).values({ oxyUserId: owner, name: 'BARCELONA' });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);

    await db.delete(savedPropertyFolders).where(eq(savedPropertyFolders.oxyUserId, owner));
  });

  it('scopes that rule to one person', async () => {
    // Vacuity guard on the case above: an index on `lower(name)` ALONE would
    // also reject this, and would then be a global folder namespace.
    const first = oxy();
    const second = oxy();
    await db.insert(savedPropertyFolders).values({ oxyUserId: first, name: 'Madrid' });
    await expect(
      db.insert(savedPropertyFolders).values({ oxyUserId: second, name: 'madrid' }),
    ).resolves.toBeDefined();

    await db.delete(savedPropertyFolders).where(eq(savedPropertyFolders.oxyUserId, first));
    await db.delete(savedPropertyFolders).where(eq(savedPropertyFolders.oxyUserId, second));
  });
});

describe('saved_searches — ONE primary area per person (#356)', () => {
  it('refuses a second primary area for the same person', async () => {
    const owner = oxy();
    await db.insert(savedSearches).values({
      oxyUserId: owner,
      name: 'Gràcia',
      query: '',
      isPrimaryArea: true,
    });

    let caught: unknown;
    try {
      await db.insert(savedSearches).values({
        oxyUserId: owner,
        name: 'Eixample',
        query: '',
        isPrimaryArea: true,
      });
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(UNIQUE_VIOLATION);

    await db.delete(savedSearches).where(eq(savedSearches.oxyUserId, owner));
  });

  it('PERMITS any number of non-primary watches for that same person', async () => {
    // The half a plain `UNIQUE(oxy_user_id, is_primary_area)` would fail, and the
    // reason the index has to be partial: that index also permits only ONE
    // non-primary watch per person, which is absurd and would surface to a user
    // as "you already have a saved search". Every "refuses a duplicate"
    // assertion above passes under it.
    const owner = oxy();
    await db.insert(savedSearches).values([
      { oxyUserId: owner, name: 'Sants', query: '' },
      { oxyUserId: owner, name: 'Poblenou', query: '' },
      { oxyUserId: owner, name: 'Sarrià', query: '' },
    ]);
    const rows = await db.select().from(savedSearches).where(eq(savedSearches.oxyUserId, owner));
    expect(rows).toHaveLength(3);

    await db.delete(savedSearches).where(eq(savedSearches.oxyUserId, owner));
  });

  it('scopes the rule to one person — two people may each have a primary area', async () => {
    // Vacuity guard: an index on `is_primary_area` alone would reject this and
    // would then mean "one primary area in the whole product".
    const first = oxy();
    const second = oxy();
    await db
      .insert(savedSearches)
      .values({ oxyUserId: first, name: 'Home', query: '', isPrimaryArea: true });
    await expect(
      db
        .insert(savedSearches)
        .values({ oxyUserId: second, name: 'Home', query: '', isPrimaryArea: true }),
    ).resolves.toBeDefined();

    await db.delete(savedSearches).where(eq(savedSearches.oxyUserId, first));
    await db.delete(savedSearches).where(eq(savedSearches.oxyUserId, second));
  });
});

describe('the partial indexes really are partial', () => {
  it('carries a WHERE clause on every one of them, in the CATALOGUE', async () => {
    // The declaration-level backstop for every "ACCEPTS …" assertion above: those
    // read the BEHAVIOUR, this reads what the server actually built. An index
    // silently created without its predicate would make the permit-cases fail —
    // but only if a test happens to cover that exact index, and this schema has
    // more partial indexes than assertions above.
    const rows = await db.execute<{ indexname: string; predicate: string | null }>(sql`
      select i.relname as indexname, pg_get_expr(x.indpred, x.indrelid) as predicate
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public' and x.indisunique and x.indpred is not null
      order by 1
    `);
    const named = rows.map((row) => row.indexname);

    // Every partial UNIQUE index in the schema, named. A new one has to be added
    // here deliberately, which is the point — it is the list a reviewer checks
    // against the Mongo `partialFilterExpression`s.
    expect(named).toEqual([
      'addresses_normalized_key_key',
      'billing_plus_stripe_subscription_id_key',
      'conversations_share_token_key',
      // ONE live grant per (case, grantee): the partiality is what lets a
      // revoked grant free the slot for a fresh one instead of blocking it
      // forever, and it is why every `ON CONFLICT` against this index has to
      // carry the arbiter predicate (`42P10` at runtime otherwise).
      'eviction_location_grants_live_key',
      'eviction_reports_open_reporter_key',
      'listing_reports_open_reporter_key',
      'properties_source_source_id_key',
      'property_images_one_primary_key',
      'roommate_relationships_active_pair_key',
      'roommate_requests_pending_pair_key',
      'saved_searches_primary_area_key',
    ]);
    expect(rows.every((row) => (row.predicate ?? '').length > 0)).toBe(true);
  });
});
