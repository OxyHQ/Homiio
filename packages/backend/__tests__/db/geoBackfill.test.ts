/**
 * The geo backfill, against a real Mongo and a real Postgres.
 *
 * Both stores are genuine here — the in-memory replica set `jest.setup.ts`
 * starts, and this worker's own throwaway, fully-migrated Postgres database —
 * and the end-to-end cases drive `runGeoBackfill`, the SAME function the
 * production one-shot calls. That is the point: the properties under test are a
 * real `ON CONFLICT DO NOTHING`, real foreign keys, real CHECKs and a real
 * `$in` query, and a mocked driver has none of them. A mocked `insert` accepts
 * any statement, including one the server rejects outright.
 *
 * The pure cases (mappers, audit, argument guards) run beside them rather than
 * in a separate file, so the rule and the round trip that proves it are read
 * together.
 */

import mongoose from 'mongoose';
import { eq, inArray, getTableName, sql } from 'drizzle-orm';
import { alias, getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

import { getDb } from '../../db/postgres';
import { cities, countries, neighborhoods, regions } from '../../db/schema/geo';
import { images } from '../../db/schema/images';
import {
  assertMigrationSource,
  auditPlan,
  buildRows,
  loadSource,
  readMode,
  readSampleSize,
  readSourceDatabase,
  runGeoBackfill,
  type PlannedRows,
} from '../../db/backfill/geo';
import {
  GEO_COPY_ORDER,
  GEO_RESOLUTIONS,
  GEO_TABLES,
  ResolutionLog,
  toCityRow,
  toCountryRow,
  toImageRow,
  toNeighborhoodRow,
  toRegionRow,
  type CoverContext,
  type SourceDocument,
} from '../../db/backfill/geoPlan';
import type { CandidateRow } from '../../db/backfill/rowAudit';

const oid = () => new mongoose.Types.ObjectId();
const noCovers: CoverContext = { existingImageIds: new Set() };

/** The Mongo handle `jest.setup.ts` connected, narrowed once. */
function mongoDatabase() {
  const database = mongoose.connection.db;
  if (!database) throw new Error('The test Mongo connection published no database handle.');
  return database;
}

/** Every column of a real `images` document, so a fixture is never NOT NULL-shy. */
function imageDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: oid(),
    entityType: 'city',
    entityId: oid(),
    // Distinct per variant on purpose: four copies of one string cannot tell a
    // correct flattening from one that writes `small` into `large`.
    keys: { original: 'k/o', small: 'k/s', medium: 'k/m', large: 'k/l' },
    urls: { original: 'u/o', small: 'u/s', medium: 'u/m', large: 'u/l' },
    width: 1200,
    height: 800,
    format: 'jpeg',
    bytes: 45678,
    isPrimary: true,
    order: 0,
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    updatedAt: new Date('2026-02-03T04:05:06.000Z'),
    ...overrides,
  };
}

describe('geo backfill — argument guards', () => {
  it('requires --source-database, and says why a missing one is not recoverable', () => {
    expect(() => readSourceDatabase(['--target-database=homiio'])).toThrow(/--source-database/);
    expect(readSourceDatabase(['--source-database=homiio-production'])).toBe('homiio-production');
  });

  it('refuses an empty --source-database rather than reading "" as a name', () => {
    expect(() => readSourceDatabase(['--source-database='])).toThrow(/--source-database/);
    expect(() => readSourceDatabase(['--source-database=   '])).toThrow(/--source-database/);
  });

  it('reads the mode, and refuses a command line asking for two runs at once', () => {
    expect(readMode([])).toBe('copy');
    expect(readMode(['--audit-only'])).toBe('audit-only');
    expect(readMode(['--verify-only'])).toBe('verify-only');
    expect(readMode(['--reconcile'])).toBe('reconcile');
    expect(() => readMode(['--audit-only', '--verify-only'])).toThrow(/mutually exclusive/);
    expect(() => readMode(['--reconcile', '--audit-only'])).toThrow(/mutually exclusive/);
    expect(() => readMode(['--reconcile', '--verify-only'])).toThrow(/mutually exclusive/);
  });

  it('refuses a --sample that would silently compare nothing', () => {
    expect(readSampleSize([])).toBe(200);
    expect(readSampleSize(['--sample=25'])).toBe(25);
    expect(() => readSampleSize(['--sample=0'])).toThrow(/positive integer/);
    expect(() => readSampleSize(['--sample=-3'])).toThrow(/positive integer/);
    expect(() => readSampleSize(['--sample=1.5'])).toThrow(/positive integer/);
    expect(() => readSampleSize(['--sample=all'])).toThrow(/positive integer/);
  });
});

describe('geo backfill — the source guard', () => {
  afterEach(async () => {
    const database = mongoDatabase();
    for (const name of ['countries', 'regions', 'cities', 'neighborhoods', 'images']) {
      await database.collection(name).deleteMany({});
    }
  });

  it('refuses a database whose name is not the one the run stated, naming both', async () => {
    const database = mongoDatabase();
    await expect(assertMigrationSource(database, 'homiio-production')).rejects.toThrow(
      new RegExp(`homiio-production[\\s\\S]*${database.databaseName}`),
    );
  });

  it('refuses a correctly-named database that is missing a source collection', async () => {
    const database = mongoDatabase();
    // Four of the five, so the refusal cannot be passing for want of any data at
    // all — it has to be naming the one that is absent.
    for (const name of ['countries', 'regions', 'cities', 'neighborhoods']) {
      await database.collection(name).insertOne({ _id: oid() });
    }
    await expect(assertMigrationSource(database, database.databaseName)).rejects.toThrow(/images/);
  });

  it('accepts the connected database once every source collection exists', async () => {
    const database = mongoDatabase();
    for (const name of ['countries', 'regions', 'cities', 'neighborhoods', 'images']) {
      await database.collection(name).insertOne({ _id: oid() });
    }
    await expect(assertMigrationSource(database, database.databaseName)).resolves.toBeUndefined();
  });
});

describe('geo backfill — the mappers', () => {
  it('carries an id verbatim, as the 24-char hex, minting nothing', () => {
    const id = oid();
    const row = toCountryRow({ _id: id, code: 'ES', name: 'Spain' }, new ResolutionLog());
    expect(row.id).toBe(id.toHexString());
    expect(row.id).toMatch(/^[0-9a-f]{24}$/);
  });

  it('splits city coordinates into NAMED columns, and does not transpose them', () => {
    const row = toCityRow(
      { _id: oid(), name: 'Barcelona', coordinates: { lat: 41.3874, lng: 2.1686 } },
      noCovers,
      new ResolutionLog(),
    );
    expect(row.latitude).toBe(41.3874);
    expect(row.longitude).toBe(2.1686);
  });

  it('flattens image keys and urls variant by variant', () => {
    const row = toImageRow(imageDocument(), new ResolutionLog());
    expect(row.keysOriginal).toBe('k/o');
    expect(row.keysSmall).toBe('k/s');
    expect(row.keysMedium).toBe('k/m');
    expect(row.keysLarge).toBe('k/l');
    expect(row.urlsOriginal).toBe('u/o');
    expect(row.urlsSmall).toBe('u/s');
    expect(row.urlsMedium).toBe('u/m');
    expect(row.urlsLarge).toBe('u/l');
  });

  it('writes a bbox into west/south/east/north, in that order', () => {
    const row = toNeighborhoodRow(
      { _id: oid(), cityId: oid(), name: 'Gràcia', bbox: [2.1, 41.3, 2.2, 41.4] },
      new ResolutionLog(),
    );
    expect(row.bboxWest).toBe(2.1);
    expect(row.bboxSouth).toBe(41.3);
    expect(row.bboxEast).toBe(2.2);
    expect(row.bboxNorth).toBe(41.4);
  });

  it('turns an EMPTY bbox into four nulls, which is the "none" half of the CHECK', () => {
    const log = new ResolutionLog();
    const row = toNeighborhoodRow({ _id: oid(), cityId: oid(), name: 'Centro', bbox: [] }, log);
    expect([row.bboxWest, row.bboxSouth, row.bboxEast, row.bboxNorth]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(log.toRecord()[GEO_RESOLUTIONS.BBOX_EMPTY]).toBe(1);
  });

  it('nulls a cover naming no image at all, and counts it', () => {
    const log = new ResolutionLog();
    const row = toCityRow(
      { _id: oid(), name: 'Telde', countryId: oid(), regionId: oid(), coverImageId: oid() },
      noCovers,
      log,
    );
    expect(row.coverImageId).toBeNull();
    expect(log.toRecord()[GEO_RESOLUTIONS.COVER_DANGLING]).toBe(1);
  });

  it('keeps a cover that names an image the copy carries, and counts nothing', () => {
    const cover = oid();
    const log = new ResolutionLog();
    const row = toCityRow(
      { _id: oid(), name: 'Bilbao', countryId: oid(), regionId: oid(), coverImageId: cover },
      { existingImageIds: new Set([cover.toHexString()]) },
      log,
    );
    expect(row.coverImageId).toBe(cover.toHexString());
    expect(log.toRecord()[GEO_RESOLUTIONS.COVER_DANGLING]).toBeUndefined();
  });

  it('applies a Mongoose schema default only where the document has none', () => {
    const log = new ResolutionLog();
    const bare = toCityRow(
      { _id: oid(), name: 'Vigo', countryId: oid(), regionId: oid() },
      noCovers,
      log,
    );
    expect(bare.currency).toBe('EUR');
    expect(bare.isActive).toBe(true);
    expect(bare.propertiesCount).toBe(0);
    expect(log.toRecord()[GEO_RESOLUTIONS.SCHEMA_DEFAULT]).toBeGreaterThanOrEqual(3);

    const stated = toCityRow(
      {
        _id: oid(),
        name: 'Leeds',
        countryId: oid(),
        regionId: oid(),
        currency: 'GBP',
        isActive: false,
        propertiesCount: 42,
      },
      noCovers,
      new ResolutionLog(),
    );
    // `false` and `0` are STATED values, not absences — a `||` fallback here
    // would silently re-activate a deactivated city and reset its count.
    expect(stated.currency).toBe('GBP');
    expect(stated.isActive).toBe(false);
    expect(stated.propertiesCount).toBe(42);
  });

  it("falls back to the ObjectId's own timestamp when createdAt is absent", () => {
    const id = oid();
    const log = new ResolutionLog();
    const row = toCountryRow({ _id: id, code: 'PT', name: 'Portugal' }, log);
    expect(row.createdAt).toEqual(id.getTimestamp());
    expect(row.updatedAt).toEqual(id.getTimestamp());
    expect(log.toRecord()[GEO_RESOLUTIONS.TIMESTAMP_FROM_OBJECT_ID]).toBe(2);
  });

  it('keeps a stored createdAt rather than re-deriving one', () => {
    const stored = new Date('2020-05-06T07:08:09.000Z');
    const log = new ResolutionLog();
    const row = toCountryRow(
      { _id: oid(), code: 'FR', name: 'France', createdAt: stored, updatedAt: stored },
      log,
    );
    expect(row.createdAt).toEqual(stored);
    expect(log.toRecord()[GEO_RESOLUTIONS.TIMESTAMP_FROM_OBJECT_ID]).toBeUndefined();
  });

  it('PRESERVES a value of the wrong type instead of coercing it away', () => {
    // The whole audit depends on this. A mapper that turned `'600000'` into
    // `null` here would hand a nullable column a null and report green, and the
    // row Mongo actually holds would never be seen by anyone.
    const row = toCityRow(
      { _id: oid(), name: 'Odd', countryId: oid(), regionId: oid(), population: '600000' },
      noCovers,
      new ResolutionLog(),
    );
    expect(row.population).toBe('600000');
  });
});

describe('geo backfill — the audit', () => {
  /** A coherent plan: one country, one region, one city, one neighborhood, one image. */
  function coherentPlan(): { planned: PlannedRows; ids: Record<string, string> } {
    const log = new ResolutionLog();
    const countryId = oid();
    const regionId = oid();
    const cityId = oid();
    const imageId = oid();
    const cover: CoverContext = { existingImageIds: new Set([imageId.toHexString()]) };

    const rows = {
      images: [toImageRow(imageDocument({ _id: imageId, entityId: cityId }), log)],
      countries: [toCountryRow({ _id: countryId, code: 'ES', name: 'Spain' }, log)],
      regions: [toRegionRow({ _id: regionId, countryId, name: 'Catalonia' }, cover, log)],
      cities: [
        toCityRow(
          { _id: cityId, name: 'Barcelona', countryId, regionId, coverImageId: imageId },
          cover,
          log,
        ),
      ],
      neighborhoods: [
        toNeighborhoodRow({ _id: oid(), cityId, name: 'Gràcia', bbox: [] }, log),
      ],
    };
    return {
      planned: { rows, resolutions: log.toRecord() },
      ids: {
        countryId: countryId.toHexString(),
        regionId: regionId.toHexString(),
        cityId: cityId.toHexString(),
        imageId: imageId.toHexString(),
      },
    };
  }

  /** Replace one column on one row of a coherent plan. */
  function withEdit(
    table: keyof PlannedRows['rows'],
    edit: (row: CandidateRow) => void,
  ): PlannedRows {
    const { planned } = coherentPlan();
    edit(planned.rows[table][0] as CandidateRow);
    return planned;
  }

  it('passes a coherent plan — the floor that stops every refusal below being vacuous', () => {
    expect(auditPlan(coherentPlan().planned)).toEqual([]);
  });

  it('refuses a currency outside the CHECK, naming the value', () => {
    const lines = auditPlan(withEdit('cities', (row) => { row.currency = 'XYZ'; }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('cities.currency');
    expect(lines[0]).toContain('23514');
    expect(lines[0]).toContain('XYZ');
  });

  it('refuses a null in a NOT NULL column', () => {
    const lines = auditPlan(withEdit('countries', (row) => { row.name = null; }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('countries.name');
    expect(lines[0]).toContain('23502');
  });

  it('refuses a number column holding a string', () => {
    const lines = auditPlan(withEdit('cities', (row) => { row.population = '600000'; }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('cities.population');
    expect(lines[0]).toContain('expected a finite number');
  });

  it('refuses an integer column holding a value Postgres cannot store', () => {
    const overflow = auditPlan(withEdit('cities', (row) => { row.population = 3_000_000_000; }));
    expect(overflow[0]).toContain('outside the `integer` range');

    const fraction = auditPlan(withEdit('cities', (row) => { row.propertiesCount = 1.5; }));
    expect(fraction[0]).toContain('expected an integer');
  });

  it('refuses a key the target has no column for', () => {
    const lines = auditPlan(withEdit('cities', (row) => { row.imageIds = []; }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('cities.imageIds');
    expect(lines[0]).toContain('no such column');
  });

  it('refuses a foreign key naming a row this run will not insert', () => {
    const stray = oid().toHexString();
    const lines = auditPlan(withEdit('cities', (row) => { row.regionId = stray; }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('cities.cities_region_id_regions_id_fk');
    expect(lines[0]).toContain(stray);
  });

  it('refuses a cover naming an image outside the geo set rather than nulling it', () => {
    // A cover the mapper KEPT (the image exists) but which this copy does not
    // carry. Nulling it would lose a live link; the audit stops the run instead.
    const foreign = oid().toHexString();
    const lines = auditPlan(withEdit('cities', (row) => { row.coverImageId = foreign; }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('cities_cover_image_id_images_id_fk');
    expect(lines[0]).toContain(foreign);
  });

  it('refuses a HALF-set bbox — the CHECK trap a null-tolerant rule would admit', () => {
    const lines = auditPlan(
      withEdit('neighborhoods', (row) => {
        row.bboxWest = 2.1;
        row.bboxSouth = 41.3;
        row.bboxEast = 2.2;
        // bboxNorth left null: three of four.
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('neighborhoods_bbox_complete_check');
  });
});

describe('geo backfill — the copy order', () => {
  it('respects every real foreign key between the geo tables', () => {
    const position = new Map(GEO_COPY_ORDER.map((name, index) => [getTableName(GEO_TABLES[name]), index]));

    for (const name of GEO_COPY_ORDER) {
      const table = GEO_TABLES[name];
      for (const foreignKey of getTableConfig(table).foreignKeys) {
        const parent = getTableName(foreignKey.reference().foreignTable as PgTable);
        // Every geo foreign key must point INSIDE the geo set: one pointing out
        // means this copy has a prerequisite nobody has planned for, and the
        // right response is to stop and decide rather than to fail at 23503.
        expect(position.has(parent)).toBe(true);
        expect(position.get(parent)!).toBeLessThan(position.get(getTableName(table))!);
      }
    }
  });
});

describe('geo backfill — end to end, real Mongo to real Postgres', () => {
  const countryId = oid();
  const regionId = oid();
  const barcelonaId = oid();
  const madridId = oid();
  const teldeId = oid();
  const neighborhoodId = oid();
  const cityImageId = oid();
  const propertyImageId = oid();
  const missingCoverId = oid();

  /** Seed the five collections. Raw handles: no Mongoose casting, no defaults. */
  async function seed(): Promise<void> {
    const database = mongoDatabase();
    await database.collection('images').insertMany([
      imageDocument({ _id: cityImageId, entityType: 'city', entityId: barcelonaId }),
      // Must NOT travel: it belongs to a `properties` row Postgres has not got.
      imageDocument({ _id: propertyImageId, entityType: 'property', entityId: oid() }),
    ]);
    await database.collection('countries').insertOne({
      _id: countryId,
      code: 'ES',
      name: 'Spain',
      currency: 'EUR',
      flag: '🇪🇸',
      isActive: true,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await database.collection('regions').insertOne({
      _id: regionId,
      countryId,
      code: 'ES-CT',
      name: 'Catalonia',
      isActive: true,
      createdAt: new Date('2025-01-02T00:00:00.000Z'),
      updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    });
    await database.collection('cities').insertMany([
      {
        _id: barcelonaId,
        name: 'Barcelona',
        countryId,
        regionId,
        coordinates: { lat: 41.3874, lng: 2.1686 },
        timezone: 'Europe/Madrid',
        population: 1620343,
        currency: 'EUR',
        coverImageId: cityImageId,
        isActive: true,
        propertiesCount: 137,
        lastUpdated: new Date('2025-06-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        updatedAt: new Date('2025-01-03T00:00:00.000Z'),
      },
      {
        // Real coordinates, for the PostGIS distance assertion below.
        _id: madridId,
        name: 'Madrid',
        countryId,
        regionId,
        coordinates: { lat: 40.4168, lng: -3.7038 },
        currency: 'EUR',
        isActive: true,
        propertiesCount: 12,
        lastUpdated: new Date('2025-06-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-06T00:00:00.000Z'),
        updatedAt: new Date('2025-01-06T00:00:00.000Z'),
      },
      {
        // The frozen `COVER_DANGLING` shape: a cover naming no image at all.
        _id: teldeId,
        name: 'Telde',
        countryId,
        regionId,
        currency: 'EUR',
        coverImageId: missingCoverId,
        isActive: true,
        propertiesCount: 0,
        lastUpdated: new Date('2025-06-01T00:00:00.000Z'),
        createdAt: new Date('2025-01-04T00:00:00.000Z'),
        updatedAt: new Date('2025-01-04T00:00:00.000Z'),
      },
    ]);
    await database.collection('neighborhoods').insertOne({
      _id: neighborhoodId,
      cityId: barcelonaId,
      name: 'Gràcia',
      centroid: { lat: 41.4036, lng: 2.1588 },
      bbox: [],
      isActive: true,
      createdAt: new Date('2025-01-05T00:00:00.000Z'),
      updatedAt: new Date('2025-01-05T00:00:00.000Z'),
    });
  }

  afterEach(async () => {
    const database = mongoDatabase();
    for (const name of ['countries', 'regions', 'cities', 'neighborhoods', 'images']) {
      await database.collection(name).deleteMany({});
    }
    // Reverse foreign-key order, and only the ids this suite created — other
    // files in this worker share the database and their fixtures are not ours
    // to delete.
    const db = getDb();
    await db.delete(neighborhoods).where(eq(neighborhoods.id, neighborhoodId.toHexString()));
    await db
      .delete(cities)
      .where(inArray(cities.id, [barcelonaId.toHexString(), madridId.toHexString(), teldeId.toHexString()]));
    await db.delete(regions).where(eq(regions.id, regionId.toHexString()));
    await db.delete(countries).where(eq(countries.id, countryId.toHexString()));
    await db
      .delete(images)
      .where(inArray(images.id, [cityImageId.toHexString(), propertyImageId.toHexString()]));
  });

  it('copies the geo hierarchy, resolves the covers, and leaves property images behind', async () => {
    await seed();
    const report = await runGeoBackfill({
      mongo: mongoDatabase(),
      database: getDb(),
      mode: 'copy',
    });

    expect(report.read).toEqual({
      images: 1,
      countries: 1,
      regions: 1,
      cities: 3,
      neighborhoods: 1,
    });
    expect(report.copied.map((entry) => [entry.table, entry.inserted])).toEqual([
      ['images', 1],
      ['countries', 1],
      ['regions', 1],
      ['cities', 3],
      ['neighborhoods', 1],
    ]);
    expect(report.resolutions[GEO_RESOLUTIONS.COVER_DANGLING]).toBe(1);

    const db = getDb();
    const [barcelona] = await db.select().from(cities).where(eq(cities.id, barcelonaId.toHexString()));
    expect(barcelona.name).toBe('Barcelona');
    expect(barcelona.latitude).toBe(41.3874);
    expect(barcelona.longitude).toBe(2.1686);
    expect(barcelona.propertiesCount).toBe(137);
    expect(barcelona.coverImageId).toBe(cityImageId.toHexString());
    expect(barcelona.createdAt).toEqual(new Date('2025-01-03T00:00:00.000Z'));

    const [telde] = await db.select().from(cities).where(eq(cities.id, teldeId.toHexString()));
    expect(telde.coverImageId).toBeNull();

    // The property image is the negative case: without it, "images copied" and
    // "the right images copied" would be the same assertion.
    const stored = await db
      .select({ id: images.id })
      .from(images)
      .where(inArray(images.id, [cityImageId.toHexString(), propertyImageId.toHexString()]));
    expect(stored.map((row) => row.id)).toEqual([cityImageId.toHexString()]);
  });

  it('converges on a re-run: nothing inserted twice, verification still passes', async () => {
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });
    const second = await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });

    expect(second.copied.map((entry) => [entry.table, entry.inserted, entry.skippedExisting])).toEqual([
      ['images', 0, 1],
      ['countries', 0, 1],
      ['regions', 0, 1],
      ['cities', 0, 3],
      ['neighborhoods', 0, 1],
    ]);
    expect(second.verified.every((entry) => entry.missing === 0)).toBe(true);
    expect(second.verified.flatMap((entry) => entry.mismatches)).toEqual([]);

    const db = getDb();
    const rows = await db
      .select({ id: cities.id })
      .from(cities)
      .where(inArray(cities.id, [barcelonaId.toHexString(), madridId.toHexString(), teldeId.toHexString()]));
    expect(rows).toHaveLength(3);
  });

  it('an audit-only run writes nothing', async () => {
    await seed();
    const report = await runGeoBackfill({
      mongo: mongoDatabase(),
      database: getDb(),
      mode: 'audit-only',
    });
    expect(report.copied).toEqual([]);
    expect(report.verified).toEqual([]);

    const db = getDb();
    const rows = await db
      .select({ id: cities.id })
      .from(cities)
      .where(inArray(cities.id, [barcelonaId.toHexString(), madridId.toHexString(), teldeId.toHexString()]));
    expect(rows).toEqual([]);
  });

  it('refuses to write anything when the audit finds a violation', async () => {
    await seed();
    // A currency no CHECK admits, written the way production could really hold
    // one: `updateOne` runs no Mongoose validator in this package.
    await mongoDatabase()
      .collection('cities')
      .updateOne({ _id: barcelonaId }, { $set: { currency: 'XYZ' } });

    await expect(
      runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' }),
    ).rejects.toThrow(/Audit refused/);

    // Not even the tables ahead of `cities` in the copy order — the audit runs
    // over the whole plan before the first insert, not table by table.
    const db = getDb();
    expect(
      await db.select({ id: countries.id }).from(countries).where(eq(countries.id, countryId.toHexString())),
    ).toEqual([]);
  });

  it('verification reports a source row the target is missing', async () => {
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });

    // Delete a copied row behind the backfill's back — the shape a partial run,
    // a manual `DELETE` or a silent `ON CONFLICT DO NOTHING` skip would leave.
    await getDb().delete(neighborhoods).where(eq(neighborhoods.id, neighborhoodId.toHexString()));

    await expect(
      runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'verify-only' }),
    ).rejects.toThrow(/Verification failed for neighborhoods/);
  });

  it('verification reports a missing row the SAMPLE never looks at', async () => {
    // The previous case is caught by either half of the verifier, so it cannot
    // tell the presence check from the field-by-field comparison — and a
    // presence check that reported nothing would pass it. Here the sample is
    // one row wide and the deleted row is deliberately the other one, so only
    // the presence check can see it.
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });

    const [sampled, unsampled] = [barcelonaId.toHexString(), teldeId.toHexString()].sort((left, right) =>
      left.localeCompare(right),
    );
    await getDb().delete(cities).where(eq(cities.id, unsampled));

    await expect(
      runGeoBackfill({
        mongo: mongoDatabase(),
        database: getDb(),
        mode: 'verify-only',
        sampleSize: 1,
      }),
    ).rejects.toThrow(/Verification failed for cities/);

    // …and the row the sample DOES cover is untouched, so the refusal above
    // cannot be coming from a field comparison.
    expect(await getDb().select({ id: cities.id }).from(cities).where(eq(cities.id, sampled))).toEqual([
      { id: sampled },
    ]);
  });

  it('verification reports a column whose stored value drifted from the source', async () => {
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });

    await getDb()
      .update(cities)
      .set({ propertiesCount: 999 })
      .where(eq(cities.id, barcelonaId.toHexString()));

    await expect(
      runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'verify-only' }),
    ).rejects.toThrow(/Verification failed for cities/);
  });

  it('lands coordinates PostGIS agrees are the real places, not their transposition', async () => {
    // A non-null pair of coordinates proves nothing: swapping `lat` and `lng`
    // yields a perfectly valid point in the wrong hemisphere and no error
    // anywhere. Only a real-world DISTANCE can tell the two apart, so this asks
    // PostGIS — the same `geography` type and the same `ST_MakePoint(lng, lat)`
    // argument order `addresses.geo` is generated with — for the Barcelona to
    // Madrid distance, which is about 505 km.
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });

    const madrid = alias(cities, 'madrid');
    const [measured] = await getDb()
      .select({
        // `ST_MakePoint(longitude, latitude)` — X then Y, the same argument
        // order `addresses.geo` is generated with.
        correct: sql<number>`ST_Distance(
          ST_MakePoint(${cities.longitude}, ${cities.latitude})::geography,
          ST_MakePoint(${madrid.longitude}, ${madrid.latitude})::geography
        )`,
        // The SAME query with the arguments swapped — the mistake this test
        // exists to catch — computed here rather than assumed, so the tolerance
        // below is known to be able to tell them apart. Without it a wide
        // enough band would pass either way and the check would be decoration.
        transposed: sql<number>`ST_Distance(
          ST_MakePoint(${cities.latitude}, ${cities.longitude})::geography,
          ST_MakePoint(${madrid.latitude}, ${madrid.longitude})::geography
        )`,
      })
      .from(cities)
      .innerJoin(madrid, eq(madrid.id, madridId.toHexString()))
      .where(eq(cities.id, barcelonaId.toHexString()));

    // Barcelona (41.39 N, 2.17 E) to Madrid (40.42 N, 3.70 W) is about 505 km.
    const minimumMetres = 490_000;
    const maximumMetres = 520_000;
    expect(Number(measured.correct)).toBeGreaterThan(minimumMetres);
    expect(Number(measured.correct)).toBeLessThan(maximumMetres);

    // Transposed, the two land in the Horn of Africa — Barcelona at 2.17 N
    // 41.39 E and Madrid at 3.70 S 40.42 E — which measures about 658 km.
    // Nowhere near as far apart as it sounds, and that is the point of
    // measuring it rather than assuming: the gap is 150 km, so a tolerance
    // band any wider than the one above would admit both and this test would
    // be decoration. Asserted as "outside the accepted band" rather than
    // against a second magic number, because the band IS the discriminator.
    expect(Number(measured.transposed)).toBeGreaterThan(maximumMetres);
  });

  it('a plain copy leaves a row somebody else wrote WRONG alone', async () => {
    // The incident this mode was added for, in miniature: a previous copy loaded
    // the cities with no cover (it had no `images` rows to point at), so every
    // row is present, `ON CONFLICT DO NOTHING` skips all of them, and
    // `/api/cities/popular` — whose whole filter is `cover_image_id is not
    // null` — keeps answering empty.
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });
    await getDb()
      .update(cities)
      .set({ coverImageId: null })
      .where(eq(cities.id, barcelonaId.toHexString()));

    await expect(
      runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' }),
    ).rejects.toThrow(/Verification failed for cities/);

    const [barcelona] = await getDb()
      .select()
      .from(cities)
      .where(eq(cities.id, barcelonaId.toHexString()));
    expect(barcelona.coverImageId).toBeNull();
  });

  it('--reconcile repairs it, and restores the historical updated_at rather than stamping now', async () => {
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });
    // `set()` also fires drizzle's `$onUpdate`, so this moves `updated_at` to
    // now — which is exactly the second thing the repair has to undo, and the
    // reason `reconcilePlan` writes every column rather than only the wrong one.
    await getDb()
      .update(cities)
      .set({ coverImageId: null, propertiesCount: 0 })
      .where(eq(cities.id, barcelonaId.toHexString()));

    const report = await runGeoBackfill({
      mongo: mongoDatabase(),
      database: getDb(),
      mode: 'reconcile',
    });

    const citiesReport = report.reconciled.find((entry) => entry.table === 'cities');
    expect(citiesReport).toMatchObject({ compared: 3, updated: 1 });
    expect(citiesReport?.columns).toEqual({
      coverImageId: 1,
      propertiesCount: 1,
      updatedAt: 1,
    });
    // Untouched tables are reported, and report no repair — so "it updated
    // something" cannot be confused with "it rewrote everything".
    expect(report.reconciled.find((entry) => entry.table === 'countries')).toMatchObject({
      compared: 1,
      updated: 0,
    });

    const [barcelona] = await getDb()
      .select()
      .from(cities)
      .where(eq(cities.id, barcelonaId.toHexString()));
    expect(barcelona.coverImageId).toBe(cityImageId.toHexString());
    expect(barcelona.propertiesCount).toBe(137);
    expect(barcelona.updatedAt).toEqual(new Date('2025-01-03T00:00:00.000Z'));
  });

  it('repairs a row whose ONLY wrong column is the cover, without stamping updated_at', async () => {
    // The discriminating fixture. In the case above `updated_at` had ALSO
    // drifted, so writing "only the columns that differ" would have written it
    // anyway and the two rules are indistinguishable. Here `updated_at` is put
    // back to the source value, so `cover_image_id` is the single difference —
    // and an UPDATE that names only it lets drizzle's `$onUpdate` stamp
    // `updated_at` with the moment of the repair, replacing the historical value
    // the migration exists to preserve.
    await seed();
    await runGeoBackfill({ mongo: mongoDatabase(), database: getDb(), mode: 'copy' });
    const sourceUpdatedAt = new Date('2025-01-03T00:00:00.000Z');
    await getDb()
      .update(cities)
      .set({ coverImageId: null, updatedAt: sourceUpdatedAt })
      .where(eq(cities.id, barcelonaId.toHexString()));

    const report = await runGeoBackfill({
      mongo: mongoDatabase(),
      database: getDb(),
      mode: 'reconcile',
    });
    expect(report.reconciled.find((entry) => entry.table === 'cities')?.columns).toEqual({
      coverImageId: 1,
    });

    const [barcelona] = await getDb()
      .select()
      .from(cities)
      .where(eq(cities.id, barcelonaId.toHexString()));
    expect(barcelona.coverImageId).toBe(cityImageId.toHexString());
    expect(barcelona.updatedAt).toEqual(sourceUpdatedAt);
  });

  it('--reconcile inserts what is missing as well as repairing what is wrong', async () => {
    await seed();
    const report = await runGeoBackfill({
      mongo: mongoDatabase(),
      database: getDb(),
      mode: 'reconcile',
    });
    expect(report.copied.map((entry) => [entry.table, entry.inserted])).toEqual([
      ['images', 1],
      ['countries', 1],
      ['regions', 1],
      ['cities', 3],
      ['neighborhoods', 1],
    ]);
    expect(report.reconciled.every((entry) => entry.updated === 0)).toBe(true);
  });

  it('loadSource takes only the geo images, and resolves only referenced covers', async () => {
    await seed();
    const source = await loadSource(mongoDatabase());
    expect(source.documents.images.map((document: SourceDocument) => String(document._id))).toEqual([
      cityImageId.toHexString(),
    ]);
    // The one cover that resolves; the dangling one is deliberately absent, and
    // that absence is what the mapper reads as "broken pointer".
    expect([...source.cover.existingImageIds]).toEqual([cityImageId.toHexString()]);
    expect(buildRows(source).resolutions[GEO_RESOLUTIONS.COVER_DANGLING]).toBe(1);
  });
});
