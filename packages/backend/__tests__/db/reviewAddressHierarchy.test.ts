/**
 * `resolveAddressHierarchy`, against a REAL Postgres server.
 *
 * This is the landing of `AddressSchema`'s `createStreetLevel()` /
 * `createBuildingLevel()`, and it does NOT reproduce them — it fixes them. The
 * defect and its user-visible consequence are in the function's own docblock;
 * this file is the evidence.
 *
 * A real server is not optional here: `addresses.address_level` is a GENERATED
 * column, so the assertion that a projected parent really IS at the level it was
 * projected onto is a fact about the row Postgres computed, not about the object
 * this code passed in.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';

import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  findOrCreateCanonicalAddress,
  resolveAddressHierarchy,
} from '../../services/addressService';
import { addresses } from '../../db/schema';

let db: Database;

/**
 * A canonical address, resolved offline.
 *
 * Every field the geocoder would supply is present (city + state + countryCode
 * plus coordinates), so `resolveGeoChain` short-circuits and no network call is
 * made — the same arrangement the review integration suite relies on.
 */
async function canonicalAddress(input: {
  street: string;
  number?: string;
  floor?: string;
  unit?: string;
}) {
  return findOrCreateCanonicalAddress({
    street: input.street,
    number: input.number,
    floor: input.floor,
    unit: input.unit,
    postal_code: '08013',
    city: `Hierarchyville ${SUITE}`,
    state: 'Catalonia',
    country: 'Spain',
    countryCode: 'ES',
    coordinates: { type: 'Point', coordinates: [2.17, 41.39] },
  });
}

/** One city per run, so a rerun cannot meet its own previous addresses. */
const SUITE = uuidv7();

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

async function levelOf(addressId: string): Promise<string | null> {
  const [row] = await db
    .select({ addressLevel: addresses.addressLevel })
    .from(addresses)
    .where(eq(addresses.id, addressId));
  return row?.addressLevel ?? null;
}

describe('a UNIT address resolves a real building and a real street', () => {
  /**
   * THE regression, and the reason this is a fix rather than a port.
   *
   * `Address.findOne(address.createBuildingLevel())` matched the unit row
   * ITSELF, because a Mongo filter constrains only the fields it names and the
   * building projection is a strict subset of a unit address's own fields. So
   * `buildingLevelId` came back as the review's own `addressId`, and two flats
   * in one building never shared a building id.
   *
   * The fixture is two DIFFERENT flats at one street number: under the old
   * behaviour their building ids differ (each is its own id), under the fixed
   * behaviour they are the same row. One flat alone cannot tell those apart.
   */
  it('gives two flats in one building the SAME building id', async () => {
    const street = `Carrer Hierarchy ${uuidv7()}`;
    const flatA = await canonicalAddress({ street, number: '42', unit: '1a' });
    const flatB = await canonicalAddress({ street, number: '42', unit: '2b' });

    expect(flatA.addressLevel).toBe('UNIT');
    expect(flatB.addressLevel).toBe('UNIT');
    expect(flatA.id).not.toBe(flatB.id);

    const a = await resolveAddressHierarchy(flatA);
    const b = await resolveAddressHierarchy(flatB);

    expect(a.buildingLevelId).toBe(b.buildingLevelId);
    expect(a.streetLevelId).toBe(b.streetLevelId);
    // And the building is NOT either flat — the bug's signature.
    expect(a.buildingLevelId).not.toBe(flatA.id);
    expect(a.buildingLevelId).not.toBe(flatB.id);
    expect(a.unitLevelId).toBe(flatA.id);
    expect(b.unitLevelId).toBe(flatB.id);
  });

  /**
   * The parent rows are at the LEVEL they were projected onto, and that is
   * asserted against the generated column rather than against the values passed
   * in — a projection that forgot to drop `floor` would still look right in
   * JavaScript.
   */
  it('creates parents whose generated address_level matches the projection', async () => {
    const street = `Carrer Levels ${uuidv7()}`;
    const flat = await canonicalAddress({ street, number: '7', unit: '3c' });
    const hierarchy = await resolveAddressHierarchy(flat);

    expect(await levelOf(hierarchy.buildingLevelId)).toBe('BUILDING');
    expect(await levelOf(hierarchy.streetLevelId)).toBe('STREET');
  });

  it('is idempotent — a second flat creates no second building', async () => {
    const street = `Carrer Idempotent ${uuidv7()}`;
    const flat = await canonicalAddress({ street, number: '9', unit: 'a' });

    const first = await resolveAddressHierarchy(flat);
    const second = await resolveAddressHierarchy(flat);

    expect(second.buildingLevelId).toBe(first.buildingLevelId);
    expect(second.streetLevelId).toBe(first.streetLevelId);

    const buildings = await db
      .select({ id: addresses.id })
      .from(addresses)
      .where(eq(addresses.street, street));
    // street + building + unit, and nothing else.
    expect(buildings).toHaveLength(3);
  });
});

describe('a BUILDING address is its own building', () => {
  it('resolves only a street above it and names no unit', async () => {
    const street = `Carrer Building ${uuidv7()}`;
    const building = await canonicalAddress({ street, number: '11' });
    expect(building.addressLevel).toBe('BUILDING');

    const hierarchy = await resolveAddressHierarchy(building);
    expect(hierarchy.buildingLevelId).toBe(building.id);
    expect(hierarchy.unitLevelId).toBeNull();
    expect(hierarchy.streetLevelId).not.toBe(building.id);
    expect(await levelOf(hierarchy.streetLevelId)).toBe('STREET');
  });

  it('shares one street row with the flats above it', async () => {
    const street = `Carrer Shared ${uuidv7()}`;
    const building = await canonicalAddress({ street, number: '13' });
    const flat = await canonicalAddress({ street, number: '13', unit: '4d' });

    const fromBuilding = await resolveAddressHierarchy(building);
    const fromFlat = await resolveAddressHierarchy(flat);

    expect(fromFlat.streetLevelId).toBe(fromBuilding.streetLevelId);
    expect(fromFlat.buildingLevelId).toBe(building.id);
  });
});

describe('the degenerate case the dedup key creates', () => {
  /**
   * A flat identified only by its FLOOR shares one canonical row with its own
   * building, and this is a property of the data rather than of this code.
   *
   * `computeAddressNormalizedKey` hashes `unit` and NOT `floor`, `entrance` or
   * `subunit`, and the key is copied VERBATIM by the backfill — so it cannot be
   * changed here. The honest answer is therefore `buildingLevelId === addressId`
   * rather than a second row carrying the same key, which the partial unique
   * index would refuse outright.
   *
   * Recorded as a test because it looks like a bug when first encountered, and
   * because a future change to the key would flip this assertion and should.
   */
  it('resolves a floor-only flat onto its own row, not a duplicate', async () => {
    const street = `Carrer FloorOnly ${uuidv7()}`;
    const flat = await canonicalAddress({ street, number: '17', floor: '3' });
    expect(flat.addressLevel).toBe('UNIT');

    const hierarchy = await resolveAddressHierarchy(flat);
    expect(hierarchy.unitLevelId).toBe(flat.id);
    expect(hierarchy.buildingLevelId).toBe(flat.id);
    // The street above it is still a genuine, separate row.
    expect(hierarchy.streetLevelId).not.toBe(flat.id);
    expect(await levelOf(hierarchy.streetLevelId)).toBe('STREET');
  });
});
