/**
 * `GET /api/cities/:id/properties` pagination contract.
 *
 * Covers the flat `hasMore` / `totalPages` aliases the infinite city hook reads
 * (added for parity with `/properties/search`) and the server-side `minBathrooms`
 * filter, so the city grid can paginate + filter without breaking under offset
 * pagination.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';
import { OfferingType, PropertyType, PropertyStatus } from '@homiio/shared-types';

import cityRoutes from '../../routes/cities';

const { Country, Region, City, Address, Property } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/cities', cityRoutes());
  app.use(errorHandler);
  return app;
}

async function seedSpainCity(name: string): Promise<{ cityId: Types.ObjectId; countryId: Types.ObjectId; regionId: Types.ObjectId }> {
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
  const city = await City.create({
    countryId: country._id,
    regionId: region._id,
    name,
    currency: 'EUR',
    propertiesCount: 0,
  });
  return { cityId: city._id, countryId: country._id, regionId: region._id };
}

/** Seed one published external listing resolvable to the given city. */
async function seedProperty(
  geo: { cityId: Types.ObjectId; countryId: Types.ObjectId; regionId: Types.ObjectId },
  index: number,
  bathrooms: number,
): Promise<void> {
  const address = await Address.create({
    countryId: geo.countryId,
    regionId: geo.regionId,
    cityId: geo.cityId,
    countryCode: 'ES',
    street: `Carrer Test ${index}`,
    postal_code: '08001',
    coordinates: { type: 'Point', coordinates: [2.17 + index * 0.001, 41.38] },
  });
  await Property.create({
    addressId: address._id,
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 900 + index, currency: 'EUR' },
    status: PropertyStatus.PUBLISHED,
    isExternal: true,
    source: 'fixture',
    sourceId: `city-pagination-${index}`,
    sourceUrl: `https://fixtures.homiio.com/city-${index}`,
    images: [],
  });
}

describe('GET /api/cities/:id/properties pagination aliases', () => {
  it('returns flat hasMore/totalPages and paginates by page', async () => {
    const app = buildApp();
    const geo = await seedSpainCity('Barcelona');
    // 5 listings, 2 per page → 3 pages.
    for (let i = 0; i < 5; i += 1) {
      await seedProperty(geo, i, 1);
    }

    const page1 = await request(app)
      .get(`/api/cities/${geo.cityId}/properties`)
      .query({ limit: 2, page: 1 });

    expect(page1.status).toBe(200);
    expect(page1.body.success).toBe(true);
    expect(page1.body.data.properties).toHaveLength(2);
    expect(page1.body.data.total).toBeUndefined(); // total stays nested in pagination
    expect(page1.body.data.pagination.total).toBe(5);
    expect(page1.body.data.totalPages).toBe(3);
    expect(page1.body.data.hasMore).toBe(true);

    const page3 = await request(app)
      .get(`/api/cities/${geo.cityId}/properties`)
      .query({ limit: 2, page: 3 });

    expect(page3.body.data.properties).toHaveLength(1);
    expect(page3.body.data.totalPages).toBe(3);
    // Last page: (3-1)*2 + 1 === 5, so nothing more to load.
    expect(page3.body.data.hasMore).toBe(false);
  });

  it('applies the server-side minBathrooms filter', async () => {
    const app = buildApp();
    const geo = await seedSpainCity('Girona');
    await seedProperty(geo, 0, 1);
    await seedProperty(geo, 1, 2);
    await seedProperty(geo, 2, 3);

    const res = await request(app)
      .get(`/api/cities/${geo.cityId}/properties`)
      .query({ minBathrooms: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.pagination.total).toBe(2);
    expect(res.body.data.hasMore).toBe(false);
    for (const property of res.body.data.properties) {
      expect(property.bathrooms).toBeGreaterThanOrEqual(2);
    }
  });

  it('returns hasMore=false with no matching addresses', async () => {
    const app = buildApp();
    const geo = await seedSpainCity('Sitges');

    const res = await request(app).get(`/api/cities/${geo.cityId}/properties`);

    expect(res.status).toBe(200);
    expect(res.body.data.properties).toHaveLength(0);
    expect(res.body.data.hasMore).toBe(false);
    expect(res.body.data.totalPages).toBe(0);
  });
});
