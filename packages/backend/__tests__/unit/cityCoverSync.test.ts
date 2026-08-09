/**
 * City cover sync, and the city→properties read — both against a REAL Postgres.
 *
 * ## The whole file seeds ONE store now
 *
 * `cityCoverSyncService` was the last city module on Mongo, and it could not
 * move alone: it does not only WRITE a city, it creates the IMAGE first through
 * `imageUploadService.createImageForEntity`, and `cities.cover_image_id` is a
 * real foreign key to `images.id` — porting the city half while images still
 * minted Mongo `_id`s would have made every cover write a guaranteed `23503`.
 * Both halves moved together, so the split this file used to document (a ported
 * READ seeded in Postgres beside an unported WRITE seeded in Mongo) is gone.
 *
 * ## What the foreign key changed about these assertions
 *
 * `createImageForEntity` is mocked, so nothing here inserts a real `images`
 * row — which means a mocked id cannot simply be asserted onto
 * `cities.cover_image_id` the way a Mongo ObjectId could. Every case therefore
 * seeds a REAL image row (`seedCityImage`) and returns its id from the mock.
 * That is not a workaround: it is the constraint doing its job, and a test that
 * dodged it with a random id would assert a write production cannot perform.
 *
 * `imageIds[]` is gone with the Mongo document — the membership it denormalized
 * is `images.(entity_type, entity_id)`, which `createImageForEntity` writes —
 * so the old `expect(imageIds).toEqual([...])` has no counterpart and is not
 * replaced by a weaker assertion.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import imageUploadService from '../../services/imageUploadService';
import { ensureCover, syncCovers, syncMissingCovers } from '../../services/cityCoverSyncService';
import publicRoutes from '../../routes/public';

import { getDb } from '../../db/postgres';
import { cities, images } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import {
  objectIdHex,
  resetGeoTables,
  seedAddress,
  seedCityImage,
  seedGeoChain,
  seedProperty,
  seedPropertyImage,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

jest.mock('../../services/imageUploadService', () => ({
  __esModule: true,
  default: {
    createImageForEntity: jest.fn(),
    isStorageConfigured: jest.fn(() => false),
    resolveStoredImageUrl: jest.fn((url: string) => url),
  },
}));

const TEST_IMAGE_URL = 'https://api.homiio.test/api/images/file/test/medium.webp';
const WIKIMEDIA_IMAGE_URL =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a3/example.jpg/1280px-example.jpg';

const originalFetch = global.fetch;
const mockedCreateImageForEntity = imageUploadService.createImageForEntity as jest.Mock;
const mockedIsStorageConfigured = imageUploadService.isStorageConfigured as jest.Mock;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // The router production actually serves these paths on: `publicRoutes()` is
  // mounted at `/api` in server.ts, so `/cities/:id` here is the real wiring,
  // route-declaration order included.
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

function sampleVariantStrings(): {
  original: string;
  small: string;
  medium: string;
  large: string;
} {
  return {
    original: TEST_IMAGE_URL,
    small: TEST_IMAGE_URL,
    medium: TEST_IMAGE_URL,
    large: TEST_IMAGE_URL,
  };
}

/**
 * Real `Response` objects rather than look-alikes. The stand-ins this replaced
 * needed an `as typeof fetch` cast to be installed as the global at all, and a
 * cast is exactly what stops a mock drifting from `fetch` being noticed.
 */
function mockWikimediaFetch(): void {
  (global as { fetch: typeof originalFetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('commons.wikimedia.org/w/api.php')) {
      return Response.json({
        query: {
          pages: {
            '12345': {
              imageinfo: [
                {
                  url: WIKIMEDIA_IMAGE_URL,
                  thumburl: WIKIMEDIA_IMAGE_URL,
                  mime: 'image/jpeg',
                },
              ],
            },
          },
        },
      });
    }
    if (url === WIKIMEDIA_IMAGE_URL) {
      return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  });
}

/** Insert an `entityType: 'property'` image row and return its id. */
async function seedListingImage(propertyId: string): Promise<string> {
  const [image] = await getDb()
    .insert(images)
    .values({
      id: objectIdHex(),
      entityType: 'property',
      entityId: propertyId,
      keysOriginal: 'listing/o.jpg',
      keysSmall: 'listing/s.webp',
      keysMedium: 'listing/m.webp',
      keysLarge: 'listing/l.webp',
      urlsOriginal: TEST_IMAGE_URL,
      urlsSmall: TEST_IMAGE_URL,
      urlsMedium: TEST_IMAGE_URL,
      urlsLarge: TEST_IMAGE_URL,
      format: 'webp',
      bytes: 1024,
      isPrimary: true,
    })
    .returning({ id: images.id });
  return image.id;
}

/**
 * Point `createImageForEntity` at a REAL `images` row.
 *
 * The mock has to return an id that exists, because the service writes it into
 * `cities.cover_image_id`, which references `images.id`. Returning a random id
 * would fail with a `23503` — correctly.
 */
function mockCreatesCityImage(cityId: string, imageId: string): void {
  mockedCreateImageForEntity.mockResolvedValue({
    id: imageId,
    entityType: 'city',
    entityId: cityId,
    keys: sampleVariantStrings(),
    urls: sampleVariantStrings(),
    format: 'webp',
    bytes: 1024,
  });
}

/** The city's stored cover pointer, read back from the table. */
async function coverImageIdOf(cityId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ coverImageId: cities.coverImageId })
    .from(cities)
    .where(eq(cities.id, cityId))
    .limit(1);
  return row?.coverImageId ?? null;
}

/** A city with one published listing in it — what `syncCovers` selects on. */
async function seedCityWithListing(chain: GeoChain, sourceId: string): Promise<string> {
  const addressId = await seedAddress({ chain, street: `Carrer ${sourceId}` });
  return seedProperty({
    addressId,
    overrides: {
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 900,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId,
      sourceUrl: `https://fixtures.homiio.com/${sourceId}`,
    },
  });
}

beforeEach(async () => {
  await resetGeoTables();
  mockWikimediaFetch();
  mockedIsStorageConfigured.mockReturnValue(false);
  mockedCreateImageForEntity.mockReset();
});

afterEach(() => {
  (global as { fetch: typeof originalFetch }).fetch = originalFetch;
  jest.clearAllMocks();
});

describe('cityCoverSyncService.ensureCover', () => {
  it('stores a Wikimedia city image when the city has no cover', async () => {
    const chain = await seedGeoChain({ cityName: 'Valencia', propertiesCount: 1 });
    const cityImageId = await seedCityImage(chain.cityId);
    mockCreatesCityImage(chain.cityId, cityImageId);

    await ensureCover(chain.cityId);

    expect(mockedCreateImageForEntity).toHaveBeenCalledWith(
      'city',
      chain.cityId,
      expect.objectContaining({ mimetype: 'image/jpeg' }),
      expect.objectContaining({
        isPrimary: true,
        order: 0,
        caption: 'Valencia, Spain',
        allowUnconfiguredStorage: true,
      }),
    );

    expect(await coverImageIdOf(chain.cityId)).toBe(cityImageId);
  });

  it('does not use listing image ids even when published properties exist', async () => {
    const chain = await seedGeoChain({ cityName: 'Seville', propertiesCount: 1 });
    const propertyId = await seedCityWithListing(chain, 'seville-cover-1');
    await seedPropertyImage({ propertyId });
    const listingImageId = await seedListingImage(propertyId);

    const cityImageId = await seedCityImage(chain.cityId);
    mockCreatesCityImage(chain.cityId, cityImageId);

    await ensureCover(chain.cityId);

    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
    const cover = await coverImageIdOf(chain.cityId);
    expect(cover).toBe(cityImageId);
    expect(cover).not.toBe(listingImageId);
  });

  it('no-ops on a second call when a city-owned cover already exists', async () => {
    const chain = await seedGeoChain({ cityName: 'Bilbao', propertiesCount: 1 });
    const existingCityImageId = await seedCityImage(chain.cityId);
    await getDb()
      .update(cities)
      .set({ coverImageId: existingCityImageId })
      .where(eq(cities.id, chain.cityId));

    await ensureCover(chain.cityId);

    expect(mockedCreateImageForEntity).not.toHaveBeenCalled();
    expect(await coverImageIdOf(chain.cityId)).toBe(existingCityImageId);
  });

  it('replaces a property-linked cover when force is true', async () => {
    const chain = await seedGeoChain({ cityName: 'Girona', propertiesCount: 1 });
    const propertyId = await seedCityWithListing(chain, 'girona-cover-1');
    const listingImageId = await seedListingImage(propertyId);
    await getDb()
      .update(cities)
      .set({ coverImageId: listingImageId })
      .where(eq(cities.id, chain.cityId));

    const replacementId = await seedCityImage(chain.cityId);
    mockCreatesCityImage(chain.cityId, replacementId);

    await ensureCover(chain.cityId, { force: true });

    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
    const cover = await coverImageIdOf(chain.cityId);
    expect(cover).toBe(replacementId);
    expect(cover).not.toBe(listingImageId);
  });

  it('replaces a property-linked cover without force', async () => {
    const chain = await seedGeoChain({ cityName: 'Zaragoza', propertiesCount: 1 });
    const propertyId = await seedCityWithListing(chain, 'zaragoza-cover-1');
    const listingImageId = await seedListingImage(propertyId);
    await getDb()
      .update(cities)
      .set({ coverImageId: listingImageId })
      .where(eq(cities.id, chain.cityId));

    const replacementId = await seedCityImage(chain.cityId);
    mockCreatesCityImage(chain.cityId, replacementId);

    await ensureCover(chain.cityId);

    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
    expect(await coverImageIdOf(chain.cityId)).toBe(replacementId);
  });

  it('skips implausible city names', async () => {
    const chain = await seedGeoChain({ cityName: 'Penn Street', propertiesCount: 1 });

    await ensureCover(chain.cityId);

    expect(mockedCreateImageForEntity).not.toHaveBeenCalled();
    expect(await coverImageIdOf(chain.cityId)).toBeNull();
  });
});

describe('cityCoverSyncService.syncCovers', () => {
  it('processes cities that have listings but no cover', async () => {
    const chain = await seedGeoChain({ cityName: 'Bilbao', propertiesCount: 1 });
    const cityImageId = await seedCityImage(chain.cityId);
    mockCreatesCityImage(chain.cityId, cityImageId);

    const processed = await syncCovers({ limit: 10, forceReplaceListingCovers: true });
    expect(processed).toBe(1);

    expect(await coverImageIdOf(chain.cityId)).toBe(cityImageId);
    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
  });

  it('replaces property-linked covers when forceReplaceListingCovers is true', async () => {
    const chain = await seedGeoChain({ cityName: 'Granada', propertiesCount: 1 });
    const propertyId = await seedCityWithListing(chain, 'granada-cover-1');
    const listingImageId = await seedListingImage(propertyId);
    await getDb()
      .update(cities)
      .set({ coverImageId: listingImageId })
      .where(eq(cities.id, chain.cityId));

    const replacementId = await seedCityImage(chain.cityId);
    mockCreatesCityImage(chain.cityId, replacementId);

    const processed = await syncMissingCovers({ limit: 10 });
    expect(processed).toBe(1);

    const cover = await coverImageIdOf(chain.cityId);
    expect(cover).toBe(replacementId);
    expect(cover).not.toBe(listingImageId);
  });

  it('leaves a city with NO listings alone, however missing its cover', async () => {
    // The selection predicate is `is_active AND properties_count > 0`, and a
    // fixture that always seeded a listing could not tell it from `is_active`
    // alone. This is the case that does.
    await seedGeoChain({ cityName: 'Toledo', propertiesCount: 0 });

    const processed = await syncCovers({ limit: 10, forceReplaceListingCovers: true });

    expect(processed).toBe(0);
    expect(mockedCreateImageForEntity).not.toHaveBeenCalled();
  });
});

describe('GET /api/cities/:id/properties', () => {
  const app = buildApp();

  it('returns published properties for a city', async () => {
    const chain = await seedGeoChain({ cityName: 'London', countryCode: 'GB-cover' });
    const addressId = await seedAddress({
      chain,
      street: 'Test Street 1',
      postalCode: 'SW1A 1AA',
      longitude: -0.12,
      latitude: 51.5,
    });
    const propertyId = await seedProperty({
      addressId,
      overrides: {
        type: PropertyType.APARTMENT,
        bedrooms: 2,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 1800,
        longTermRentCurrency: 'EUR',
        status: PropertyStatus.PUBLISHED,
        isExternal: true,
        source: 'fixture',
        sourceId: 'london-city-props-1',
        sourceUrl: 'https://fixtures.homiio.com/london',
      },
    });

    const res = await request(app)
      .get(`/api/cities/${chain.cityId}/properties?limit=8`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.city.name).toBe('London');
    expect(res.body.data.properties).toHaveLength(1);
    expect(String(res.body.data.properties[0].id)).toBe(propertyId);
    expect(res.body.data.properties[0]).not.toHaveProperty('_id');
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('returns an empty list when the city has no addresses', async () => {
    const chain = await seedGeoChain({ cityName: 'Emptyville', countryCode: 'XX-cover' });

    const res = await request(app)
      .get(`/api/cities/${chain.cityId}/properties?limit=8`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.properties).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });
});

/**
 * `GET /api/cities/popular` used to be asserted here, seeded through the Mongo
 * City model. It reads Postgres now, so those cases moved to
 * `__tests__/integration/cityEndpoints.test.ts`, where the fixtures are seeded
 * in the store the endpoint actually queries. They cover strictly more than
 * they did: the plausible-name filter, the missing-cover filter, AND a cover
 * whose image row has been deleted.
 */
