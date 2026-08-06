/**
 * `addresses.geo` and `addresses.address_level`, asserted against REAL ROWS.
 *
 * The point of this file is the ORDERING check. `ST_MakePoint` takes
 * `(longitude, latitude)` and Mongo stored `coordinates: [lng, lat]` — a
 * POSITIONAL pair a `2dsphere` index reads by index — so a transposed pair is
 * the single most likely thing to get wrong here. And it does not look wrong: a
 * lat/lon swap yields a perfectly valid point in a plausible-looking place.
 *
 * So every spatial assertion below is anchored to an INDEPENDENTLY CHECKABLE
 * real-world distance. Barcelona to Madrid is ~505 km; measured against this
 * schema it reads 506,300 m. The TRANSPOSED pair reads 658,262 m — also
 * measured, not estimated — which is why the tolerance is 20 km: wide enough
 * that geodesy is not on trial, narrow enough that the transposition cannot
 * squeeze through. A test asserting only "a row came back" passes against
 * exactly the bug this file exists to catch.
 */

import { eq, sql } from 'drizzle-orm';
import { GENERATED_ALWAYS, sqlStateOf, uuidv7 } from '@oxyhq/db';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { addresses, cities, countries, regions } from '../../db/schema';

/** Barcelona city centre. */
const BARCELONA = { latitude: 41.3874, longitude: 2.1686 };
/** Madrid city centre. */
const MADRID = { latitude: 40.4168, longitude: -3.7038 };
/** The real great-circle distance between them, in metres (~505 km). */
const BARCELONA_TO_MADRID_METRES = 505_000;
/**
 * Tolerance on that figure. Generous — it is guarding an ORDERING bug, not
 * geodesy — but far tighter than the 153 km error a transposition introduces.
 */
const DISTANCE_TOLERANCE_METRES = 20_000;

let db: Database;
/** Ids created by this file, torn down in reverse dependency order. */
let cityId: string;
let regionId: string;
let countryId: string;
const createdAddressIds: string[] = [];

async function insertAddressAt(
  coordinates: { latitude: number; longitude: number },
  fields: Partial<Record<'number' | 'floor' | 'unit' | 'subunit' | 'buildingName', string>> = {},
): Promise<string> {
  const [row] = await db
    .insert(addresses)
    .values({
      countryId,
      regionId,
      cityId,
      countryCode: 'ES',
      street: 'Carrer de Mallorca',
      postalCode: '08013',
      longitude: coordinates.longitude,
      latitude: coordinates.latitude,
      ...fields,
    })
    .returning({ id: addresses.id });
  if (!row) throw new Error('insert returned no row');
  createdAddressIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  db = await connectPostgres();

  // Unique per run: `countries.code` is UNIQUE and test FILES in one worker
  // share a database, so a fixed `ES` would collide with a sibling file. The
  // whole suffix is used rather than a two-character slice — sixteen possible
  // values would collide often enough to make this file flaky, and the ISO-2
  // format validator is deliberately NOT a CHECK yet (see CONVENTIONS.md), so a
  // longer code is accepted here.
  const suffix = uuidv7().replace(/-/g, '').slice(0, 16);
  const [country] = await db
    .insert(countries)
    .values({ code: `TEST-${suffix}`, name: `Spain ${suffix}` })
    .returning({ id: countries.id });
  countryId = country.id;
  const [region] = await db
    .insert(regions)
    .values({ countryId, name: `Catalonia ${suffix}` })
    .returning({ id: regions.id });
  regionId = region.id;
  const [city] = await db
    .insert(cities)
    .values({ name: `Barcelona ${suffix}`, countryId, regionId })
    .returning({ id: cities.id });
  cityId = city.id;
});

afterEach(async () => {
  while (createdAddressIds.length > 0) {
    const id = createdAddressIds.pop();
    if (id) await db.delete(addresses).where(eq(addresses.id, id));
  }
});

afterAll(async () => {
  await db.delete(cities).where(eq(cities.id, cityId));
  await db.delete(regions).where(eq(regions.id, regionId));
  await db.delete(countries).where(eq(countries.id, countryId));
  await closePostgres();
});

describe('addresses.geo', () => {
  it('is a SRID 4326 point built as (longitude, latitude)', async () => {
    const id = await insertAddressAt(BARCELONA);

    const rows = await db.execute<{
      srid: number;
      geometry_type: string;
      longitude: number;
      latitude: number;
    }>(sql`
      select
        ST_SRID(geo) as srid,
        GeometryType(geo::geometry) as geometry_type,
        ST_X(geo::geometry) as longitude,
        ST_Y(geo::geometry) as latitude
      from addresses
      where id = ${id}
    `);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.srid).toBe(4326);
    expect(row.geometry_type).toBe('POINT');
    // The ordering assertion: X is the LONGITUDE and Y is the LATITUDE. A
    // transposed pair would put X at 41.38 and Y at 2.16 and still be a valid
    // point at a real place.
    expect(row.longitude).toBeCloseTo(BARCELONA.longitude, 6);
    expect(row.latitude).toBeCloseTo(BARCELONA.latitude, 6);
  });

  it('measures a real-world distance correctly, which a lat/lon swap cannot', async () => {
    const barcelona = await insertAddressAt(BARCELONA);
    const madrid = await insertAddressAt(MADRID);

    const rows = await db.execute<{ metres: number }>(sql`
      select ST_Distance(a.geo, b.geo) as metres
      from addresses a, addresses b
      where a.id = ${barcelona} and b.id = ${madrid}
    `);

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].metres)).toBeGreaterThan(
      BARCELONA_TO_MADRID_METRES - DISTANCE_TOLERANCE_METRES,
    );
    expect(Number(rows[0].metres)).toBeLessThan(
      BARCELONA_TO_MADRID_METRES + DISTANCE_TOLERANCE_METRES,
    );
  });

  it('cannot be written directly', async () => {
    // This is what makes a coordinate-ordering divergence UNREPRESENTABLE rather
    // than merely discouraged: there is no write path — route, service, backfill
    // or psql — that can produce a row whose point disagrees with its columns.
    let caught: unknown;
    try {
      await db.execute(sql`
        insert into addresses (
          id, country_id, region_id, city_id, country_code, street, postal_code,
          longitude, latitude, geo
        ) values (
          ${uuidv7()}, ${countryId}, ${regionId}, ${cityId}, 'ES', 'x', '1',
          0, 0, ST_MakePoint(0, 0)::geography
        )
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(GENERATED_ALWAYS);
  });

  it('is backed by a GiST index', async () => {
    const rows = await db.execute<{ indexname: string }>(sql`
      select i.relname as indexname
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_am am on am.oid = i.relam
      where t.relname = 'addresses' and am.amname = 'gist'
      order by 1
    `);
    expect(rows.map((row) => row.indexname)).toEqual(['addresses_geo_gist']);
  });

  it('refuses an out-of-range coordinate rather than silently relocating it', async () => {
    // PostGIS does NOT reject this on its own — measured, not assumed:
    //   select ST_AsText(ST_MakePoint(0, 100)::geography);
    //   NOTICE: Coordinate values were coerced into range …
    //   POINT(0 80)
    // A NOTICE, a successful insert, and latitude 100 stored as 80 — wrapped
    // over the pole into a different, entirely plausible place. Mongo's
    // validator rejected it, so the CHECK constraint is what keeps that
    // behaviour rather than degrading it into a silently mislocated listing.
    await expect(insertAddressAt({ latitude: 100, longitude: 0 })).rejects.toThrow();
  });
});

describe('addresses.address_level', () => {
  it('derives STREET, BUILDING and UNIT from the identifying fields', async () => {
    const street = await insertAddressAt(BARCELONA);
    const building = await insertAddressAt(BARCELONA, { number: '401' });
    const unit = await insertAddressAt(BARCELONA, { number: '401', floor: '3' });

    const rows = await db.execute<{ id: string; address_level: string }>(sql`
      select id, address_level from addresses
      where id in (${street}, ${building}, ${unit})
    `);
    const levels = new Map(rows.map((row) => [row.id, row.address_level]));

    expect(levels.get(street)).toBe('STREET');
    expect(levels.get(building)).toBe('BUILDING');
    expect(levels.get(unit)).toBe('UNIT');
  });

  it('treats an EMPTY STRING as absent, the way the Mongo method did', async () => {
    // The fixture that makes the strict and loose readings disagree, and the
    // only one that does. `getAddressLevel()` tested `if (this.floor || ...)`,
    // so `floor: ''` was ABSENT — while `floor is not null` would call it
    // present and promote this row to UNIT. Without a row in exactly this shape,
    // both spellings pass every other case in this file.
    const id = await insertAddressAt(BARCELONA, { number: '', floor: '', unit: '' });

    const rows = await db.execute<{ address_level: string }>(
      sql`select address_level from addresses where id = ${id}`,
    );
    expect(rows[0].address_level).toBe('STREET');
  });

  it('cannot be written directly', async () => {
    let caught: unknown;
    try {
      await db.execute(sql`
        insert into addresses (
          id, country_id, region_id, city_id, country_code, street, postal_code,
          longitude, latitude, address_level
        ) values (
          ${uuidv7()}, ${countryId}, ${regionId}, ${cityId}, 'ES', 'x', '1',
          0, 0, 'UNIT'
        )
      `);
    } catch (error) {
      caught = error;
    }
    expect(sqlStateOf(caught)).toBe(GENERATED_ALWAYS);
  });
});
