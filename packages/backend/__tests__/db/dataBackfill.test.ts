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
  toAddressRow,
  toAgencyRow,
  toProfileChatMessageRows,
  toProfileRow,
  toPropertyImageRows,
  toPropertyRow,
  toPropertyWindowRows,
} from '../../db/backfill/dataPlan';
import { RowAuditor, UniqueKeyAuditor, type CandidateRow } from '../../db/backfill/rowAudit';
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
const PARIS = { lng: 2.3522, lat: 48.8566 };

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
    Paris: oid(),
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
    const point = name === 'Barcelona' ? BARCELONA : name === 'Madrid' ? MADRID : PARIS;
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
    const paris = addressDocument(geo, 'Paris', PARIS, { street: 'Rue de Rivoli', postal_code: '75001', countryCode: 'FR' });
    await database.collection('addresses').insertMany([barcelona, madrid, paris]);

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
    const parisian = propertyDocument(paris._id as mongoose.Types.ObjectId);
    await database.collection('properties').insertMany([withPhoto, withoutPhoto, parisian]);

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
    await database.collection('addresses').insertMany([
      addressDocument(geo, 'Barcelona', BARCELONA),
      addressDocument(geo, 'Madrid', MADRID, { street: 'Gran Vía' }),
      addressDocument(geo, 'Paris', PARIS, { street: 'Rue de Rivoli', countryCode: 'FR' }),
    ]);

    await runDataBackfill({
      mongo: database,
      database: getDb(),
      mode: 'copy',
      sampleSize: 5,
      only: ['images', 'addresses'],
    });

    const geometry = await checkGeometry(getDb());
    expect(geometry.centroidSamples).toBe(3);
    expect(geometry.centroidOverLimit).toBe(0);

    const [toMadrid, toParis] = geometry.pairs;
    expect(toMadrid.withinTolerance).toBe(true);
    expect(toMadrid.measuredMetres).toBeGreaterThan(400_000);
    expect(toMadrid.measuredMetres).toBeLessThan(600_000);
    expect(toParis.withinTolerance).toBe(true);
    expect(toParis.measuredMetres).toBeGreaterThan(700_000);
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
    await database.collection('addresses').insertMany([
      address,
      addressDocument(geo, 'Madrid', MADRID, { street: 'Gran Vía' }),
      addressDocument(geo, 'Paris', PARIS, { street: 'Rue de Rivoli', countryCode: 'FR' }),
    ]);
    await database.collection('properties').insertOne(
      propertyDocument(address._id as mongoose.Types.ObjectId),
    );

    const first = await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });
    const second = await runDataBackfill({ mongo: database, database: getDb(), mode: 'copy', sampleSize: 5 });

    const inserted = (report: typeof first, collection: string) =>
      report.copied.find((entry) => entry.collection === collection)?.inserted ?? {};
    expect(inserted(first, 'addresses').addresses).toBe(3);
    // `ON CONFLICT DO NOTHING` still reports the batch it SENT; what proves
    // convergence is that verification passes and the table did not grow.
    expect(second.verified.every((entry) => entry.missing === 0)).toBe(true);

    const [row] = await getDb().select({ total: sql<number>`count(*)::int` }).from(addresses);
    expect(row.total).toBe(3);
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

  it('writes both calendars into one table, under their own scopes', async () => {
    const geo = await seedAndCopyGeo();
    const database = mongoDatabase();
    const address = addressDocument(geo, 'Barcelona', BARCELONA);
    await database.collection('addresses').insertMany([
      address,
      addressDocument(geo, 'Madrid', MADRID, { street: 'Gran Vía' }),
      addressDocument(geo, 'Paris', PARIS, { street: 'Rue de Rivoli', countryCode: 'FR' }),
    ]);
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
