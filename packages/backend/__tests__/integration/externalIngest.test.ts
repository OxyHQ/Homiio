/**
 * External listing ingest path (fixture provider -> IngestionService).
 *
 * Proves the Phase-0 done criteria against the in-memory Mongo:
 *  - a fixture-provider job produces `isExternal` Properties (no `profileId`,
 *    `status: 'published'`, always a `sourceUrl`);
 *  - every source image is RE-HOSTED through the real Sharp/Image pipeline as an
 *    `Image` document, and the persisted `images[].url` points at OUR host — the
 *    foreign portal CDN URL is NEVER used at runtime;
 *  - re-ingesting the same `(source, sourceId)` UPSERTS (no duplicate Property,
 *    no re-fetch of already-hosted media).
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
import type { FetchContext } from '@homiio/listing-providers';
import { OfferingType, PropertyType, type NormalizedListing } from '@homiio/shared-types';

import { IngestionService } from '../../services/ingestion/IngestionService';
import { ExternalMediaIngest } from '../../services/ingestion/ExternalMediaIngest';
import type { ImageBufferInput } from '../../services/imageUploadService';

const { Property, Image } = require('../../models');

// A 1x1 transparent PNG — a real, Sharp-decodable image with no network fetch.
const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const LOCAL_IMAGE_STORE_DIR = path.join(__dirname, '..', '..', '.local-image-store');
const FIRST_SOURCE_ID = 'fixture-bcn-0001';
const FIRST_SOURCE_URL = 'https://fixtures.homiio.com/es/barcelona/fixture-bcn-0001';

const provider = new FixtureProvider();
const ctx: FetchContext = { runtime: createFetchRuntime() };

const fetchImage = jest.fn(
  async (_url: string): Promise<ImageBufferInput> => ({ buffer: ONE_BY_ONE_PNG, mimetype: 'image/png' }),
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

beforeEach(() => {
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

    const externalCount = await Property.countDocuments({ isExternal: true });
    expect(externalCount).toBe(listings.length);

    const property = await Property.findOne({ source: 'fixture', sourceId: FIRST_SOURCE_ID });
    expect(property).toBeTruthy();
    expect(property.status).toBe('published');
    expect(property.isExternal).toBe(true);
    expect(property.sourceUrl).toBe(FIRST_SOURCE_URL);
    // Aggregator listings are ownerless — no profileId is ever written.
    expect(property.profileId).toBeFalsy();
    expect(property.offerings).toEqual(['long_term_rent']);
    expect(property.longTermRent.monthlyAmount).toBe(1450);
    expect(property.expiresAt).toBeTruthy();

    // Two source images for the first fixture, each re-hosted.
    expect(property.images).toHaveLength(2);
    expect(property.images.filter((image: { isPrimary?: boolean }) => image.isPrimary)).toHaveLength(1);
    for (const image of property.images) {
      expect(image.imageId).toBeTruthy();
      expect(typeof image.url).toBe('string');
      // Runtime URL points at OUR host, never the foreign portal CDN.
      expect(image.url).not.toContain('unsplash.com');
      expect(image.url.startsWith('https://api.homiio.test')).toBe(true);
    }

    // The canonical Image documents were persisted for this property.
    const imageDocs = await Image.find({ entityType: 'property', entityId: property._id });
    expect(imageDocs).toHaveLength(2);

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

    // No second Property, and the already-hosted media is not re-fetched.
    expect(await Property.countDocuments({ source: 'fixture', sourceId: FIRST_SOURCE_ID })).toBe(1);
    expect(fetchImage).toHaveBeenCalledTimes(2);

    const property = await Property.findOne({ source: 'fixture', sourceId: FIRST_SOURCE_ID });
    expect(property.images).toHaveLength(2);
    const imageDocs = await Image.find({ entityType: 'property', entityId: property._id });
    expect(imageDocs).toHaveLength(2);
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
    const property = await Property.findOne({ source: 'fixture', sourceId: FIRST_SOURCE_ID }).lean();
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

    const property = await Property.findOne({ source: 'fixture', sourceId: FIRST_SOURCE_ID }).lean();
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
    const property = await Property.findOne({ source: 'fixture', sourceId: FIRST_SOURCE_ID }).lean();
    expect(property?.listingFlags).toMatchObject({
      roomNotFullUnit: true,
      studentsOnly: true,
      genderRestricted: true,
      noPets: true,
      temporaryOnly: true,
    });
    // Flags that did not fire stay absent (sparse).
    expect(property?.listingFlags?.agencyFeePayable).toBeUndefined();
    expect(property?.listingFlags?.noDSS).toBeUndefined();
  });

  it('omits listingFlags entirely when the description trips no rule', async () => {
    const ingestion = buildIngestionService();
    const [first] = await normalizeAll();
    const plain: NormalizedListing = {
      ...first,
      description: 'Bright two-bedroom flat with a lift, a balcony and a modern kitchen.',
    };

    await ingestion.ingest(plain);
    const property = await Property.findOne({ source: 'fixture', sourceId: FIRST_SOURCE_ID }).lean();
    // No restriction flag fired; only a language may be detected (or nothing).
    expect(property?.listingFlags?.roomNotFullUnit).toBeUndefined();
    expect(property?.listingFlags?.studentsOnly).toBeUndefined();
    expect(property?.listingFlags?.temporaryOnly).toBeUndefined();
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
    expect(await Property.countDocuments({ source: 'blueground', sourceId: 'bcn-1549599p' })).toBe(0);
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
    expect(await Property.countDocuments({ source: 'pisos', sourceId: 'relist-b' })).toBe(0);
    expect(await Property.countDocuments({ source: 'pisos', sourceId: 'relist-a' })).toBe(1);

    // A genuinely different unit (different price) is still created normally.
    const different = await ingestion.ingest({
      ...makeListing('relist-c', 'gamma'),
      longTermRent: { monthlyAmount: 2400, currency: 'EUR' },
    });
    expect(different.status).toBe('created');
  });
});
