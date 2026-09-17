/**
 * `GET /properties/search/price-histogram` against a REAL Postgres.
 *
 * The histogram's whole value is that it describes the SAME homes the search
 * under it returns, minus the price bounds. So every case here runs the search
 * endpoint beside it on the identical query string and compares the two, rather
 * than asserting on bucket counts alone — a histogram that silently counted the
 * whole catalogue would still produce plausible bars.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { searchProperties } from '../../controllers/property/search';
import { getSearchPriceHistogram } from '../../controllers/property/priceHistogram';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search/price-histogram', getSearchPriceHistogram);
  app.get('/properties/search', searchProperties);
  app.use(errorHandler);
  return app;
}

interface Bucket {
  from: number;
  to: number;
  count: number;
}

async function seedRent(
  chain: GeoChain,
  monthly: number,
  overrides: Parameters<typeof seedProperty>[0]['overrides'] = {},
  countryCode = 'ES',
): Promise<string> {
  const addressId = await seedAddress({ chain, countryCode });
  return seedProperty({
    addressId,
    overrides: {
      status: PropertyStatus.PUBLISHED,
      type: PropertyType.APARTMENT,
      availabilityIsAvailable: true,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: monthly,
      longTermRentCurrency: 'EUR',
      ...overrides,
    },
  });
}

function sum(buckets: Bucket[]): number {
  return buckets.reduce((total, bucket) => total + bucket.count, 0);
}

describe('search price histogram', () => {
  let barcelona: GeoChain;
  let madrid: GeoChain;

  beforeEach(async () => {
    await resetGeoTables();
    barcelona = await seedGeoChain({ cityName: 'Barcelona', regionName: 'Catalonia', countryCode: 'ES-HB' });
    madrid = await seedGeoChain({ cityName: 'Madrid', regionName: 'Community of Madrid', countryCode: 'ES-HM' });

    for (const price of [700, 900, 1100, 1300, 1500, 2400]) await seedRent(barcelona, price);
    await seedRent(barcelona, 800, { type: PropertyType.HOUSE, bedrooms: 3 });
    for (const price of [3000, 3500]) await seedRent(madrid, price);
    // Excluded exactly as search excludes them: a draft, and a soft-deleted row.
    await seedRent(barcelona, 1000, { status: PropertyStatus.DRAFT });
    await seedRent(barcelona, 1000, { deletedAt: new Date() });
  });

  it('counts exactly the listings the search matches, bucketed over the requested span', async () => {
    const qs = `offering=long_term_rent&city=${barcelona.cityId}`;
    const [histogram, search] = await Promise.all([
      request(buildApp()).get(`/properties/search/price-histogram?${qs}&histogramMin=0&histogramMax=2000&histogramBuckets=10`),
      request(buildApp()).get(`/properties/search?${qs}`),
    ]);

    expect(histogram.status).toBe(200);
    const body = histogram.body.priceHistogram;
    expect(search.body.total).toBe(7);
    expect(body).toMatchObject({ offering: 'long_term_rent', currency: 'EUR', min: 0, max: 2000, count: 7 });
    expect(body.buckets).toHaveLength(10);
    expect(sum(body.buckets)).toBe(search.body.total);
    // 200-wide buckets, 0-indexed: 700 → [600,800) #3, 800 and 900 → #4,
    // 1100 → #5, 1300 → #6, 1500 → #7, and 2400 is ABOVE the span and lands in
    // the open last bucket.
    expect(body.buckets.map((bucket: Bucket) => bucket.count)).toEqual([0, 0, 0, 1, 2, 1, 1, 1, 0, 1]);
    expect(body.buckets[0]).toMatchObject({ from: 0, to: 200 });
    expect(body.buckets[9]).toMatchObject({ from: 1800, to: 2000 });
    expect(histogram.body.location).toMatchObject({ status: 'resolved', cityId: barcelona.cityId });
  });

  it('narrows with the scope and the non-price filters', async () => {
    const madridRes = await request(buildApp()).get(
      `/properties/search/price-histogram?offering=long_term_rent&city=${madrid.cityId}`,
    );
    expect(madridRes.body.priceHistogram.count).toBe(2);
    expect(madridRes.body.priceHistogram.min).toBe(3000);

    const houses = await request(buildApp()).get(
      `/properties/search/price-histogram?offering=long_term_rent&city=${barcelona.cityId}&propertyType=house`,
    );
    expect(houses.body.priceHistogram.count).toBe(1);
    expect(sum(houses.body.priceHistogram.buckets)).toBe(1);

    const everywhere = await request(buildApp()).get('/properties/search/price-histogram?offering=long_term_rent');
    expect(everywhere.body.priceHistogram.count).toBe(9);
    expect(everywhere.body.location).toMatchObject({ status: 'none' });
  });

  it('scopes a country by its ISO code', async () => {
    const lisbon = await seedGeoChain({ cityName: 'Lisbon', regionName: 'Lisboa', countryCode: 'PT-H' });
    await seedRent(lisbon, 950, {}, 'PT');

    const res = await request(buildApp()).get('/properties/search/price-histogram?offering=long_term_rent&country=PT');

    expect(res.body.location).toMatchObject({ status: 'resolved', appliedLocationKind: 'country', countryCode: 'PT' });
    expect(res.body.priceHistogram.count).toBe(1);
  });

  it('is NOT narrowed by the price bounds the search applies', async () => {
    const qs = `offering=long_term_rent&city=${barcelona.cityId}&priceMin=1000&priceMax=1400&minRent=1000&maxRent=1400`;
    const [histogram, search] = await Promise.all([
      request(buildApp()).get(`/properties/search/price-histogram?${qs}`),
      request(buildApp()).get(`/properties/search?${qs}`),
    ]);

    // The search IS narrowed — without this half the assertion below would also
    // pass against an endpoint that ignored the bounds everywhere.
    expect(search.body.total).toBe(2);
    expect(histogram.body.priceHistogram.count).toBe(7);
    expect(sum(histogram.body.priceHistogram.buckets)).toBe(7);
  });

  it('buckets sale prices by the sale column and ignores the sale bounds', async () => {
    for (const price of [250000, 400000]) {
      const addressId = await seedAddress({ chain: barcelona });
      await seedProperty({
        addressId,
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.APARTMENT,
          availabilityIsAvailable: true,
          offerings: [OfferingType.SALE],
          salePrice: price,
          saleCurrency: 'EUR',
        },
      });
    }

    const res = await request(buildApp()).get(
      `/properties/search/price-histogram?offering=sale&city=${barcelona.cityId}&minSalePrice=300000&histogramMin=0&histogramMax=2000000`,
    );

    expect(res.body.priceHistogram).toMatchObject({ offering: 'sale', count: 2, max: 2000000 });
  });

  it('counts one currency and reports the rest instead of mixing them', async () => {
    await seedRent(barcelona, 1200, { longTermRentCurrency: 'GBP' });

    const res = await request(buildApp()).get(
      `/properties/search/price-histogram?offering=long_term_rent&city=${barcelona.cityId}&currency=EUR`,
    );

    expect(res.body.priceHistogram).toMatchObject({ currency: 'EUR', count: 7, otherCurrencyCount: 1 });
    expect(sum(res.body.priceHistogram.buckets)).toBe(7);
  });

  it('defaults its span to the scope and keeps the bucket count bounded', async () => {
    const res = await request(buildApp()).get(
      `/properties/search/price-histogram?offering=long_term_rent&city=${barcelona.cityId}&histogramBuckets=500`,
    );

    const body = res.body.priceHistogram;
    expect(body.buckets).toHaveLength(40);
    expect(body.min).toBe(700);
    expect(sum(body.buckets)).toBe(7);
  });

  it('answers an unresolved place with the unresolved state and NO histogram', async () => {
    const res = await request(buildApp()).get(
      '/properties/search/price-histogram?offering=long_term_rent&city=Atlantis',
    );

    expect(res.status).toBe(200);
    expect(res.body.location).toMatchObject({ status: 'unresolved', requested: { param: 'city', value: 'Atlantis' } });
    // Never the distribution of the whole catalogue under a place's name.
    expect(res.body.priceHistogram).toBeNull();
  });

  it('refuses the geographic combinations search refuses', async () => {
    const res = await request(buildApp()).get(
      '/properties/search/price-histogram?swLat=41.3&swLng=2.0&neLat=41.5&neLng=2.3&city=barcelona',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_LOCATION');
  });

  it('rejects an inverted span', async () => {
    const res = await request(buildApp()).get(
      '/properties/search/price-histogram?histogramMin=500&histogramMax=100',
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_HISTOGRAM');
  });

  it('has no histogram for exchange, which carries no price', async () => {
    const res = await request(buildApp()).get('/properties/search/price-histogram?offering=exchange');
    expect(res.status).toBe(200);
    expect(res.body.priceHistogram).toBeNull();
  });
});
