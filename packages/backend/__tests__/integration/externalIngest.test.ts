/**
 * External listing ingest path (fixture provider -> IngestionService).
 *
 * Proves the done criteria against a REAL Postgres:
 *  - a fixture-provider job produces `is_external` listings (no owner,
 *    `status: 'published'`, always a `source_url`);
 *  - every source image is RE-HOSTED through the real Sharp/image pipeline into
 *    an `images` row, and the `property_images.url` points at OUR host — the
 *    foreign portal CDN URL is NEVER used at runtime;
 *  - re-ingesting the same `(source, sourceId)` UPSERTS (no duplicate listing,
 *    no re-fetch of already-hosted media). That uniqueness is now enforced by
 *    `properties_source_source_id_key`, a PARTIAL unique index, rather than by
 *    the upsert probe alone — so a bug that produced a second row would fail the
 *    write rather than silently duplicating.
 *
 * The remote-image fetch is stubbed with a tiny real PNG so the Sharp pipeline
 * runs for real without any network I/O. Object storage is unconfigured in the
 * test env, so the pipeline persists variants to the self-hosted local store;
 * those files are cleaned up afterwards.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  FixtureProvider,
  ListingValidationError,
  createFetchRuntime,
} from '@homiio/listing-providers';
import type { FetchContext, ListingProvider } from '@homiio/listing-providers';
import { OfferingType, PropertyType, type NormalizedListing } from '@homiio/shared-types';

import { IngestionService } from '../../services/ingestion/IngestionService';
import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import type { ImageBufferInput } from '../../services/imageUploadService';

import { and, eq } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { images, properties, propertyImages } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import { resetGeoTables } from '../helpers/postgresGeoFixtures';
import { assertFound } from '../helpers/assertFound';

// A 1x1 transparent PNG — a real, Sharp-decodable image with no network fetch.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const LOCAL_IMAGE_STORE_DIR = path.join(__dirname, '..', '..', '.local-image-store');
const FIRST_SOURCE_ID = 'fixture-bcn-0001';
const FIRST_SOURCE_URL = 'https://fixtures.homiio.com/es/barcelona/fixture-bcn-0001';

// The CONTRACT, not the class — `FixtureProvider.fetch` omits the `ctx`
// parameter `ListingProvider` declares, and ingest calls it with one.
const provider: ListingProvider = new FixtureProvider();
const ctx: FetchContext = { runtime: createFetchRuntime() };

const fetchImage = jest.fn(
  async (): Promise<ImageBufferInput> => ({ buffer: ONE_BY_ONE_PNG, mimetype: 'image/png' }),
);

function buildIngestionService(dedupeEnabled = false): IngestionService {
  const mediaIngest = new ExternalMediaIngest({ fetchImage });
  return new IngestionService({ mediaIngest, dedupeEnabled });
}

async function normalizeAll(): Promise<NormalizedListing[]> {
  const listings: NormalizedListing[] = [];
  for await (const ref of provider.discover({ provider: 'fixture', market: 'ES' })) {
    listings.push(provider.normalize(await provider.fetch(ref, ctx)));
  }
  return listings;
}

/** How many listings this source has, by its portal identity. */
async function countBySource(source: string, sourceId?: string): Promise<number> {
  const rows = await getDb()
    .select({ id: properties.id })
    .from(properties)
    .where(
      sourceId === undefined
        ? eq(properties.source, source as 'fixture')
        : and(eq(properties.source, source as 'fixture'), eq(properties.sourceId, sourceId)),
    );
  return rows.length;
}

async function countExternal(): Promise<number> {
  const rows = await getDb()
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.isExternal, true));
  return rows.length;
}

/**
 * The ingested listing in its WIRE shape, read back through the same repository
 * the catalogue endpoints use.
 *
 * Deliberately not a raw row read: asserting on the serialized body is what
 * makes "a listing the ingest just wrote is immediately visible to the
 * catalogue" a property of this test rather than a hope, and it keeps the
 * assertions in the nested vocabulary (`longTermRent.monthlyAmount`,
 * `externalContact`) the API actually serves.
 */
async function readIngested(
  source: string,
  sourceId: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await getDb()
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.source, source as 'fixture'), eq(properties.sourceId, sourceId)))
    .limit(1);
  if (!row) return null;
  const hydrated = await findPropertyById(row.id);
  return hydrated ? serializeProperty(hydrated) : null;
}

/** The canonical `images` rows the pipeline persisted for a listing. */
async function imageRowsFor(propertyId: string): Promise<{ id: string }[]> {
  return getDb()
    .select({ id: images.id })
    .from(images)
    .where(and(eq(images.entityType, 'property'), eq(images.entityId, propertyId)));
}

beforeEach(async () => {
  // Every test in this file ingests the SAME fixture ids, and Postgres — unlike
  // the per-test in-memory Mongo this replaced — persists for the whole worker.
  // Without this reset the second test would meet `properties_source_source_id_key`
  // rather than a clean table, and would fail for a reason unrelated to what it
  // asserts.
  await resetGeoTables();
  fetchImage.mockClear();
});

afterAll(async () => {
  await fs.rm(LOCAL_IMAGE_STORE_DIR, { recursive: true, force: true });
});

describe('external listing ingest (fixture -> IngestionService)', () => {
  it('creates isExternal, published Properties with re-hosted Image refs', async () => {
    const ingestion = buildIngestionService();
    const listings = await normalizeAll();

    const results = [];
    for (const listing of listings) {
      results.push(await ingestion.ingest(listing));
    }

    expect(results).toHaveLength(listings.length);
    expect(results.every((result) => result.status === 'created')).toBe(true);

    expect(await countExternal()).toBe(listings.length);

    const property = await readIngested('fixture', FIRST_SOURCE_ID);
    assertFound(property, 'property');
    expect(property.status).toBe('published');
    expect(property.isExternal).toBe(true);
    expect(property.sourceUrl).toBe(FIRST_SOURCE_URL);
    // Aggregator listings are ownerless.
    expect(property.oxyUserId).toBeFalsy();
    expect(property.offerings).toEqual(['long_term_rent']);
    expect((property.longTermRent as { monthlyAmount?: number }).monthlyAmount).toBe(1450);
    expect(property.expiresAt).toBeTruthy();

    // Two source images for the first fixture, each re-hosted.
    const propertyImagesServed = property.images as {
      imageId: string;
      url: string;
      isPrimary?: boolean;
    }[];
    expect(propertyImagesServed).toHaveLength(2);
    expect(propertyImagesServed.filter((image) => image.isPrimary)).toHaveLength(1);
    for (const image of propertyImagesServed) {
      expect(image.imageId).toBeTruthy();
      expect(typeof image.url).toBe('string');
      // Runtime URL points at OUR host, never the foreign portal CDN.
      expect(image.url).not.toContain('unsplash.com');
      expect(image.url.startsWith('https://api.homiio.test')).toBe(true);
    }

    // The canonical `images` rows were persisted for this listing.
    expect(await imageRowsFor(String(property.id))).toHaveLength(2);

    // Each remote image was fetched exactly once across both fixtures (2 + 1).
    expect(fetchImage).toHaveBeenCalledTimes(3);
  });

  it('upserts on re-ingest without duplicating the property or re-fetching media', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();

    const created = await ingestion.ingest(first);
    expect(created.status).toBe('created');
    expect(fetchImage).toHaveBeenCalledTimes(2);

    const updated = await ingestion.ingest(first);
    expect(updated.status).toBe('updated');
    expect(updated.propertyId).toBe(created.propertyId);

    // No second listing, and the already-hosted media is not re-fetched.
    expect(await countBySource('fixture', FIRST_SOURCE_ID)).toBe(1);
    expect(fetchImage).toHaveBeenCalledTimes(2);

    const property = await readIngested('fixture', FIRST_SOURCE_ID);
    assertFound(property, 'property');
    expect(property.images).toHaveLength(2);
    expect(await imageRowsFor(String(property.id))).toHaveLength(2);

    // And the photo rows themselves were not duplicated by the re-ingest — the
    // read above hydrates from `property_images`, so a stale second set would
    // have shown up as four.
    const photoRows = await getDb()
      .select({ id: propertyImages.id })
      .from(propertyImages)
      .where(eq(propertyImages.propertyId, String(property.id)));
    expect(photoRows).toHaveLength(2);
  });

  it('rejects a listing missing a sourceUrl (CTA is mandatory)', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();
    const withoutUrl: NormalizedListing = { ...first, sourceUrl: '' };
    await expect(ingestion.ingest(withoutUrl)).rejects.toThrow(/sourceUrl/);
  });

  it('persists externalContact when the normalized listing carries contact', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();
    const withContact: NormalizedListing = {
      ...first,
      contact: {
        phone: '+34612345678',
        email: 'agent@example.com',
        whatsapp: '34612345678',
        name: 'María López',
        agencyName: 'Agencia Demo SL',
      },
    };

    await ingestion.ingest(withContact);
    const property = await readIngested('fixture', FIRST_SOURCE_ID);
    expect(property?.externalContact).toEqual({
      phone: '+34612345678',
      email: 'agent@example.com',
      whatsapp: '34612345678',
      name: 'María López',
      agencyName: 'Agencia Demo SL',
    });
  });

  it('updates externalContact on re-ingest without duplicating media', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();
    const initial: NormalizedListing = {
      ...first,
      contact: { phone: '+34111111111', name: 'First Agent' },
    };
    await ingestion.ingest(initial);
    expect(fetchImage).toHaveBeenCalledTimes(2);

    const updatedContact: NormalizedListing = {
      ...first,
      contact: {
        phone: '+34622222222',
        email: 'updated@example.com',
        agencyName: 'Updated Agency',
        kind: 'agency',
      },
    };
    const result = await ingestion.ingest(updatedContact);
    expect(result.status).toBe('updated');
    expect(fetchImage).toHaveBeenCalledTimes(2);

    const property = await readIngested('fixture', FIRST_SOURCE_ID);
    expect(property?.externalContact).toEqual({
      phone: '+34622222222',
      email: 'updated@example.com',
      agencyName: 'Updated Agency',
      kind: 'agency',
    });
  });

  it('classifies and persists listingFlags from the description free text', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();
    const withFlags: NormalizedListing = {
      ...first,
      description:
        'Se alquilan habitaciones en piso compartido, exclusivamente para estudiantes. ' +
        'Solo chicas. No se admiten mascotas. Alquiler de temporada de septiembre a junio.',
    };

    await ingestion.ingest(withFlags);
    const property = await readIngested('fixture', FIRST_SOURCE_ID);
    expect(property?.listingFlags).toMatchObject({
      roomNotFullUnit: true,
      studentsOnly: true,
      genderRestricted: true,
      noPets: true,
      temporaryOnly: true,
    });
    // Flags that did not fire stay absent. That is a THREE-state column, not a
    // sparse subdocument: `true` (the classifier fired), `false` (it looked and
    // said no) and NULL (it never ran) are distinct, and the serializer omits
    // the null ones — so `toBeUndefined` here is asserting the null branch.
    const listingFlags = property?.listingFlags as Record<string, unknown>;
    expect(listingFlags.agencyFeePayable).toBeUndefined();
    expect(listingFlags.noDSS).toBeUndefined();
  });

  it('omits listingFlags entirely when the description trips no rule', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();
    const plain: NormalizedListing = {
      ...first,
      description: 'Bright two-bedroom flat with a lift, a balcony and a modern kitchen.',
    };

    await ingestion.ingest(plain);
    const property = await readIngested('fixture', FIRST_SOURCE_ID);
    // No restriction flag fired; only a language may be detected (or nothing).
    const listingFlags = (property?.listingFlags ?? {}) as Record<string, unknown>;
    expect(listingFlags.roomNotFullUnit).toBeUndefined();
    expect(listingFlags.studentsOnly).toBeUndefined();
    expect(listingFlags.temporaryOnly).toBeUndefined();
  });

  it('rejects partner-style absurd monthly rent at the ingest gate (11628 EUR)', async () => {
    const ingestion = buildIngestionService();
    const absurdListing: NormalizedListing = {
      source: 'blueground',
      sourceId: 'bcn-1549599p',
      sourceUrl: 'https://www.theblueground.com/p/furnished-apartments/bcn-1549599p',
      address: { street: 'Carrer de Simó Oller', city: 'Barcelona', countryCode: 'ES' },
      type: PropertyType.APARTMENT,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 11_628, currency: 'EUR' },
      bedrooms: 1,
      remoteImages: [{ url: 'https://example.com/photo.jpg', isPrimary: true }],
      status: 'published',
    };

    await expect(ingestion.ingest(absurdListing)).rejects.toBeInstanceOf(ListingValidationError);
    expect(await countBySource('blueground', 'bcn-1549599p')).toBe(0);
    expect(fetchImage).not.toHaveBeenCalled();
  });

  it('skips a re-listing of the same unit under a new sourceId (dedup fingerprint)', async () => {
    // Dedup is opt-in (off by default); enable it explicitly for this test.
    const ingestion = buildIngestionService(true);
    // A substantial, shared agency description (>= 40 tokens) so the listings are
    // dedup-eligible; the tail word differs so Jaccard is ~0.97 (> 0.95 floor).
    const shared = Array.from({ length: 60 }, (_, i) => `palabra${String(i).padStart(3, '0')}`).join(' ');
    const makeListing = (sourceId: string, tail: string): NormalizedListing => ({
      source: 'pisos',
      sourceId,
      sourceUrl: `https://www.pisos.com/alquilar/piso-${sourceId}/`,
      address: {
        street: 'Carrer de Provença',
        city: 'Barcelona',
        countryCode: 'ES',
        coordinates: { lat: 41.3925, lng: 2.1649 },
      },
      type: PropertyType.APARTMENT,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1750, currency: 'EUR' },
      description: `${shared} ${tail}`,
      bedrooms: 2,
      bathrooms: 1,
      squareFootage: 63,
      remoteImages: [],
      status: 'published',
    });

    const first = await ingestion.ingest(makeListing('relist-a', 'alpha'));
    expect(first.status).toBe('created');

    const second = await ingestion.ingest(makeListing('relist-b', 'beta'));
    expect(second.status).toBe('skipped');
    expect(second.duplicateOf).toBe(first.propertyId);

    // The re-listing is NOT persisted; only the original survives.
    expect(await countBySource('pisos', 'relist-b')).toBe(0);
    expect(await countBySource('pisos', 'relist-a')).toBe(1);

    // A genuinely different unit (different price) is still created normally.
    const different = await ingestion.ingest({
      ...makeListing('relist-c', 'gamma'),
      longTermRent: { monthlyAmount: 2400, currency: 'EUR' },
    });
    expect(different.status).toBe('created');
  });
});
