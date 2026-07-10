/**
 * City cover sync + popular cities filter.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import imageUploadService from '../../services/imageUploadService';
import { ensureCover, syncCovers, syncMissingCovers } from '../../services/cityCoverSyncService';
import cityRoutes from '../../routes/cities';

const { Country, Region, City, Address, Property, Image } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

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
  app.use('/api/cities', cityRoutes());
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

function mockWikimediaFetch(): void {
  (global as { fetch: typeof originalFetch }).fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('commons.wikimedia.org/w/api.php')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
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
        }),
      };
    }
    if (url === WIKIMEDIA_IMAGE_URL) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]).buffer,
      };
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as typeof fetch;
}

async function createImage(entityId: Types.ObjectId, entityType = 'property', isPrimary = true): Promise<{ _id: Types.ObjectId }> {
  return Image.create({
    entityType,
    entityId,
    keys: sampleVariantStrings(),
    urls: sampleVariantStrings(),
    format: 'webp',
    bytes: 1024,
    isPrimary,
    order: 0,
  });
}

interface GeoSeed {
  country: { _id: Types.ObjectId };
  region: { _id: Types.ObjectId };
  city: { _id: Types.ObjectId; name: string };
}

async function ensureSpainGeo(): Promise<{ country: { _id: Types.ObjectId }; region: { _id: Types.ObjectId } }> {
  const country = await Country.findOneAndUpdate(
    { code: 'ES' },
    { $setOnInsert: { code: 'ES', name: 'Spain', currency: 'EUR' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const region = await Region.findOneAndUpdate(
    { countryId: country._id, name: 'Catalonia' },
    { $setOnInsert: { countryId: country._id, name: 'Catalonia' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { country, region };
}

async function seedGeo(cityName: string, options: { coverImageId?: Types.ObjectId } = {}): Promise<GeoSeed> {
  const { country, region } = await ensureSpainGeo();
  const city = await City.create({
    countryId: country._id,
    regionId: region._id,
    name: cityName,
    currency: 'EUR',
    propertiesCount: 1,
    ...options,
  });
  return { country, region, city };
}

beforeEach(() => {
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
    const geo = await seedGeo('Valencia');
    const cityImageId = new Types.ObjectId();
    mockedCreateImageForEntity.mockResolvedValue({
      _id: cityImageId,
      entityType: 'city',
      entityId: geo.city._id,
      keys: sampleVariantStrings(),
      urls: sampleVariantStrings(),
    });

    await ensureCover(geo.city._id);

    expect(mockedCreateImageForEntity).toHaveBeenCalledWith(
      'city',
      geo.city._id,
      expect.objectContaining({ mimetype: 'image/jpeg' }),
      expect.objectContaining({
        isPrimary: true,
        order: 0,
        caption: 'Valencia, Spain',
        allowUnconfiguredStorage: true,
      }),
    );

    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(cityImageId));
    expect(updated?.imageIds?.map(String)).toEqual([String(cityImageId)]);
  });

  it('does not use listing image ids even when published properties exist', async () => {
    const geo = await seedGeo('Seville');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 2',
          postal_code: '41001',
          coordinates: { type: 'Point', coordinates: [-5.99, 37.39] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'seville-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/seville',
      images: [],
    });
    const listingImage = await createImage(property._id, 'property');
    property.images = [
      {
        imageId: listingImage._id,
        url: TEST_IMAGE_URL,
        isPrimary: true,
        order: 0,
        urls: sampleVariantStrings(),
      },
    ];
    await property.save();

    const cityImageId = new Types.ObjectId();
    mockedCreateImageForEntity.mockResolvedValue({
      _id: cityImageId,
      entityType: 'city',
      entityId: geo.city._id,
      keys: sampleVariantStrings(),
      urls: sampleVariantStrings(),
    });

    await ensureCover(geo.city._id);

    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(cityImageId));
    expect(String(updated?.coverImageId)).not.toBe(String(listingImage._id));
  });

  it('no-ops on a second call when a city-owned cover already exists', async () => {
    const geo = await seedGeo('Bilbao');
    const existingCityImage = await createImage(geo.city._id, 'city');
    await City.findByIdAndUpdate(geo.city._id, { coverImageId: existingCityImage._id });

    await ensureCover(geo.city._id);

    expect(mockedCreateImageForEntity).not.toHaveBeenCalled();
    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(existingCityImage._id));
  });

  it('replaces a property-linked cover when force is true', async () => {
    const geo = await seedGeo('Girona');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 5',
          postal_code: '17001',
          coordinates: { type: 'Point', coordinates: [2.82, 41.98] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'girona-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/girona',
      images: [],
    });
    const listingImage = await createImage(property._id, 'property');
    await City.findByIdAndUpdate(geo.city._id, { coverImageId: listingImage._id });

    const replacementCityImageId = new Types.ObjectId();
    mockedCreateImageForEntity.mockResolvedValue({
      _id: replacementCityImageId,
      entityType: 'city',
      entityId: geo.city._id,
      keys: sampleVariantStrings(),
      urls: sampleVariantStrings(),
    });

    await ensureCover(geo.city._id, { force: true });

    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(replacementCityImageId));
    expect(String(updated?.coverImageId)).not.toBe(String(listingImage._id));
  });

  it('replaces a property-linked cover without force', async () => {
    const geo = await seedGeo('Zaragoza');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 6',
          postal_code: '50001',
          coordinates: { type: 'Point', coordinates: [-0.88, 41.65] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'zaragoza-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/zaragoza',
      images: [],
    });
    const listingImage = await createImage(property._id, 'property');
    await City.findByIdAndUpdate(geo.city._id, { coverImageId: listingImage._id });

    const replacementCityImageId = new Types.ObjectId();
    mockedCreateImageForEntity.mockResolvedValue({
      _id: replacementCityImageId,
      entityType: 'city',
      entityId: geo.city._id,
      keys: sampleVariantStrings(),
      urls: sampleVariantStrings(),
    });

    await ensureCover(geo.city._id);

    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(replacementCityImageId));
  });

  it('skips implausible city names', async () => {
    const geo = await seedGeo('Penn Street');

    await ensureCover(geo.city._id);

    expect(mockedCreateImageForEntity).not.toHaveBeenCalled();
    const updated = await City.findById(geo.city._id).lean();
    expect(updated?.coverImageId).toBeUndefined();
  });
});

describe('cityCoverSyncService.syncCovers', () => {
  it('processes cities that have listings but no cover', async () => {
    const geo = await seedGeo('Bilbao');
    const cityImageId = new Types.ObjectId();
    mockedCreateImageForEntity.mockResolvedValue({
      _id: cityImageId,
      entityType: 'city',
      entityId: geo.city._id,
      keys: sampleVariantStrings(),
      urls: sampleVariantStrings(),
    });

    const processed = await syncCovers({ limit: 10, forceReplaceListingCovers: true });
    expect(processed).toBe(1);

    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(cityImageId));
    expect(mockedCreateImageForEntity).toHaveBeenCalledTimes(1);
  });

  it('replaces property-linked covers when forceReplaceListingCovers is true', async () => {
    const geo = await seedGeo('Granada');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 7',
          postal_code: '18001',
          coordinates: { type: 'Point', coordinates: [-3.6, 37.18] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'granada-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/granada',
      images: [],
    });
    const listingImage = await createImage(property._id, 'property');
    await City.findByIdAndUpdate(geo.city._id, { coverImageId: listingImage._id });

    const replacementCityImageId = new Types.ObjectId();
    mockedCreateImageForEntity.mockResolvedValue({
      _id: replacementCityImageId,
      entityType: 'city',
      entityId: geo.city._id,
      keys: sampleVariantStrings(),
      urls: sampleVariantStrings(),
    });

    const processed = await syncMissingCovers({ limit: 10 });
    expect(processed).toBe(1);

    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(replacementCityImageId));
    expect(String(updated?.coverImageId)).not.toBe(String(listingImage._id));
  });
});

describe('GET /api/cities/:id/properties', () => {
  const app = buildApp();

  it('returns published properties for a city without populating profileId', async () => {
    const geo = await seedGeo('London');
    const address = await Address.create({
      countryId: geo.country._id,
      regionId: geo.region._id,
      cityId: geo.city._id,
      countryCode: 'ES',
      street: 'Test Street 1',
      postal_code: 'SW1A 1AA',
      coordinates: { type: 'Point', coordinates: [-0.12, 51.5] },
    });
    const property = await Property.create({
      addressId: address._id,
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1800, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'london-city-props-1',
      sourceUrl: 'https://fixtures.homiio.com/london',
      images: [],
    });

    const res = await request(app)
      .get(`/api/cities/${geo.city._id}/properties?limit=8`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.city.name).toBe('London');
    expect(res.body.data.properties).toHaveLength(1);
    expect(String(res.body.data.properties[0]._id)).toBe(String(property._id));
    expect(res.body.data.pagination.total).toBe(1);
  });

  it('returns an empty list when the city has no addresses', async () => {
    const geo = await seedGeo('Emptyville');

    const res = await request(app)
      .get(`/api/cities/${geo.city._id}/properties?limit=8`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.properties).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });
});

describe('GET /api/cities/popular', () => {
  const app = buildApp();

  it('excludes cities without a cover or with implausible names', async () => {
    const withCover = await seedGeo('Madrid');
    const coverImage = await createImage(withCover.city._id, 'city');
    await City.findByIdAndUpdate(withCover.city._id, { coverImageId: coverImage._id });

    await seedGeo('Penn Street');
    await seedGeo('Girona');

    const res = await request(app).get('/api/cities/popular?limit=10').expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Madrid');
    expect(res.body.data[0].coverImageId.urls).toBeDefined();
  });

  it('excludes cities whose cover image failed to populate', async () => {
    const geo = await seedGeo('Barcelona', {
      coverImageId: new Types.ObjectId(),
    });

    const res = await request(app).get('/api/cities/popular?limit=10').expect(200);

    expect(res.body.data.find((city: { name: string }) => city.name === geo.city.name)).toBeUndefined();
  });
});
