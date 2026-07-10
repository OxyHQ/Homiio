/**
 * City cover sync + popular cities filter.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import { ensureCover, syncMissingCovers } from '../../services/cityCoverSyncService';
import cityRoutes from '../../routes/cities';

const { Country, Region, City, Address, Property, Image } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

const TEST_IMAGE_URL = 'https://api.homiio.test/api/images/file/test/medium.webp';

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

async function createImage(entityId: Types.ObjectId, isPrimary = true): Promise<{ _id: Types.ObjectId }> {
  return Image.create({
    entityType: 'property',
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

describe('cityCoverSyncService.ensureCover', () => {
  it('links the primary listing image id when the city has no cover', async () => {
    const geo = await seedGeo('Valencia');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 1',
          postal_code: '46001',
          coordinates: { type: 'Point', coordinates: [-0.37, 39.47] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'valencia-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/valencia',
      images: [],
    });
    const image = await createImage(property._id);
    property.images = [
      {
        imageId: image._id,
        url: TEST_IMAGE_URL,
        isPrimary: true,
        order: 0,
        urls: sampleVariantStrings(),
      },
    ];
    await property.save();

    await ensureCover(geo.city._id);

    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(image._id));
    expect(updated?.imageIds?.map(String)).toEqual([String(image._id)]);
  });

  it('no-ops on a second call (idempotent)', async () => {
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
    const firstImage = await createImage(property._id);
    property.images = [
      {
        imageId: firstImage._id,
        url: TEST_IMAGE_URL,
        isPrimary: true,
        order: 0,
        urls: sampleVariantStrings(),
      },
    ];
    await property.save();

    await ensureCover(geo.city._id);

    const secondImage = await createImage(property._id, false);
    property.images.push({
      imageId: secondImage._id,
      url: TEST_IMAGE_URL,
      isPrimary: false,
      order: 1,
      urls: sampleVariantStrings(),
    });
    await property.save();

    await ensureCover(geo.city._id);

    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(firstImage._id));
  });

  it('skips implausible city names', async () => {
    const geo = await seedGeo('Penn Street');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 4',
          postal_code: '08001',
          coordinates: { type: 'Point', coordinates: [2.17, 41.39] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'penn-street-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/penn',
      images: [],
    });
    const image = await createImage(property._id);
    property.images = [
      {
        imageId: image._id,
        url: TEST_IMAGE_URL,
        isPrimary: true,
        order: 0,
        urls: sampleVariantStrings(),
      },
    ];
    await property.save();

    await ensureCover(geo.city._id);

    const updated = await City.findById(geo.city._id).lean();
    expect(updated?.coverImageId).toBeUndefined();
  });
});

describe('cityCoverSyncService.syncMissingCovers', () => {
  it('processes cities that have listings but no cover', async () => {
    const geo = await seedGeo('Bilbao');
    const property = await Property.create({
      addressId: (
        await Address.create({
          countryId: geo.country._id,
          regionId: geo.region._id,
          cityId: geo.city._id,
          countryCode: 'ES',
          street: 'Carrer Test 3',
          postal_code: '48001',
          coordinates: { type: 'Point', coordinates: [-2.93, 43.26] },
        })
      )._id,
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 900, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'bilbao-cover-1',
      sourceUrl: 'https://fixtures.homiio.com/bilbao',
      images: [],
    });
    const image = await createImage(property._id);
    property.images = [
      {
        imageId: image._id,
        url: TEST_IMAGE_URL,
        isPrimary: true,
        order: 0,
        urls: sampleVariantStrings(),
      },
    ];
    await property.save();

    const processed = await syncMissingCovers({ limit: 10 });
    expect(processed).toBe(1);

    const updated = await City.findById(geo.city._id).lean();
    expect(String(updated?.coverImageId)).toBe(String(image._id));
  });
});

describe('GET /api/cities/popular', () => {
  const app = buildApp();

  it('excludes cities without a cover or with implausible names', async () => {
    const withCover = await seedGeo('Madrid');
    const coverImage = await createImage(new Types.ObjectId());
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
