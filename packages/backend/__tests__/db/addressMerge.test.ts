/**
 * Merging two canonical addresses, against a REAL Postgres server.
 *
 * A real server is not optional here, and the reasons are the ones this
 * repository has already paid for once each: the review collision is a UNIQUE
 * violation whose SQLSTATE lives on drizzle's `cause` rather than on
 * `error.code`; a failed statement inside a transaction aborts the whole thing
 * (`25P02`), so the savepoint that survives the collision is only observable at
 * COMMIT; and the "you may not delete the loser" property is enforced by ten
 * `ON DELETE RESTRICT` constraints that no mock has.
 *
 * ## The fixtures are built so the two READINGS DISAGREE
 *
 * A merge test where both rows carry the same relations cannot tell "moved the
 * relations" from "did nothing" — both produce a survivor holding everything.
 * So every case here gives the loser and the survivor DIFFERENT rows, and the
 * assertions name row ids rather than counts wherever a count would be
 * satisfied by the wrong set.
 *
 * The review-collision case needs the sharpest version of that: one author who
 * reviewed BOTH addresses (the row that cannot move) AND a second author who
 * reviewed only the loser (the row that must). A fixture with only the first
 * cannot tell "left the colliding row in place" from "moved nothing at all".
 */

import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  addressExternalRefs,
  addressMergeRelationMoves,
  addressMerges,
  addresses,
  properties,
  reviews,
} from '../../db/schema';
import {
  addressForeignKeys,
  addressRelations,
  classifyAddressRelation,
  movableAddressRelations,
  POLYMORPHIC_ADDRESS_RELATIONS,
} from '../../db/addresses/addressRelations';
import {
  AddressMergeRefusedError,
  AddressMergeRevertRefusedError,
  applyAddressMerge,
  planAddressMerge,
  revertAddressMerge,
} from '../../services/addressMerge';

let db: Database;

const SUITE = uuidv7().slice(-12);
let seq = 0;
const nextId = (): string => {
  seq += 1;
  return `${SUITE}-${seq}`;
};

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/**
 * A geo chain shared by every case in this file.
 *
 * Created once with raw SQL rather than through the geo resolver: this file is
 * about relation moves, and the resolver is exercised in its own suite. Sharing
 * one chain is safe because every assertion here names row ids.
 */
let geo: { countryId: string; regionId: string; cityId: string };

beforeAll(async () => {
  const countryId = `c-${SUITE}`;
  const regionId = `r-${SUITE}`;
  const cityId = `ci-${SUITE}`;
  // Only the columns the schema REQUIRES; everything else is defaulted or
  // generated, and naming a column that does not exist fails every case in the
  // file at once rather than the one that needed it.
  await db.execute(
    sql`insert into countries (id, name, code) values (${countryId}, ${'Testland ' + SUITE}, ${'T' + SUITE.slice(-1)})`,
  );
  await db.execute(
    sql`insert into regions (id, country_id, name) values (${regionId}, ${countryId}, ${'Region ' + SUITE})`,
  );
  await db.execute(
    sql`insert into cities (id, country_id, region_id, name) values (${cityId}, ${countryId}, ${regionId}, ${'City ' + SUITE})`,
  );
  geo = { countryId, regionId, cityId };
});

/** A canonical address, inserted directly so its id is the test's to name. */
async function makeAddress(street: string, number?: string): Promise<string> {
  const id = nextId();
  await db.insert(addresses).values({
    id,
    countryId: geo.countryId,
    regionId: geo.regionId,
    cityId: geo.cityId,
    countryCode: 'ES',
    street,
    postalCode: '08013',
    number: number ?? null,
    longitude: 2.17,
    latitude: 41.39,
  });
  return id;
}

async function makeProperty(addressId: string): Promise<string> {
  const id = nextId();
  await db.insert(properties).values({ id, addressId });
  return id;
}

/** A review by `author` of `addressId`, at every level the schema requires. */
async function makeReview(addressId: string, author: string): Promise<string> {
  const id = nextId();
  await db.insert(reviews).values({
    id,
    addressId,
    addressLevel: 'BUILDING',
    streetLevelId: addressId,
    buildingLevelId: addressId,
    price: 950,
    livedFrom: new Date('2024-01-01T00:00:00.000Z'),
    livedTo: new Date('2025-01-01T00:00:00.000Z'),
    livedForMonths: 12,
    recommendation: true,
    opinion: 'Fixture opinion, long enough to be a sentence somebody wrote.',
    rating: 4,
    oxyUserId: author,
  });
  return id;
}

async function makeExternalRef(addressId: string): Promise<string> {
  const id = nextId();
  await db.insert(addressExternalRefs).values({
    id,
    addressId,
    source: 'osm',
    externalId: `ref-${id}`,
    firstSeenAt: new Date(),
    lastSeenAt: new Date(),
  });
  return id;
}

async function addressOf(propertyId: string): Promise<string> {
  const [row] = await db
    .select({ addressId: properties.addressId })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row.addressId;
}

async function reviewAddress(reviewId: string): Promise<{
  addressId: string;
  streetLevelId: string;
  buildingLevelId: string;
}> {
  const [row] = await db
    .select({
      addressId: reviews.addressId,
      streetLevelId: reviews.streetLevelId,
      buildingLevelId: reviews.buildingLevelId,
    })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  return row;
}

async function redirectOf(addressId: string): Promise<string | null> {
  const [row] = await db
    .select({ mergedInto: addresses.mergedIntoAddressId })
    .from(addresses)
    .where(eq(addresses.id, addressId))
    .limit(1);
  return row.mergedInto;
}

const merge = (survivor: string, loser: string) =>
  applyAddressMerge({
    survivorAddressId: survivor,
    mergedAddressId: loser,
    reasonCode: 'duplicate_identity_key',
    reason: 'Two ingests of one building.',
    actorOxyUserId: `oxy-${SUITE}`,
  });

describe('the relation registry cannot go stale', () => {
  it('classifies every foreign key that targets addresses', () => {
    // THE GATE. A column added tomorrow appears in `addressForeignKeys()`
    // automatically and fails here until somebody decides what a merge does with
    // it. There is no default, because a default is a decision made by absence.
    const unclassified = addressForeignKeys().filter(
      ({ table, column }) => classifyAddressRelation(table, column) === null,
    );
    expect(unclassified).toEqual([]);
  });

  it('derives enough relations that a broken derivation cannot pass as clean', () => {
    // The vacuity floor. An empty derivation would satisfy the case above.
    // Measured at 13 foreign keys on this tree (`pg_constraint` agrees — see the
    // catalogue case below); the floor is deliberately below that so an ordinary
    // deletion does not trip it.
    expect(addressForeignKeys().length).toBeGreaterThanOrEqual(10);
  });

  it('finds properties.address_id, which is known to exist', () => {
    // The POSITIVE CONTROL for the derivation. Without it, a derivation that
    // returned nothing would pass both cases above.
    expect(addressForeignKeys()).toContainEqual({ table: 'properties', column: 'address_id' });
  });

  it('finds all FOUR review columns, not just address_id', () => {
    // The census that stopped at "reviews has an address column" would have
    // shipped a merge leaving a review filed under the retired row at two of its
    // three levels.
    const reviewColumns = addressForeignKeys()
      .filter(({ table }) => table === 'reviews')
      .map(({ column }) => column)
      .sort();
    expect(reviewColumns).toEqual([
      'address_id',
      'building_level_id',
      'street_level_id',
      'unit_level_id',
    ]);
  });

  it('keeps the audit trail out of the movable set', () => {
    // `address_merges` points at both rows by construction. Moving those columns
    // would rewrite the record of the merge while performing it.
    const movable = movableAddressRelations().map((r) => `${r.table}.${r.column}`);
    expect(movable).not.toContain('address_merges.merged_address_id');
    expect(movable).not.toContain('address_merges.survivor_address_id');
    expect(movable).not.toContain('address_materializations.address_id');
    expect(movable).toContain('properties.address_id');
  });

  it('still has a subject_type that admits an address, for each polymorphic entry', async () => {
    // The declared half is the dangerous half: nothing derives these, so a
    // discriminator that stopped accepting `'address'` would make the entries
    // lies and no other check would notice. Read from the LIVE catalogue.
    for (const relation of POLYMORPHIC_ADDRESS_RELATIONS) {
      const rows = await db.execute<{ def: string }>(sql`
        select pg_get_constraintdef(c.oid) as def
        from pg_constraint c
        where c.conrelid = ${relation.table}::regclass
          and c.contype = 'c'
          and pg_get_constraintdef(c.oid) like ${'%' + relation.discriminator!.column + '%'}
      `);
      const definitions = [...rows].map((row) => row.def);
      expect(definitions.length).toBeGreaterThan(0);
      expect(definitions.some((def) => def.includes(`'${relation.discriminator!.value}'`))).toBe(
        true,
      );
    }
  });

  it('agrees with the live catalogue about which foreign keys exist', async () => {
    // Two independent instruments — drizzle's schema objects and pg_constraint —
    // must return the same set. A disagreement means the schema and the database
    // have drifted, which is exactly what a migration generated off the wrong
    // parent produces.
    const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
      select c.conrelid::regclass::text as table_name, a.attname as column_name
      from pg_constraint c
      join unnest(c.conkey) as k(attnum) on true
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      where c.contype = 'f' and c.confrelid = 'addresses'::regclass
    `);
    const fromCatalogue = [...rows]
      .map((row) => `${row.table_name}.${row.column_name}`)
      .sort();
    const fromSchema = addressForeignKeys().map((fk) => `${fk.table}.${fk.column}`).sort();
    expect(fromSchema).toEqual(fromCatalogue);
  });
});

describe('a merge moves the relations and records what it did', () => {
  it('repoints listings, reviews at every level, and provider refs', async () => {
    const survivor = await makeAddress('Carrer de Provença', '42');
    const loser = await makeAddress('Carrer de Provenca', '42');

    // DIFFERENT rows on each side, so "moved" and "did nothing" disagree.
    const survivorProperty = await makeProperty(survivor);
    const loserProperty = await makeProperty(loser);
    const loserReview = await makeReview(loser, `author-a-${SUITE}`);
    const loserRef = await makeExternalRef(loser);

    const result = await merge(survivor, loser);

    expect(result.survivorAddressId).toBe(survivor);
    expect(result.mergedAddressId).toBe(loser);
    expect(result.leftInPlaceCount).toBe(0);

    // Named by ID, not counted: a count of 2 would also be produced by moving
    // the survivor's own property onto itself.
    expect(await addressOf(loserProperty)).toBe(survivor);
    expect(await addressOf(survivorProperty)).toBe(survivor);

    // All THREE review columns, which is the half a one-column census misses.
    const moved = await reviewAddress(loserReview);
    expect(moved.addressId).toBe(survivor);
    expect(moved.streetLevelId).toBe(survivor);
    expect(moved.buildingLevelId).toBe(survivor);

    const [ref] = await db
      .select({ addressId: addressExternalRefs.addressId })
      .from(addressExternalRefs)
      .where(eq(addressExternalRefs.id, loserRef));
    expect(ref.addressId).toBe(survivor);

    // The redirect, which is what makes the loser still resolve.
    expect(await redirectOf(loser)).toBe(survivor);
  });

  it('re-parents the children of the losing row', async () => {
    const survivor = await makeAddress('Carrer del Consell', '10');
    const loser = await makeAddress('Carrer del Consel', '10');
    const child = await makeAddress('Carrer del Consell', '10');
    await db
      .update(addresses)
      .set({ parentAddressId: loser })
      .where(eq(addresses.id, child));

    await merge(survivor, loser);

    const [row] = await db
      .select({ parentAddressId: addresses.parentAddressId })
      .from(addresses)
      .where(eq(addresses.id, child));
    // Without this move the unit's building would be a retired row, and
    // `parent_address_id` is what every other domain reads instead of
    // recomputing the chain.
    expect(row.parentAddressId).toBe(survivor);
  });

  it('leaves a colliding review in place and names the constraint', async () => {
    const survivor = await makeAddress('Carrer de Girona', '7');
    const loser = await makeAddress('Carrer de Gerona', '7');

    const author = `author-both-${SUITE}`;
    // The author who reviewed BOTH: their loser-side review cannot move,
    // because `reviews_author_address_key` is unique on (oxy_user_id,
    // address_id).
    await makeReview(survivor, author);
    const collidingReview = await makeReview(loser, author);
    // The author who reviewed ONLY the loser. Without this row the case could
    // not tell "left the colliding one in place" from "moved nothing at all".
    const movableReview = await makeReview(loser, `author-only-${SUITE}`);

    const result = await merge(survivor, loser);

    expect(result.leftInPlaceCount).toBeGreaterThan(0);
    expect(await reviewAddress(collidingReview)).toMatchObject({ addressId: loser });
    expect(await reviewAddress(movableReview)).toMatchObject({ addressId: survivor });

    const blocked = await db
      .select()
      .from(addressMergeRelationMoves)
      .where(eq(addressMergeRelationMoves.mergeId, result.mergeId));
    const leftInPlace = blocked.filter((move) => move.outcome === 'left_in_place');
    expect(leftInPlace.length).toBeGreaterThan(0);
    // The constraint name is the one fact an operator needs and the one that is
    // gone by the time anybody reads the log.
    expect(leftInPlace[0].blockedByConstraint).toBe('reviews_author_address_key');
    // NOTHING was deleted. ADR 0001 §2.1.7, and the assertion that separates
    // this implementation from the tempting one.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reviews)
      .where(eq(reviews.id, collidingReview));
    expect(Number(count)).toBe(1);
  });

  it('records a move log whose size matches the count it stored', async () => {
    const survivor = await makeAddress('Carrer de Roselló', '3');
    const loser = await makeAddress('Carrer de Rossello', '3');
    await makeProperty(loser);
    await makeProperty(loser);

    const result = await merge(survivor, loser);
    const [row] = await db
      .select()
      .from(addressMerges)
      .where(eq(addressMerges.id, result.mergeId));

    expect(row.movedRelationCount).toBe(result.movedCount);
    expect(row.status).toBe('applied');
    expect(row.reason).toBe('Two ingests of one building.');
    expect(row.revertedAt).toBeNull();
  });
});

describe('the dry run writes nothing', () => {
  it('reports the moves it would make and leaves the rows alone', async () => {
    const survivor = await makeAddress('Carrer de Bailèn', '5');
    const loser = await makeAddress('Carrer de Bailen', '5');
    const property = await makeProperty(loser);

    const plan = await planAddressMerge({
      survivorAddressId: survivor,
      mergedAddressId: loser,
    });

    expect(plan.moves).toContainEqual(
      expect.objectContaining({ table: 'properties', column: 'address_id', rowId: property }),
    );
    expect(plan.countsByRelation['properties.address_id']).toBe(1);

    // Nothing moved, and no redirect was written.
    expect(await addressOf(property)).toBe(loser);
    expect(await redirectOf(loser)).toBeNull();
  });
});

describe('a merge is reversible, which is the requirement', () => {
  it('puts every moved row back and clears the redirect', async () => {
    const survivor = await makeAddress('Carrer de Muntaner', '11');
    const loser = await makeAddress('Carrer de Montaner', '11');
    const survivorProperty = await makeProperty(survivor);
    const loserProperty = await makeProperty(loser);
    const loserReview = await makeReview(loser, `author-rev-${SUITE}`);

    const applied = await merge(survivor, loser);
    expect(await addressOf(loserProperty)).toBe(survivor);

    const { restoredCount } = await revertAddressMerge(applied.mergeId, `oxy-${SUITE}`, undefined);

    expect(restoredCount).toBe(applied.movedCount);
    expect(await addressOf(loserProperty)).toBe(loser);
    // The survivor's OWN rows must not move. A revert that put everything on the
    // survivor back onto the loser would pass a count assertion and destroy the
    // survivor — which is why the log is replayed rather than re-derived.
    expect(await addressOf(survivorProperty)).toBe(survivor);
    expect(await reviewAddress(loserReview)).toMatchObject({
      addressId: loser,
      streetLevelId: loser,
      buildingLevelId: loser,
    });
    expect(await redirectOf(loser)).toBeNull();

    const [row] = await db
      .select()
      .from(addressMerges)
      .where(eq(addressMerges.id, applied.mergeId));
    expect(row.status).toBe('reverted');
    expect(row.revertedAt).not.toBeNull();
  });

  it('refuses to revert twice', async () => {
    const survivor = await makeAddress('Carrer de Balmes', '21');
    const loser = await makeAddress('Carrer de Valmes', '21');
    const applied = await merge(survivor, loser);
    await revertAddressMerge(applied.mergeId, null, undefined);

    await expect(revertAddressMerge(applied.mergeId, null, undefined)).rejects.toBeInstanceOf(
      AddressMergeRevertRefusedError,
    );
  });

  it('refuses when the move log no longer matches the count it recorded', async () => {
    // The anti-vacuity floor of the whole operation: a merge whose log was
    // partially lost must not be half-reverted silently. `0` is a legitimate
    // count, so the assertion is EQUALITY and not `> 0`.
    const survivor = await makeAddress('Carrer d’Aribau', '33');
    const loser = await makeAddress('Carrer d’Aribao', '33');
    await makeProperty(loser);
    const applied = await merge(survivor, loser);
    expect(applied.movedCount).toBeGreaterThan(0);

    await db
      .delete(addressMergeRelationMoves)
      .where(eq(addressMergeRelationMoves.mergeId, applied.mergeId));

    await expect(revertAddressMerge(applied.mergeId, null, undefined)).rejects.toMatchObject({
      refusal: { kind: 'move_log_incomplete' },
    });
  });
});

describe('the refusals', () => {
  it('refuses to merge a row into itself', async () => {
    const address = await makeAddress('Carrer de Casanova', '1');
    await expect(merge(address, address)).rejects.toMatchObject({
      refusal: { kind: 'same_address' },
    });
  });

  it('refuses a row that already lost a merge still in force', async () => {
    const survivor = await makeAddress('Carrer de Villarroel', '2');
    const loser = await makeAddress('Carrer de Vilarroel', '2');
    const third = await makeAddress('Carrer de Villaroel', '2');
    await merge(survivor, loser);

    await expect(merge(third, loser)).rejects.toMatchObject({
      refusal: { kind: 'already_merged' },
    });
  });

  it('refuses a merge that would close a redirect cycle', async () => {
    const first = await makeAddress('Carrer de Calàbria', '4');
    const second = await makeAddress('Carrer de Calabria', '4');
    await merge(first, second);
    // `second` now redirects to `first`. Merging `first` INTO `second` would
    // make the pair unreachable from either end — a two-row cycle that a
    // self-referencing foreign key and the table's own CHECK cannot see.
    await expect(merge(second, first)).rejects.toBeInstanceOf(AddressMergeRefusedError);
  });

  it('refuses to merge into an address that does not exist', async () => {
    const loser = await makeAddress('Carrer de Rocafort', '6');
    await expect(merge(`missing-${SUITE}`, loser)).rejects.toMatchObject({
      refusal: { kind: 'address_not_found' },
    });
  });
});

describe('the database refuses to delete a merged address', () => {
  it('will not delete the loser while a merge names it', async () => {
    // The issue's mandatory mutation: "una mutación que borre source antes de
    // mover FKs debe fallar". It is enforced by the database rather than by this
    // service, which is the strongest place for it — ten of the twelve columns
    // that can point at an address are ON DELETE RESTRICT, and the merge audit
    // adds two more.
    const survivor = await makeAddress('Carrer de Viladomat', '8');
    const loser = await makeAddress('Carrer de Viladomad', '8');
    await makeProperty(loser);
    await merge(survivor, loser);

    await expect(
      db.execute(sql`delete from addresses where id = ${loser}`),
    ).rejects.toBeDefined();

    // Still there, which is the property that makes the merge reversible.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(addresses)
      .where(eq(addresses.id, loser));
    expect(Number(count)).toBe(1);
  });
});

describe('the shared test cleanup can still reset the schema', () => {
  it('deletes an address that lost a merge', async () => {
    // A GATE on the fixture helper rather than on production code, and it earns
    // its place: `address_merges` points at both addresses with ON DELETE
    // RESTRICT, so a `resetGeoTables` that does not delete merges first fails —
    // and it fails in whichever OTHER suite happens to share the worker database
    // next, as a foreign-key error on a table that suite never touched. Measured
    // while writing this: 337 failures across 27 suites, none of them here.
    //
    // Rather than reset the whole schema (which would take the fixtures every
    // other case in this file depends on), this asserts the property that
    // matters: once the merge audit is gone, the address can be deleted.
    const survivor = await makeAddress('Carrer de Sepúlveda', '9');
    const loser = await makeAddress('Carrer de Sepulveda', '9');
    const applied = await merge(survivor, loser);

    await db.delete(addressMerges).where(eq(addressMerges.id, applied.mergeId));
    await expect(
      db.delete(addresses).where(eq(addresses.id, loser)),
    ).resolves.toBeDefined();
  });
});

describe('the registry is the authority on what moves', () => {
  it('lists every movable relation exactly once', () => {
    const movable = movableAddressRelations().map((r) => `${r.table}.${r.column}`);
    expect(movable.length).toBe(new Set(movable).size);
  });

  it('gives every relation a disposition', () => {
    // The C0 discipline: being in NEITHER bucket must fail. `addressRelations()`
    // throws rather than skipping, so this case is the one that reports it.
    expect(() => addressRelations()).not.toThrow();
    for (const relation of addressRelations()) {
      expect(['move', 'keep', 'audit']).toContain(relation.disposition);
    }
  });
});
