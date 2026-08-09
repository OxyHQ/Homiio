/**
 * The data backfill, against a real Mongo and a real Postgres.
 *
 * Both stores are genuine — the in-memory replica set `jest.setup.ts` starts,
 * and this worker's own throwaway, fully-migrated Postgres database — and the
 * end-to-end cases drive `runDataBackfill`, the SAME function the production
 * one-shot calls. That is the point: the properties under test are a real
 * `ON CONFLICT DO NOTHING`, real foreign keys, real CHECKs, a real GENERATED
 * PostGIS column and a real `$in`. A mocked `insert` accepts any statement,
 * including one the server rejects outright.
 *
 * The end-to-end cases run the GEO copy first, because that is the real
 * ordering: `addresses.city_id` is `NOT NULL` with `ON DELETE RESTRICT`, so the
 * geo hierarchy has to exist before an address can. Seeding Postgres directly
 * instead would test a state production never passes through.
 */

import mongoose from 'mongoose';
import { eq, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import {
  addresses,
  agencies,
  cities,
  profiles,
  properties,
  propertyAvailabilityWindows,
  propertyImages,
} from '../../db/schema';
import { runGeoBackfill } from '../../db/backfill/geo';
import {
  checkGeometry,
  linkCoverImages,
  readOnly,
  runDataBackfill,
} from '../../db/backfill/data';
import {
  DATA_COPY_ORDER,
  DATA_PLANS,
  DATA_RESOLUTIONS,
  deterministicUuidV7,
  toAddressRow,
  toAgencyRow,
  toProfileChatMessageRows,
  toProfileRow,
  toPropertyImageRows,
  toPropertyRow,
  toPropertyWindowRows,
} from '../../db/backfill/dataPlan';
import { RowAuditor, UniqueKeyAuditor, type CandidateRow } from '../../db/backfill/rowAudit';
import { isLiveEntityId, uuidv7 } from '@oxyhq/db';
import { ResolutionLog } from '../../db/backfill/geoPlan';

/** The property rules, reached through the PLAN so the test cannot drift from it. */
const PROPERTY_RULES = DATA_PLANS.properties.rules.properties ?? [];

const oid = () => new mongoose.Types.ObjectId();

/** The Mongo handle `jest.setup.ts` connected, narrowed once. */
function mongoDatabase() {
  const database = mongoose.connection.db;
  if (!database) throw new Error('The test Mongo connection published no database handle.');
  return database;
}

// ── fixtures ───────────────────────────────────────────────────────
//
// Real coordinates, because the geometry check measures a real distance. A
// fixture at (0,0) would pass "the column is populated" and prove nothing about
// the one bug that column exists to make impossible.

const BARCELONA = { lng: 2.1686, lat: 41.3985 };
const MADRID = { lng: -3.7038, lat: 40.4168 };
const BERLIN = { lng: 13.4050, lat: 52.5200 };
const WARSZAWA = { lng: 21.0122, lat: 52.2297 };

interface GeoFixture {
  readonly countryId: mongoose.Types.ObjectId;
  readonly regionId: mongoose.Types.ObjectId;
  readonly cityIds: Readonly<Record<string, mongoose.Types.ObjectId>>;
}

/** Countries / regions / cities for the three cities the distance check names. */
async function seedGeo(): Promise<GeoFixture> {
  const database = mongoDatabase();
  const countryId = oid();
  const regionId = oid();
  const cityIds: Record<string, mongoose.Types.ObjectId> = {
    Barcelona: oid(),
    Madrid: oid(),
    Berlin: oid(),
    Warszawa: oid(),
  };

  await database.collection('countries').insertOne({
    _id: countryId,
    code: 'ES',
    name: 'Spain',
    currency: 'EUR',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  await database.collection('regions').insertOne({
    _id: regionId,
    countryId,
    name: 'Catalonia',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });
  for (const [name, id] of Object.entries(cityIds)) {
    const point =
      name === 'Barcelona' ? BARCELONA
      : name === 'Madrid' ? MADRID
      : name === 'Berlin' ? BERLIN
      : WARSZAWA;
    await database.collection('cities').insertOne({
      _id: id,
      name,
      countryId,
      regionId,
      coordinates: { lat: point.lat, lng: point.lng },
      currency: 'EUR',
      isActive: true,
      propertiesCount: 0,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  }
  await database.collection('neighborhoods').insertOne({
    _id: oid(),
    cityId: cityIds.Barcelona,
    name: 'Gràcia',
    bbox: [],
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  });

  return { countryId, regionId, cityIds };
}

function imageDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: oid(),
    entityType: 'property',
    entityId: oid(),
    // Distinct per variant on purpose: four copies of one string cannot tell a
    // correct flattening from one that writes `small` into `large`.
    keys: { original: 'k/o', small: 'k/s', medium: 'k/m', large: 'k/l' },
    urls: { original: 'u/o', small: 'u/s', medium: 'u/m', large: 'u/l' },
    width: 1200,
    height: 800,
    format: 'jpeg',
    bytes: 45678,
    isPrimary: false,
    order: 0,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    ...overrides,
  };
}

function addressDocument(
  geo: GeoFixture,
  city: keyof GeoFixture['cityIds'],
  point: { lng: number; lat: number },
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: oid(),
    countryId: geo.countryId,
    regionId: geo.regionId,
    cityId: geo.cityIds[city],
    countryCode: 'ES',
    street: 'Carrer de Verdi',
    postal_code: '08012',
    number: '42',
    address_lines: [],
    land_plot: {},
    extras: { portal: 'idealista', floorRaw: '3º' },
    coordinates: { type: 'Point', coordinates: [point.lng, point.lat] },
    normalizedKey: `key-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-02T00:00:00.000Z'),
    ...overrides,
  };
}

function propertyDocument(
  addressId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: oid(),
    source: 'idealista',
    sourceId: `ext-${Math.random().toString(36).slice(2)}`,
    sourceUrl: 'https://www.idealista.com/inmueble/1/',
    isExternal: true,
    addressId,
    type: 'apartment',
    status: 'published',
    offerings: ['long_term_rent'],
    longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
    amenities: ['lift', 'balcony'],
    availability: { isAvailable: true, availableFrom: new Date('2026-04-01T00:00:00.000Z') },
    rules: { pets: false, smoking: false, parties: false, guests: true, maxOccupancy: 2 },
    rating: { average: 0, count: 0 },
    createdAt: new Date('2026-03-10T00:00:00.000Z'),
    updatedAt: new Date('2026-03-11T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Addresses in the cities the named distance pairs use.
 *
 * Verification requires at least two measurable real-world distances, so a
 * fixture with addresses in one city anchors nothing — and a pair that cannot be
 * measured is reported as such rather than counted as a pass. Madrid, Berlin and
 * Warszawa give Madrid→Berlin and Berlin→Warszawa.
 */
async function seedMeasurableAddresses(geo: GeoFixture): Promise<void> {
  await mongoDatabase().collection('addresses').insertMany([
    addressDocument(geo, 'Madrid', MADRID, { street: 'Gran Vía', postal_code: '28013' }),
    addressDocument(geo, 'Berlin', BERLIN, { street: 'Unter den Linden', postal_code: '10117', countryCode: 'DE' }),
    addressDocument(geo, 'Warszawa', WARSZAWA, { street: 'Nowy Świat', postal_code: '00-001', countryCode: 'PL' }),
  ]);
}

/** Seed a coherent source and copy the geo half, as production did. */
async function seedAndCopyGeo(): Promise<GeoFixture> {
  const geo = await seedGeo();
  await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy', sampleSize: 5 });
  return geo;
}

/** Every collection these fixtures write, cleared between cases. */
const SOURCE_COLLECTIONS = [
  'countries',
  'regions',
  'cities',
  'neighborhoods',
  'images',
  'addresses',
  'agencies',
  'properties',
  'profiles',
] as const;

/**
 * Empty BOTH stores, before every case AND after the last one.
 *
 * Neither is cleaned for us. `jest.setup.ts`'s `afterEach` walks
 * `mongoose.connection.collections`, which lists only collections mongoose knows
 * through a MODEL — these fixtures are written through the raw driver, so
 * mongoose has never heard of them and they survive. Postgres has no hook at
 * all.
 *
 * `beforeEach` protects THIS file: left to accumulate, every `seedGeo` adds
 * another country with code `ES`, `countries_code_key` absorbs it under
 * `ON CONFLICT DO NOTHING`, and its regions then dangle — a fair demonstration
 * of the hazard `UniqueKeyAuditor` exists for, and a useless thing to spend a
 * test run on.
 *
 * `afterEach` protects everyone ELSE, and it is not redundant: jest runs test
 * FILES sequentially in one worker against one database, so rows this file
 * leaves behind are rows the next file starts with. Without it `geoBackfill`
 * fails ten cases for reasons entirely inside this one — and only when the two
 * run together, which is the hardest kind of failure to attribute.
 *
 * `CASCADE` because the FK graph is the point of these tables; this is the
 * worker's OWN throwaway database, created and dropped by `db/testDatabase.ts`.
 */
async function emptyBothStores(): Promise<void> {
  await Promise.all(
    SOURCE_COLLECTIONS.map((name) => mongoDatabase().collection(name).deleteMany({})),
  );
  await getDb().execute(sql`
    truncate table
      property_availability_windows, property_documents, property_images, properties,
      profile_chat_messages, profile_roommate_history, profile_preferred_locations,
      profile_rental_history, profile_references, profiles,
      addresses, agencies, neighborhoods, cities, regions, countries, images
    cascade
  `);
}

beforeEach(emptyBothStores);
afterEach(emptyBothStores);

// ── argument guards ────────────────────────────────────────────────

describe('data backfill — argument guards', () => {
  it('defaults --only to every collection, in copy order', () => {
    expect(readOnly([])).toEqual([...DATA_COPY_ORDER]);
  });

  it('refuses an --only naming a collection that does not exist', () => {
    // A typo silently running nothing is a successful-looking no-op, which is
    // the failure the whole entrypoint is built against.
    expect(() => readOnly(['--only=propertys'])).toThrow(/propertys/);
    expect(readOnly(['--only=images,profiles'])).toEqual(['images', 'profiles']);
  });
});

// ── the mappers ────────────────────────────────────────────────────

describe('data backfill — the mappers', () => {
  const log = () => new ResolutionLog();

  it('carries an id verbatim, as the 24-char hex, minting nothing', () => {
    const id = oid();
    const row = toAgencyRow({ _id: id, name: 'Finques', normalizedName: 'finques', slug: 'finques' }, log());
    expect(row.id).toBe(id.toHexString());
  });

  it('splits the coordinate pair into NAMED columns, and does not transpose it', () => {
    const row = toAddressRow(
      { _id: oid(), coordinates: { type: 'Point', coordinates: [BARCELONA.lng, BARCELONA.lat] } },
      log(),
    );
    expect(row.longitude).toBe(BARCELONA.lng);
    expect(row.latitude).toBe(BARCELONA.lat);
  });

  it('PRESERVES a coordinate array of the wrong length instead of salvaging it', () => {
    // Salvaging a one-element array would silently produce a row at longitude 0
    // — a valid point in the Gulf of Guinea. The audit has to see the shape.
    const row = toAddressRow(
      { _id: oid(), coordinates: { type: 'Point', coordinates: [1] } },
      log(),
    );
    expect(row.longitude).toEqual([1]);
  });

  it('writes an empty normalizedKey as NULL, and counts it', () => {
    const resolutions = log();
    const row = toAddressRow({ _id: oid(), normalizedKey: '' }, resolutions);
    expect(row.normalizedKey).toBeNull();
    expect(resolutions.toRecord()[DATA_RESOLUTIONS.NORMALIZED_KEY_EMPTY]).toBe(1);
  });

  it('derives moderation_restricted = false when the sub-object is absent, and counts it', () => {
    const resolutions = log();
    const row = toPropertyRow(propertyDocument(oid()), resolutions);
    expect(row.moderationRestricted).toBe(false);
    expect(resolutions.toRecord()[DATA_RESOLUTIONS.MODERATION_ABSENT]).toBe(1);
  });

  it('leaves listingFlags NULL rather than false — they are THREE-state', () => {
    // `false` would manufacture a claim about 9,594 listings nobody made: the
    // classifier having looked and said no is not the same as it never running.
    const resolutions = log();
    const row = toPropertyRow(propertyDocument(oid()), resolutions);
    expect(row.listingFlagsStudentsOnly).toBeNull();
    expect(row.listingFlagsNoPets).toBeNull();
    expect(resolutions.toRecord()[DATA_RESOLUTIONS.LISTING_FLAGS_ABSENT]).toBe(1);
  });

  it('reads listingFlags.noDSS into listing_flags_no_dss', () => {
    const row = toPropertyRow(
      propertyDocument(oid(), { listingFlags: { noDSS: true, studentsOnly: false } }),
      log(),
    );
    expect(row.listingFlagsNoDss).toBe(true);
    expect(row.listingFlagsStudentsOnly).toBe(false);
  });

  it('counts a stored hasImages that disagrees with its own array', () => {
    const resolutions = log();
    toPropertyRow(propertyDocument(oid(), { hasImages: false, images: [{ _id: oid() }] }), resolutions);
    expect(resolutions.toRecord()[DATA_RESOLUTIONS.HAS_IMAGES_DISAGREED]).toBe(1);
  });

  it('never carries hasImages into the row — it is derived, not copied', () => {
    const row = toPropertyRow(propertyDocument(oid(), { hasImages: true }), log());
    expect(row).not.toHaveProperty('hasImages');
  });

  it('keeps an embedded image subdocument id, and mints one for a calendar window', () => {
    // `Property.images[]` is an implicit `{ _id: true }` subdocument;
    // `availabilityWindowSchema` declares `{ _id: false }`, so there is no id to
    // preserve and one is minted. Asking the DOCUMENT is what makes that right
    // without trusting a hand-written list of which arrays are which.
    const imageId = oid();
    const embeddedId = oid();
    const resolutions = log();
    const document = propertyDocument(oid(), {
      images: [{ _id: embeddedId, imageId, url: 'u/m', isPrimary: true, order: 0 }],
      availabilityWindows: [
        { start: new Date('2026-05-01T00:00:00.000Z'), end: new Date('2026-05-08T00:00:00.000Z'), status: 'available' },
      ],
    });

    const [image] = toPropertyImageRows(document, resolutions);
    expect(image.id).toBe(embeddedId.toHexString());
    expect(image.imageId).toBe(imageId.toHexString());

    const [window] = toPropertyWindowRows(document, resolutions);
    expect(window.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(window.scope).toBe('listing');
    expect(resolutions.toRecord()[DATA_RESOLUTIONS.SUBDOCUMENT_ID_MINTED]).toBe(1);
  });

  it('tags exchange windows with their own scope, in one table', () => {
    const document = propertyDocument(oid(), {
      offerings: ['exchange'],
      longTermRent: undefined,
      exchange: {
        mode: 'swap',
        availabilityWindows: [
          { start: new Date('2026-06-01T00:00:00.000Z'), end: new Date('2026-06-08T00:00:00.000Z'), status: 'available' },
        ],
      },
    });
    const rows = toPropertyWindowRows(document, log());
    expect(rows).toHaveLength(1);
    expect(rows[0].scope).toBe('exchange');
  });

  it('numbers chat messages by ARRAY INDEX, not by timestamp', () => {
    // `timestamp` defaults to `Date.now` at millisecond resolution, so two
    // messages appended in one tick sort arbitrarily. The index is the meaning.
    const sameInstant = new Date('2026-07-01T00:00:00.000Z');
    const rows = toProfileChatMessageRows(
      {
        _id: oid(),
        personalProfile: {
          chatHistory: [
            { _id: oid(), role: 'user', content: 'first', timestamp: sameInstant },
            { _id: oid(), role: 'assistant', content: 'second', timestamp: sameInstant },
          ],
        },
      },
      log(),
    );
    expect(rows.map((row) => [row.position, row.content])).toEqual([
      [0, 'first'],
      [1, 'second'],
    ]);
  });

  it('drops the personalProfile wrapper from every column name', () => {
    const row = toProfileRow(
      {
        _id: oid(),
        oxyUserId: 'oxy-1',
        personalProfile: {
          settings: { roommate: { preferences: { lifestyle: { cleanliness: 'very_clean' } } } },
        },
      },
      log(),
    );
    // 51 bytes. With the wrapper it would be 68, and Postgres truncates an
    // identifier at 63 SILENTLY.
    expect(row.settingsRoommatePreferencesLifestyleCleanliness).toBe('very_clean');
  });
});

describe('data backfill — minted subdocument ids are deterministic', () => {
  const log = () => new ResolutionLog();

  // `availabilityWindowSchema` declares `{ _id: false }`, so a calendar window
  // has no id to preserve. A RANDOM mint and `ON CONFLICT DO NOTHING` cannot
  // both hold: a fresh random key never conflicts, so a re-run would DUPLICATE
  // every window rather than skip it — in exactly the resumed-partial-run case
  // the idempotence rule exists for.
  const withWindows = (propertyId: mongoose.Types.ObjectId) =>
    propertyDocument(propertyId, {
      createdAt: new Date('2026-07-25T10:11:12.345Z'),
      availabilityWindows: [
        { start: new Date('2026-05-01'), end: new Date('2026-05-08'), status: 'available' },
        { start: new Date('2026-06-01'), end: new Date('2026-06-08'), status: 'blocked' },
      ],
    });

  it('produces the SAME id from the same document on every run', () => {
    const document = withWindows(oid());
    const first = toPropertyWindowRows(document, log()).map((row) => row.id);
    const second = toPropertyWindowRows(document, log()).map((row) => row.id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });

  it('separates the two calendars, which share a table and an index', () => {
    // `availabilityWindows[0]` and `exchange.availabilityWindows[0]` are
    // different rows; the PATH is in the natural key so they cannot collide.
    const document = propertyDocument(oid(), {
      offerings: ['long_term_rent', 'exchange'],
      availabilityWindows: [{ start: new Date('2026-05-01'), end: new Date('2026-05-08') }],
      exchange: {
        mode: 'swap',
        availabilityWindows: [{ start: new Date('2026-05-01'), end: new Date('2026-05-08') }],
      },
    });
    const ids = toPropertyWindowRows(document, log()).map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('mints an id the application would accept, checked against the REAL guard', () => {
    const ids = toPropertyWindowRows(withWindows(oid()), log()).map((row) => String(row.id));
    for (const id of ids) expect(isLiveEntityId(id)).toBe(true);
  });

  it("carries the parent's created_at in the timestamp prefix, so ids stay k-sortable", () => {
    const created = new Date('2026-07-25T10:11:12.345Z');
    const id = deterministicUuidV7(created, 'anything');
    const prefix = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
    expect(prefix).toBe(created.getTime());
  });

  it('falls back to the Unix epoch, NEVER to now, when the timestamp is unusable', () => {
    // `Date.now()` here would reintroduce the whole defect for exactly the rows
    // whose timestamps are broken — their ids would differ between two runs.
    const first = deterministicUuidV7(undefined, 'k');
    const second = deterministicUuidV7(new Date('nonsense'), 'k');
    expect(first).toBe(second);
    expect(Number.parseInt(first.replace(/-/g, '').slice(0, 12), 16)).toBe(0);
  });

  it('converges on a re-run rather than duplicating every window', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);
    await database.collection('properties').insertOne(
      withWindows(address._id as mongoose.Types.ObjectId),
    );

    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });
    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    const [row] = await getDb()
      .select({ total: sql<number>`count(*)::int` })
      .from(propertyAvailabilityWindows);
    // Two windows, copied twice. A random mint gives four.
    expect(row.total).toBe(2);
  }, 120_000);
});

describe('data backfill — --reconcile', () => {
  /** A copied source, then whatever the caller does to Mongo behind its back. */
  async function copyThenDrift(
    mutate: (database: ReturnType<typeof mongoDatabase>, ids: {
      readonly address: mongoose.Types.ObjectId;
      readonly properties: readonly mongoose.Types.ObjectId[];
    }) => Promise<void>,
    options: { readonly dryRun?: boolean } = {},
  ) {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);

    const listings = Array.from({ length: 10 }, () =>
      propertyDocument(address._id as mongoose.Types.ObjectId),
    );
    await database.collection('properties').insertMany(listings);
    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    await mutate(database, {
      address: address._id as mongoose.Types.ObjectId,
      properties: listings.map((listing) => listing._id as mongoose.Types.ObjectId),
    });

    return runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'reconcile',
      sampleSize: 5,
      dryRun: options.dryRun,
    });
  }

  const forTable = (report: Awaited<ReturnType<typeof copyThenDrift>>, table: string) =>
    report.reconciled.find((entry) => entry.table === table);

  it('removes a row the source deleted — the ghost listing the copy cannot fix', async () => {
    // Measured in production: 54 properties deleted from Mongo and still served
    // from Postgres, because `ON CONFLICT DO NOTHING` propagates neither an
    // update nor a deletion. A re-run of the copy is a no-op on both.
    const report = await copyThenDrift(async (database, ids) => {
      await database.collection('properties').deleteOne({ _id: ids.properties[0] });
    });

    expect(forTable(report, 'properties')?.deleted).toBe(1);
    const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(properties);
    expect(row.total).toBe(9);
  }, 120_000);

  it('propagates an UPDATE the copy would have skipped', async () => {
    const report = await copyThenDrift(async (database, ids) => {
      await database
        .collection('properties')
        .updateOne({ _id: ids.properties[0] }, { $set: { description: 'reconciled' } });
    });

    const properties_ = forTable(report, 'properties');
    expect(properties_?.updated).toBe(1);
    expect(properties_?.unchanged).toBe(9);
    expect(properties_?.columns.description).toBe(1);
  }, 120_000);

  it('REFUSES a total wipe, keeps every row, and FAILS the run', async () => {
    // An under-counting source query and a genuine mass deletion are
    // indistinguishable from inside the process, so the guard fails toward
    // KEEPING rows: ghosts for another hour beat destroying rows whose source is
    // gone. And it fails the RUN — the ghosts it declined to remove are still
    // being served, so an exit code of 0 would say otherwise.
    await expect(
      copyThenDrift(async (database) => {
        await database.collection('properties').deleteMany({});
      }),
    ).rejects.toThrow(/TOTAL wipe is\s+refused/);

    const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(properties);
    expect(row.total).toBe(10);
  }, 120_000);

  it('removes a CHILD row without touching children of parents it never looked at', async () => {
    // Child deletion is scoped to the parents in the chunk. Unscoped, it would
    // empty the table one chunk at a time.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);

    const photos = [imageDocument(), imageDocument(), imageDocument()];
    await database.collection('images').insertMany(photos);
    const listing = propertyDocument(address._id as mongoose.Types.ObjectId, {
      images: photos.map((photo, index) => ({
        _id: oid(),
        imageId: photo._id,
        url: 'u/m',
        isPrimary: index === 0,
        order: index,
      })),
    });
    const listingId = listing._id as mongoose.Types.ObjectId;
    await database.collection('properties').insertOne(listing);
    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    await database.collection('properties').updateOne({ _id: listingId }, { $pop: { images: 1 } });

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'reconcile',
      sampleSize: 5,
    });

    expect(forTable(report, 'property_images')?.deleted).toBe(1);
    const [row] = await getDb()
      .select({ total: sql<number>`count(*)::int` })
      .from(propertyImages);
    expect(row.total).toBe(2);
  }, 120_000);

  it('DRY RUN names every row it would remove, and removes none of them', async () => {
    // The point of the mode: an operator eyeballs 86 ids rather than discovering
    // 8,600 after the fact.
    const report = await copyThenDrift(
      async (database, ids) => {
        await database.collection('properties').deleteOne({ _id: ids.properties[0] });
      },
      { dryRun: true },
    );

    const properties_ = forTable(report, 'properties');
    expect(properties_?.deleted).toBe(1);
    expect(properties_?.deletions).toHaveLength(1);

    // Reported as removable, still present.
    const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(properties);
    expect(row.total).toBe(10);
  }, 120_000);

  it('DRY RUN writes no UPDATE either, not just no delete', async () => {
    const report = await copyThenDrift(
      async (database, ids) => {
        await database
          .collection('properties')
          .updateOne({ _id: ids.properties[0] }, { $set: { description: 'dry' } });
      },
      { dryRun: true },
    );
    expect(forTable(report, 'properties')?.updated).toBe(1);

    const [stored] = await getDb()
      .select({ description: properties.description })
      .from(properties)
      .where(eq(properties.description, 'dry'));
    expect(stored).toBeUndefined();
  }, 120_000);

  it('a DRY RUN reports pending drift instead of failing on it', async () => {
    // Left as a failure, the exit code depended on whether the 200-row fidelity
    // sample happened to land on a drifted row — the production dry run exited 0
    // with three updates pending, purely because it missed them. An exit code
    // that means different things on two runs of the same command means nothing.
    const report = await copyThenDrift(
      async (database, ids) => {
        for (const id of ids.properties) {
          await database.collection('properties').updateOne({ _id: id }, { $set: { description: 'pending' } });
        }
      },
      { dryRun: true },
    );

    expect(forTable(report, 'properties')?.updated).toBe(10);
    // Reported, and the run stands.
    expect(report.verified.some((entry) => entry.mismatches.length > 0)).toBe(true);
  }, 120_000);

  it('NEVER deletes a row created in Postgres, whatever the source says', async () => {
    // The bug that would destroy live data. After the write path lands, "absent
    // from Mongo" means either "deleted before the cutover" (a ghost) or
    // "created in Postgres" (real data that was never in Mongo). Absence alone
    // cannot tell them apart; the id SHAPE can — a copied row carries a 24-char
    // ObjectId hex, a created one a uuid v7.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);
    const listing = propertyDocument(address._id as mongoose.Types.ObjectId);
    await database.collection('properties').insertOne(listing);
    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    // A listing created in Postgres AFTER the cutover — a uuid v7 id, no Mongo
    // document, and never one.
    const nativeId = uuidv7();
    await getDb()
      .insert(properties)
      .values({
        id: nativeId,
        addressId: String(address._id),
        sourceUrl: 'https://example.test/native',
        offerings: ['long_term_rent'],
        longTermRentMonthlyAmount: 900,
      });

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'reconcile',
      sampleSize: 5,
    });

    const properties_ = forTable(report, 'properties');
    expect(properties_?.deleted).toBe(0);
    expect(properties_?.retainedPostCutover).toBe(1);

    const [kept] = await getDb()
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.id, nativeId));
    expect(kept?.id).toBe(nativeId);
  }, 120_000);

  it('NEVER rolls back a row the target wrote more recently', async () => {
    // The window this mode was written in has closed. It assumed Mongo was the
    // only writer, so "the source differs" meant "the target is stale" — and
    // once the write path moved, the target can be AHEAD. Measured the hour that
    // landed: of three differing properties, TWO were newer in Postgres (the
    // ingest worker refreshing `expires_at` against the new authority), and a
    // blind apply would have moved both deadlines backwards by about an hour,
    // into the path of the expiry sweep.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);
    const listing = propertyDocument(address._id as mongoose.Types.ObjectId, {
      description: 'from mongo',
      updatedAt: new Date('2026-08-09T10:00:00.000Z'),
    });
    await database.collection('properties').insertOne(listing);
    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    // Postgres moves ahead — a live write by the authoritative store.
    await getDb()
      .update(properties)
      .set({ description: 'written in postgres', updatedAt: new Date('2026-08-09T12:00:00.000Z') })
      .where(eq(properties.id, String(listing._id)));

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'reconcile',
      sampleSize: 5,
    });

    const properties_ = forTable(report, 'properties');
    expect(properties_?.updated).toBe(0);
    expect(properties_?.skippedTargetNewer).toBe(1);

    const [kept] = await getDb()
      .select({ description: properties.description })
      .from(properties)
      .where(eq(properties.id, String(listing._id)));
    expect(kept.description).toBe('written in postgres');
  }, 120_000);

  it('still carries a STALE target forward — the guard is directional, not symmetric', async () => {
    // The other half. "Never roll back" must not become "never update".
    const report = await copyThenDrift(async (database, ids) => {
      await database.collection('properties').updateOne(
        { _id: ids.properties[0] },
        { $set: { description: 'newer in mongo', updatedAt: new Date(Date.now() + 3_600_000) } },
      );
    });

    const properties_ = forTable(report, 'properties');
    expect(properties_?.updated).toBe(1);
    expect(properties_?.skippedTargetNewer).toBe(0);
  }, 120_000);

  it('converges: a second reconcile changes nothing and reports it as unchanged', async () => {
    // A reconciliation that only reports what it CHANGED cannot tell a converged
    // run from one that examined nothing.
    const report = await copyThenDrift(async (database, ids) => {
      await database.collection('properties').deleteOne({ _id: ids.properties[0] });
    });
    expect(forTable(report, 'properties')?.deleted).toBe(1);

    const second = await runDataBackfill({
      mongo: mongoDatabase(),
      database: getDb(),
      mode: 'reconcile',
      sampleSize: 5,
    });
    const properties_ = second.reconciled.find((entry) => entry.table === 'properties');
    expect(properties_?.deleted).toBe(0);
    expect(properties_?.updated).toBe(0);
    expect(properties_?.inserted).toBe(0);
    expect(properties_?.unchanged).toBe(9);
  }, 150_000);
});

// ── the audit ──────────────────────────────────────────────────────

describe('data backfill — the audit', () => {
  const log = () => new ResolutionLog();

  function auditProperty(edit: (row: CandidateRow) => void) {
    const row = toPropertyRow(propertyDocument(oid()), log());
    edit(row);
    const auditor = new RowAuditor(properties, PROPERTY_RULES);
    auditor.add([row]);
    return auditor.drain();
  }

  it('passes a coherent row — the floor that stops every refusal below being vacuous', () => {
    expect(auditProperty(() => undefined)).toEqual([]);
  });

  it('refuses a value outside a CHECK vocabulary, naming it', () => {
    const violations = auditProperty((row) => {
      row.type = 'submarine';
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/not one of/);
  });

  it('refuses offerings that name a block the row does not carry', () => {
    const violations = auditProperty((row) => {
      row.offerings = ['long_term_rent', 'sale'];
    });
    expect(violations.map((violation) => violation.column)).toContain(
      'properties_offering_sale_check',
    );
  });

  it('refuses a priced block populated without its discriminator', () => {
    // `sale: { currency: 'EUR' }` with `offerings: []` is rejected by Mongo and
    // INVISIBLE to the coherence check, which only sees `false = false`.
    const violations = auditProperty((row) => {
      row.saleCurrency = 'EUR';
    });
    expect(violations.map((violation) => violation.column)).toContain('properties_sale_block_check');
  });

  it('refuses an external listing with no source_url', () => {
    const violations = auditProperty((row) => {
      row.sourceUrl = null;
    });
    expect(violations.map((violation) => violation.column)).toContain(
      'properties_external_source_url_check',
    );
  });

  it('refuses a text[] whose ELEMENT is not a string', () => {
    // The geo tables carry no array column at all, so this path was unreachable
    // until this batch — and an unaudited column kind is one whose bad values
    // reach the insert.
    const violations = auditProperty((row) => {
      row.amenities = ['lift', 7];
    });
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/element 1/);
  });

  it('refuses a coordinate pair outside the range PostGIS would silently coerce', () => {
    const row = toAddressRow(
      { _id: oid(), coordinates: { type: 'Point', coordinates: [0, 100] } },
      log(),
    );
    const auditor = new RowAuditor(addresses, [
      {
        name: 'addresses_coordinates_range_check',
        reason: 'out of range',
        holds: (candidate) => typeof candidate.latitude !== 'number' || candidate.latitude <= 90,
      },
    ]);
    auditor.add([row]);
    expect(auditor.drain().map((violation) => violation.column)).toContain(
      'addresses_coordinates_range_check',
    );
  });

  it('reports two rows sharing a unique key, which ON CONFLICT DO NOTHING would ABSORB', () => {
    const auditor = new UniqueKeyAuditor('agencies_normalized_name_key', (row) =>
      typeof row.normalizedName === 'string' ? row.normalizedName : null,
    );
    auditor.add([
      { id: 'a', normalizedName: 'finques' },
      { id: 'b', normalizedName: 'finques' },
    ]);
    const violations = auditor.drain();
    expect(violations).toHaveLength(1);
    expect(violations[0].rows).toBe(1);
    expect(violations[0].reason).toMatch(/without raising/);
  });

  it('does NOT report rows a PARTIAL unique index leaves uncovered', () => {
    const auditor = new UniqueKeyAuditor('addresses_normalized_key_key', (row) =>
      typeof row.normalizedKey === 'string' ? row.normalizedKey : null,
    );
    auditor.add([
      { id: 'a', normalizedKey: null },
      { id: 'b', normalizedKey: null },
    ]);
    expect(auditor.drain()).toEqual([]);
  });

  it('counts what it audited, so an empty report cannot be read as a clean one', () => {
    const auditor = new RowAuditor(agencies, []);
    expect(auditor.audited).toBe(0);
    auditor.add([toAgencyRow({ _id: oid(), name: 'F', normalizedName: 'f', slug: 'f' }, log())]);
    expect(auditor.audited).toBe(1);
  });
});

// ── end to end ─────────────────────────────────────────────────────

describe('data backfill — end to end', () => {
  it('copies every collection, derives has_images and passes its own verification', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();

    const barcelona = addressDocument(geo, 'Barcelona', BARCELONA);
    const madrid = addressDocument(geo, 'Madrid', MADRID, { street: 'Gran Vía', postal_code: '28013' });
    await database.collection('addresses').insertMany([barcelona, madrid]);
    await seedMeasurableAddresses(geo);
    const berlin = madrid;

    const agency = { _id: oid(), name: 'Finques Verdi', normalizedName: 'finques verdi', slug: 'finques-verdi', createdAt: new Date(), updatedAt: new Date() };
    await database.collection('agencies').insertOne(agency);

    const photo = imageDocument();
    await database.collection('images').insertOne(photo);

    const withPhoto = propertyDocument(barcelona._id as mongoose.Types.ObjectId, {
      agencyId: agency._id,
      images: [{ _id: oid(), imageId: photo._id, url: 'u/m', isPrimary: true, order: 0 }],
      documents: [{ _id: oid(), name: 'Lease', url: 'https://example.test/lease.pdf', type: 'lease' }],
      // The stored flag is WRONG on purpose: the copy must derive it, and
      // production holds exactly this shape.
      hasImages: false,
    });
    const withoutPhoto = propertyDocument(madrid._id as mongoose.Types.ObjectId, { hasImages: true });
    const berliner = propertyDocument(berlin._id as mongoose.Types.ObjectId);
    await database.collection('properties').insertMany([withPhoto, withoutPhoto, berliner]);

    await database.collection('profiles').insertOne({
      _id: oid(),
      oxyUserId: 'oxy-tenant-1',
      personalProfile: {
        personalInfo: { bio: 'Quiet tenant', annualIncome: 42000 },
        references: [{ _id: oid(), name: 'Ana', relationship: 'landlord', verified: true }],
        rentalHistory: [
          { _id: oid(), address: 'Carrer Gran 1', startDate: new Date('2024-01-01'), endDate: new Date('2025-01-01'), verified: false },
        ],
        chatHistory: [{ _id: oid(), role: 'user', content: 'hello', timestamp: new Date() }],
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 10,
    });

    expect(report.mode).toBe('copy');
    expect(report.verified.every((entry) => entry.missing === 0)).toBe(true);
    expect(report.verified.every((entry) => entry.mismatches.length === 0)).toBe(true);
    expect(report.hasImagesDisagreements).toBe(0);

    const db = getDb();
    const [listing] = await db
      .select({ hasImages: properties.hasImages, agencyId: properties.agencyId })
      .from(properties)
      .where(eq(properties.id, String(withPhoto._id)));
    // DERIVED, not copied: the source said `false` and the photo row says
    // otherwise.
    expect(listing.hasImages).toBe(true);
    expect(listing.agencyId).toBe(String(agency._id));

    const [empty] = await db
      .select({ hasImages: properties.hasImages })
      .from(properties)
      .where(eq(properties.id, String(withoutPhoto._id)));
    expect(empty.hasImages).toBe(false);

    const [photoRow] = await db
      .select({ imageId: propertyImages.imageId, isPrimary: propertyImages.isPrimary })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, String(withPhoto._id)));
    expect(photoRow.imageId).toBe(String(photo._id));
    expect(photoRow.isPrimary).toBe(true);

    // `extras` is the one jsonb column in the migration, and Postgres reorders
    // its keys on the way in — the comparison the verifier makes has to survive
    // that, and this asserts the value really round-tripped.
    const [address] = await db
      .select({ extras: addresses.extras, level: addresses.addressLevel })
      .from(addresses)
      .where(eq(addresses.id, String(barcelona._id)));
    expect(address.extras).toEqual({ portal: 'idealista', floorRaw: '3º' });
    // GENERATED from the identifying fields — `number` is set, `floor` is not.
    expect(address.level).toBe('BUILDING');

    const [profile] = await db.select({ oxyUserId: profiles.oxyUserId }).from(profiles);
    expect(profile.oxyUserId).toBe('oxy-tenant-1');
  }, 60_000);

  it('measures a REAL distance, so a transposed coordinate pair cannot pass', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    await database.collection('addresses').insertOne(addressDocument(geo, 'Barcelona', BARCELONA));
    await seedMeasurableAddresses(geo);

    await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
      only: ['images', 'addresses'],
    });

    const geometry = await checkGeometry(getDb());
    expect(geometry.centroidSamples).toBe(4);
    expect(geometry.centroidOverLimit).toBe(0);

    // Pairs chosen from cities that actually carry addresses. A pair that cannot
    // be measured names its reason rather than answering a bare `null`.
    const measured = geometry.pairs.filter((pair) => pair.measuredMetres !== null);
    expect(measured.length).toBeGreaterThanOrEqual(2);
    expect(measured.every((pair) => pair.withinTolerance === true)).toBe(true);
    for (const pair of geometry.pairs) {
      if (pair.measuredMetres === null) expect(pair.notMeasured).toMatch(/no address in/);
      else expect(pair.notMeasured).toBeNull();
    }
  }, 60_000);

  it('refuses when too FEW named pairs could be measured to anchor anything', async () => {
    // The vacuity floor on the anchor itself. The first version of this check
    // named Barcelona→Paris, which returned a bare `null` on every run because
    // production holds no Paris address — a probe that answers `null` cannot
    // tell "correct" from "nothing to measure against", and one surviving
    // measurement is a coincidence away from meaning nothing.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    // Madrid only: no pair has both endpoints.
    await database.collection('addresses').insertOne(
      addressDocument(geo, 'Madrid', MADRID, { street: 'Gran Vía' }),
    );

    await expect(
      runDataBackfill({
        mongo: database,
        database: getDb(),
        mode: 'copy',
        sampleSize: 5,
        only: ['images', 'addresses'],
      }),
    ).rejects.toThrow(/named city\s+pairs could be measured/);
  }, 60_000);

  it('a TRANSPOSED pair lands thousands of kilometres from its own city', async () => {
    // The check the verifier runs, run against the defect it exists to catch —
    // otherwise "centroidOverLimit is 0" is a number nobody has seen move.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    await database.collection('addresses').insertOne(
      addressDocument(geo, 'Barcelona', BARCELONA, {
        coordinates: { type: 'Point', coordinates: [BARCELONA.lat, BARCELONA.lng] },
      }),
    );

    // The run's OWN verification must refuse it — that is the point of the
    // check. The rows are already copied by then, so the measurement below reads
    // what a transposition actually looks like rather than what it would.
    await expect(
      runDataBackfill({
        mongo: database,
        database: getDb(),
        mode: 'copy',
        sampleSize: 5,
        only: ['images', 'addresses'],
      }),
    ).rejects.toThrow(/geometry/);

    const geometry = await checkGeometry(getDb());
    expect(geometry.centroidOverLimit).toBe(1);
    expect(geometry.centroidMaxMetres).toBeGreaterThan(1_000_000);
  }, 60_000);

  it('counts a resolution ONCE per copy, not once per pass', async () => {
    // `copy` reads the source twice — audit, then write — and both passes run
    // the same mappers. A shared log double-counts every resolution, which is
    // not merely untidy: the figure is compared against a frozen census count,
    // so 2× reads as drift. Production reported MODERATION_ABSENT 35,284 for a
    // collection of 17,644 rows.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);
    await database.collection('properties').insertMany([
      propertyDocument(address._id as mongoose.Types.ObjectId),
      propertyDocument(address._id as mongoose.Types.ObjectId),
    ]);

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
    });

    // Two listings, neither carrying `moderation`. Not four.
    expect(report.resolutions[DATA_RESOLUTIONS.MODERATION_ABSENT]).toBe(2);
  }, 90_000);

  it('reports a far-flung address without refusing the run, below the transposition rate', async () => {
    // Two production addresses are bad GEOCODES in Mongo — `León Capital` at
    // (-66.99, 10.53), which is Caracas, and a Bremen address at (0, 0). The
    // copy reproduces them faithfully, and a gate at "zero outliers" would
    // therefore fail forever on data the copy did not create. A transposition is
    // a property of the MAPPER and moves every address, so the rate is what
    // discriminates.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const good = Array.from({ length: 300 }, () =>
      addressDocument(geo, 'Barcelona', BARCELONA),
    );
    await seedMeasurableAddresses(geo);
    await database.collection('addresses').insertMany([
      ...good,
      // One bad geocode: Caracas, filed under a Spanish city. 1 in 303 is well
      // under the 1% threshold.
      addressDocument(geo, 'Barcelona', { lng: -66.9858849, lat: 10.5251816 }),
    ]);

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
      only: ['images', 'addresses'],
    });

    // Reported, not swallowed — and the run stands.
    expect(report.geometry?.centroidOverLimit).toBe(1);
    expect(report.geometry?.centroidSamples).toBe(304);
    // Classified and named, not folded into a count somebody has to go and look
    // up. `(0,0)` is told apart from "wrong country" because the remedies differ.
    expect(report.geometry?.outliers).toEqual([
      expect.objectContaining({ resolution: 'SOURCE_COORDINATES_FAR_FROM_CITY' }),
    ]);
  }, 120_000);

  it('refuses to write anything when the audit finds a violation', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await database.collection('properties').insertOne(
      propertyDocument(address._id as mongoose.Types.ObjectId, { type: 'submarine' }),
    );

    await expect(
      runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 }),
    ).rejects.toThrow(/Audit refused/);

    const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(properties);
    expect(row.total).toBe(0);
  }, 60_000);

  it('refuses an audit that examined ZERO rows rather than reporting it clean', async () => {
    // "No violations" and "nothing was checked" are the same report. The source
    // guard proves the collections exist; this proves something was read.
    await seedAndCopyGeo();
    await mongoDatabase().collection('profiles').deleteMany({});

    await expect(
      runDataBackfill({
        mongo: mongoDatabase(),
        database: getDb(),
        mode: 'audit-only',
        only: ['profiles'],
      }),
    ).rejects.toThrow(/ZERO rows/);
  }, 60_000);

  it('is idempotent: a second copy inserts nothing and still verifies', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    // Madrid and Paris too: full verification demands at least one measurable
    // real-world distance, and one city cannot supply one.
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);
    await database.collection('properties').insertOne(
      propertyDocument(address._id as mongoose.Types.ObjectId),
    );

    const first = await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });
    const second = await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    const inserted = (report: typeof first, collection: string) =>
      report.copied.find((entry) => entry.collection === collection)?.inserted ?? {};
    expect(inserted(first, 'addresses').addresses).toBe(4);
    // `ON CONFLICT DO NOTHING` still reports the batch it SENT; what proves
    // convergence is that verification passes and the table did not grow.
    expect(second.verified.every((entry) => entry.missing === 0)).toBe(true);

    const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(addresses);
    expect(row.total).toBe(4);
  }, 90_000);

  it('links a geo cover image once images exist, and never restamps updated_at', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();

    const cover = imageDocument({ entityType: 'city', entityId: geo.cityIds.Barcelona });
    await database.collection('images').insertOne(cover);
    await database.collection('cities').updateOne(
      { _id: geo.cityIds.Barcelona },
      { $set: { coverImageId: cover._id } },
    );

    await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
      only: ['images'],
    });

    const before = await getDb()
      .select({ updatedAt: cities.updatedAt })
      .from(cities)
      .where(eq(cities.id, String(geo.cityIds.Barcelona)));

    const reports = await linkCoverImages(getDb(), database);
    const citiesReport = reports.find((entry) => entry.table === 'cities');
    expect(citiesReport?.linked).toBe(1);

    const [after] = await getDb()
      .select({ coverImageId: cities.coverImageId, updatedAt: cities.updatedAt })
      .from(cities)
      .where(eq(cities.id, String(geo.cityIds.Barcelona)));
    expect(after.coverImageId).toBe(String(cover._id));
    // The only UPDATE in the backfill, and drizzle's `$onUpdate` would otherwise
    // replace history with the migration's own clock.
    expect(after.updatedAt.getTime()).toBe(before[0].updatedAt.getTime());
  }, 60_000);

  it('refuses to put a PROPERTY photo on a city, even though the FK would accept it', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();

    const listingPhoto = imageDocument({ entityType: 'property' });
    await database.collection('images').insertOne(listingPhoto);
    await database.collection('cities').updateOne(
      { _id: geo.cityIds.Madrid },
      { $set: { coverImageId: listingPhoto._id } },
    );

    await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
      only: ['images'],
    });

    const reports = await linkCoverImages(getDb(), database);
    const citiesReport = reports.find((entry) => entry.table === 'cities');
    expect(citiesReport?.notAGeoImage).toBe(1);
    expect(citiesReport?.linked).toBe(0);

    const [row] = await getDb()
      .select({ coverImageId: cities.coverImageId })
      .from(cities)
      .where(eq(cities.id, String(geo.cityIds.Madrid)));
    expect(row.coverImageId).toBeNull();
  }, 60_000);

  it('writes a child batch only after its parents, however the batch sizes fall', async () => {
    // THE PRODUCTION FAILURE, as a fixture.
    //
    // The first copy against production died here: `images`, `addresses` and
    // `agencies` were in, and the first `property_images` batch hit 23503
    // because the `properties` rows it referenced were still buffered. Batch
    // size is derived from column count, so `properties` (135 columns) fills at
    // 370 rows while `property_images` (11) fills at 500 — and at roughly ten
    // photos per listing the CHILD fills after about fifty documents, with the
    // parent four fifths empty.
    //
    // Fifty properties × eleven photos = 550 child rows and 50 parent rows,
    // which crosses the child's threshold and nowhere near the parent's. Every
    // earlier fixture in this file has one or two properties, which is why none
    // of them could ever have caught it.
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);

    const photos = Array.from({ length: 55 * 11 }, () => imageDocument());
    await database.collection('images').insertMany(photos);

    const listings = Array.from({ length: 55 }, (_, listing) =>
      propertyDocument(address._id as mongoose.Types.ObjectId, {
        images: photos.slice(listing * 11, listing * 11 + 11).map((photo, index) => ({
          _id: oid(),
          imageId: photo._id,
          url: 'u/m',
          isPrimary: index === 0,
          order: index,
        })),
      }),
    );
    await database.collection('properties').insertMany(listings);

    const report = await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
    });

    expect(report.verified.every((entry) => entry.missing === 0)).toBe(true);

    const [parents] = await getDb().select({ total: sql<number>`count(*)::int` }).from(properties);
    const [children] = await getDb()
      .select({ total: sql<number>`count(*)::int` })
      .from(propertyImages);
    expect(parents.total).toBe(55);
    expect(children.total).toBe(55 * 11);
  }, 120_000);

  it('writes both calendars into one table, under their own scopes', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertOne(address);
    await seedMeasurableAddresses(geo);
    await database.collection('properties').insertOne(
      propertyDocument(address._id as mongoose.Types.ObjectId, {
        offerings: ['long_term_rent', 'exchange'],
        exchange: {
          mode: 'swap',
          availabilityWindows: [
            { start: new Date('2026-06-01T00:00:00.000Z'), end: new Date('2026-06-08T00:00:00.000Z'), status: 'available' },
          ],
        },
        availabilityWindows: [
          { start: new Date('2026-05-01T00:00:00.000Z'), end: new Date('2026-05-08T00:00:00.000Z'), status: 'blocked' },
        ],
      }),
    );

    await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    const windows = await getDb()
      .select({ scope: propertyAvailabilityWindows.scope, status: propertyAvailabilityWindows.status })
      .from(propertyAvailabilityWindows);
    expect(windows.map((row) => row.scope).sort()).toEqual(['exchange', 'listing']);
  }, 60_000);
});
