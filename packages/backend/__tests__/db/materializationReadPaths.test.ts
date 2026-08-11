/**
 * **An autocomplete query must never create a permanent row.**
 *
 * This is the rule #360 exists to make true, and it is the one that cannot be
 * stated as a type: a read path does not fail to compile if it starts writing,
 * it just quietly starts minting identities for every keystroke a user types.
 * So it is asserted two ways, and the two fail in different directions on
 * purpose.
 *
 * ## 1. Behavioural — the read paths are RUN and measured
 *
 * The address typeahead, the nearby-address lookup and the city place lookup are
 * exercised against a real database, and `addresses`, `address_candidates` and
 * `address_materializations` are counted before and after.
 *
 * A "nothing was created" assertion is exactly the shape that passes when the
 * check is broken, so it carries both defences the ecosystem's own rules ask
 * for:
 *
 *  - a **POSITIVE CONTROL across time**: the same counters are measured around a
 *    real materialization in the same test, and must MOVE. Without it, a census
 *    that counted the wrong table, or a read path that threw and was swallowed,
 *    would report a clean pass.
 *  - a **vacuity floor**: each read path must actually return rows. A typeahead
 *    that matched nothing writes nothing, and would satisfy the assertion while
 *    measuring nothing at all.
 *
 * ## 2. Structural — the database refuses an action that names a read
 *
 * `address_materializations.durable_action` is NOT NULL with a CHECK over the
 * six durable actions #360 lists, and there is deliberately no member meaning
 * "a search", "a preview" or "an autocomplete". That is asserted against the
 * REAL constraint rather than against the TypeScript tuple it was generated
 * from: the tuple is a value a future edit could widen in one line, while the
 * CHECK is in migration `0014` and applies to every writer of that table,
 * including raw SQL and anything that bypasses this repository entirely.
 */

import { eq, sql } from 'drizzle-orm';
import { constraintNameOf, uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  addressCandidates,
  addressMaterializations,
  addresses,
  cities,
} from '../../db/schema';
import {
  nearestAddressesQuery,
  selectAddressWithGeoNames,
} from '../../services/addressService';
import { lookupCityPlaces } from '../../db/geo/placeLookup';
import { escapeLikePattern } from '../../db/likePattern';
import { materializeHousingCandidate } from '../../services/housingMaterialization';

let db: Database;

const SUITE = uuidv7().slice(-12);
const CITY = `Readpathville ${SUITE}`;
const STREET = 'Carrer de la Lectura';
const BASE_POINT = { longitude: 2.17, latitude: 41.39 };

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

interface Counts {
  readonly addresses: number;
  readonly candidates: number;
  readonly materializations: number;
}

/**
 * The three tables a materialization touches.
 *
 * Counted WHOLE rather than scoped to this suite's city, because the question is
 * "did a read path create anything at all", and scoping it would hide a read
 * path that created a row somewhere unexpected — which is precisely the shape of
 * the bug.
 */
async function counts(): Promise<Counts> {
  const [row] = await db.execute<{ a: string; c: string; m: string }>(sql`
    select
      (select count(*) from addresses) as a,
      (select count(*) from address_candidates) as c,
      (select count(*) from address_materializations) as m
  `);
  // postgres.js decodes `count(*)` (a bigint) as a STRING, and drizzle types it
  // as whatever the annotation says — so `a + 1` would be string concatenation.
  // Coerced explicitly at the boundary.
  return {
    addresses: Number(row.a),
    candidates: Number(row.c),
    materializations: Number(row.m),
  };
}

/** Seed one real place, so every read path below has something to find. */
async function seedPlace(): Promise<string> {
  const result = await materializeHousingCandidate(
    {
      candidate: {
        provider: 'osm',
        rawText: `${STREET} 1`,
        origin: 'geocoder',
        precision: 'exact',
        longitude: BASE_POINT.longitude,
        latitude: BASE_POINT.latitude,
        proposedCity: CITY,
        proposedRegion: 'Catalonia',
        proposedCountry: 'Spain',
        proposedCountryCode: 'ES',
        proposedStreet: STREET,
        proposedPostalCode: '08013',
        proposedNumber: '1',
      },
    },
    { action: 'listing_upsert', actorOxyUserId: `oxy-${SUITE}` },
  );
  if (result.status !== 'materialized') {
    throw new Error(`seed failed: ${result.status} ${JSON.stringify(result)}`);
  }
  return result.addressId;
}

describe('a read path cannot create a permanent row', () => {
  it('leaves every materialization table untouched, while a real write moves them', async () => {
    await seedPlace();

    const before = await counts();

    // ── The address typeahead: `addressController.searchAddresses`'s query. ──
    const typeahead = await selectAddressWithGeoNames({
      where: sql`${addresses.street} ilike ${`%${escapeLikePattern('lectura')}%`}`,
      limit: 10,
    });

    // ── The nearby lookup: `addressController.getNearbyAddresses`. ──
    const near = nearestAddressesQuery({
      longitude: BASE_POINT.longitude,
      latitude: BASE_POINT.latitude,
      radiusMeters: 5000,
    });
    const nearby = await selectAddressWithGeoNames({
      where: near.where,
      orderBy: near.orderBy,
      limit: 10,
    });

    // ── The place lookup behind city autocomplete. ──
    const places = await lookupCityPlaces({ token: CITY, countryCode: 'ES' });

    const after = await counts();

    // The assertion this file exists for.
    expect(after).toEqual(before);

    // VACUITY FLOOR. A read that matched nothing writes nothing, and would
    // satisfy the assertion above while measuring nothing at all.
    expect(typeahead.length).toBeGreaterThan(0);
    expect(nearby.length).toBeGreaterThan(0);
    expect(places.status).not.toBe('not_found');

    // POSITIVE CONTROL, measured across the change rather than beside it: the
    // same counters, around a real durable action, must MOVE. Without this a
    // census counting the wrong tables would report a clean pass forever.
    const control = await materializeHousingCandidate(
      {
        candidate: {
          provider: 'osm',
          rawText: `${STREET} 2`,
          origin: 'geocoder',
          precision: 'exact',
          longitude: BASE_POINT.longitude,
          latitude: BASE_POINT.latitude,
          proposedCity: CITY,
          proposedRegion: 'Catalonia',
          proposedCountry: 'Spain',
          proposedCountryCode: 'ES',
          proposedStreet: STREET,
          proposedPostalCode: '08013',
          proposedNumber: '2',
        },
      },
      { action: 'review', actorOxyUserId: `oxy-${SUITE}` },
    );
    expect(control.status).toBe('materialized');

    const afterWrite = await counts();
    expect(afterWrite.addresses).toBeGreaterThan(after.addresses);
    expect(afterWrite.candidates).toBeGreaterThan(after.candidates);
    expect(afterWrite.materializations).toBeGreaterThan(after.materializations);
  });

  it('records a candidate for a rejected materialization without creating an address', async () => {
    // The one thing a read-ish path IS allowed to do: record a candidate. This
    // pins the boundary from the other side — a candidate is cheap, internal and
    // expiring, and recording one must not mint an identity.
    const before = await counts();
    const rejected = await materializeHousingCandidate(
      {
        candidate: {
          provider: 'osm',
          rawText: 'somewhere in this city',
          origin: 'autocomplete_selection',
          // A city centroid, which is what 94-100% of habitaclia and fotocasa
          // listings carry.
          precision: 'centroid',
          longitude: BASE_POINT.longitude,
          latitude: BASE_POINT.latitude,
          proposedCity: CITY,
          proposedRegion: 'Catalonia',
          proposedCountry: 'Spain',
          proposedCountryCode: 'ES',
          proposedStreet: STREET,
          proposedNumber: '99',
        },
      },
      { action: 'listing_upsert' },
    );
    expect(rejected.status).toBe('rejected');

    const after = await counts();
    expect(after.candidates).toBe(before.candidates + 1);
    expect(after.addresses).toBe(before.addresses);
    expect(after.materializations).toBe(before.materializations);
  });
});

describe('the database itself refuses an action that names a read', () => {
  it('rejects `autocomplete` as a durable action, naming the constraint', async () => {
    // Asserted against the REAL CHECK from migration 0014, not against the
    // TypeScript tuple it was generated from: the tuple is a value one edit
    // could widen, while the constraint binds every writer of the table,
    // including raw SQL and anything bypassing this repository.
    const [address] = await db
      .select({ id: addresses.id })
      .from(addresses)
      .innerJoin(cities, eq(addresses.cityId, cities.id))
      .where(eq(cities.name, CITY))
      .limit(1);
    expect(address).toBeDefined();

    let caught: unknown;
    try {
      await db.execute(sql`
        insert into address_materializations (
          id, address_id, candidate_id, provider, raw_text, raw_text_hash,
          normalization_version, match_kind, durable_action
        ) values (
          ${uuidv7()}, ${address.id}, ${uuidv7()}, 'osm', 'typed', 'hash',
          2, 'created', 'autocomplete'
        )
      `);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    // Through `constraintNameOf`, never `error.code`: drizzle WRAPS the driver
    // error, so the SQLSTATE lives on `cause` and a check written against the
    // driver's own documented shape answers `undefined` for every real
    // violation.
    expect(constraintNameOf(caught)).toBe('address_materializations_durable_action_check');

    // NEGATIVE CONTROL for the assertion above: a value that IS in the closed
    // set inserts cleanly, so "the constraint refused it" is distinguishable
    // from "this insert was malformed for some unrelated reason".
    const [candidate] = await db
      .select({ id: addressCandidates.id })
      .from(addressCandidates)
      .limit(1);
    const okId = uuidv7();
    await db.execute(sql`
      insert into address_materializations (
        id, address_id, candidate_id, provider, raw_text, raw_text_hash,
        normalization_version, match_kind, durable_action
      ) values (
        ${okId}, ${address.id}, ${candidate.id}, 'osm', 'typed', 'hash',
        2, 'created', 'follow_dwelling'
      )
    `);
    const [written] = await db
      .select({ action: addressMaterializations.durableAction })
      .from(addressMaterializations)
      .where(eq(addressMaterializations.id, okId));
    expect(written.action).toBe('follow_dwelling');
  });
});
