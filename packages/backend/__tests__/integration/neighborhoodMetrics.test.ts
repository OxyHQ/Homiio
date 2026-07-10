/**
 * Neighborhood metrics endpoints (public reads).
 *
 * Mounts the real neighborhood router on the in-memory Mongo and asserts that
 * every metric is DERIVED FROM SEEDED LISTINGS — listing count, average rent and
 * the neighborhood-vs-city contrast — with NO invented walkability/score fields.
 * Also covers the "no neighborhood → 404 / hidden" and unknown-city → empty
 * paths, plus popular-by-listing-count ranking and nearest-by-location lookup.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyType, PropertyStatus, ProfileType } from '@homiio/shared-types';

import neighborhoodRoutes from '../../routes/neighborhoods';
import { models } from '../helpers/factories';

const { errorHandler } = require('../../middlewares/errorHandler');
const { Country, Region, City, Neighborhood, Address, Property, Profile } = models;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/neighborhoods', neighborhoodRoutes());
  app.use(errorHandler);
  return app;
}

interface Geo {
  country: { _id: unknown };
  region: { _id: unknown };
  city: { _id: unknown };
}

async function seedCity(name = 'Barcelona'): Promise<Geo> {
  const country = await Country.create({ code: 'ES', name: 'Spain', currency: 'EUR' });
  const region = await Region.create({ countryId: country._id, name: 'Catalonia' });
  const city = await City.create({
    countryId: country._id,
    regionId: region._id,
    name,
    currency: 'EUR',
  });
  return { country, region, city };
}

async function seedNeighborhood(
  geo: Geo,
  name: string,
  centroid?: { lat: number; lng: number },
): Promise<{ _id: unknown; name: string }> {
  return Neighborhood.create({ cityId: geo.city._id, name, centroid });
}

let addressSeq = 0;
async function seedAddress(
  geo: Geo,
  neighborhoodId: unknown | undefined,
  coordinates: [number, number] = [2.17, 41.39],
): Promise<{ _id: unknown }> {
  addressSeq += 1;
  return Address.create({
    countryId: geo.country._id,
    regionId: geo.region._id,
    cityId: geo.city._id,
    neighborhoodId,
    countryCode: 'ES',
    street: `Carrer de Test ${addressSeq}`,
    postal_code: '08001',
    coordinates: { type: 'Point', coordinates: coordinates },
  });
}

async function seedProfile(): Promise<{ _id: unknown; oxyUserId: string }> {
  const oxyUserId = `oxy-${Math.random().toString(36).slice(2)}`;
  const profile = await Profile.create({
    oxyUserId,
    profileType: ProfileType.PERSONAL,
    isActive: true,
    personalProfile: {},
  });
  return profile;
}

async function seedListing(
  oxyUserId: string,
  addressId: unknown,
  monthlyAmount: number,
): Promise<{ _id: unknown }> {
  return Property.create({
    oxyUserId,
    addressId,
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount, currency: 'EUR' },
    status: PropertyStatus.PUBLISHED,
  });
}

describe('GET /api/neighborhoods/by-property/:propertyId', () => {
  it('returns real, listing-derived metrics for the property neighborhood', async () => {
    const geo = await seedCity();
    const gracia = await seedNeighborhood(geo, 'Gracia');
    const profile = await seedProfile();
    const address = await seedAddress(geo, gracia._id);
    const listing = await seedListing(String(profile.oxyUserId), address._id, 1000);

    const res = await request(buildApp()).get(`/api/neighborhoods/by-property/${listing._id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      id: String(gracia._id),
      name: 'Gracia',
      city: 'Barcelona',
      cityId: String(geo.city._id),
      listingCount: 1,
      averageRent: 1000,
    });
    // No invented scores leak into the DTO.
    expect(res.body.data.overallScore).toBeUndefined();
    expect(res.body.data.ratings).toBeUndefined();
    expect(res.body.data.walkScore).toBeUndefined();
  });

  it('404s when the property has no resolved neighborhood', async () => {
    const geo = await seedCity();
    const profile = await seedProfile();
    const address = await seedAddress(geo, undefined);
    const listing = await seedListing(profile.oxyUserId, address._id, 1000);

    const res = await request(buildApp()).get(`/api/neighborhoods/by-property/${listing._id}`);

    expect(res.status).toBe(404);
  });

  it('404s for a non-existent property', async () => {
    const res = await request(buildApp()).get(
      '/api/neighborhoods/by-property/507f1f77bcf86cd799439011',
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/neighborhoods/by-name', () => {
  it('resolves by name and computes the neighborhood-vs-city rent contrast', async () => {
    const geo = await seedCity();
    const gracia = await seedNeighborhood(geo, 'Gracia');
    const eixample = await seedNeighborhood(geo, 'Eixample');
    const profile = await seedProfile();

    // Gracia: one 800€ listing. Eixample: one 2000€ listing. City avg = 1400€.
    await seedListing(profile.oxyUserId, (await seedAddress(geo, gracia._id))._id, 800);
    await seedListing(profile.oxyUserId, (await seedAddress(geo, eixample._id))._id, 2000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/by-name')
      .query({ name: 'gracia', city: 'Barcelona' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Gracia');
    expect(res.body.data.averageRent).toBe(800);
    expect(res.body.data.vsCity).toMatchObject({
      cityAverageRent: 1400,
      // (800 - 1400) / 1400 * 100 ≈ -43
      percentDiff: -43,
    });
  });

  it('404s for an unknown neighborhood name', async () => {
    await seedCity();
    const res = await request(buildApp())
      .get('/api/neighborhoods/by-name')
      .query({ name: 'Nowhere' });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/neighborhoods/popular', () => {
  it('ranks a city neighborhoods by real listing count', async () => {
    const geo = await seedCity();
    const gracia = await seedNeighborhood(geo, 'Gracia');
    const eixample = await seedNeighborhood(geo, 'Eixample');
    const profile = await seedProfile();

    // Gracia: 2 listings, Eixample: 1 listing.
    await seedListing(profile.oxyUserId, (await seedAddress(geo, gracia._id))._id, 900);
    await seedListing(profile.oxyUserId, (await seedAddress(geo, gracia._id))._id, 1100);
    await seedListing(profile.oxyUserId, (await seedAddress(geo, eixample._id))._id, 2000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/popular')
      .query({ city: 'Barcelona' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Gracia');
    expect(res.body.data[0].listingCount).toBe(2);
    expect(res.body.data[0].averageRent).toBe(1000);
    expect(res.body.data[1].name).toBe('Eixample');
    expect(res.body.data[1].listingCount).toBe(1);
  });

  it('returns an empty list for an unknown city', async () => {
    const res = await request(buildApp())
      .get('/api/neighborhoods/popular')
      .query({ city: 'Atlantis' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('400s when city is omitted', async () => {
    const res = await request(buildApp()).get('/api/neighborhoods/popular');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/neighborhoods/search', () => {
  it('lists neighborhoods scoped to a city with metrics', async () => {
    const geo = await seedCity();
    const gracia = await seedNeighborhood(geo, 'Gracia');
    await seedNeighborhood(geo, 'Eixample');
    const profile = await seedProfile();
    await seedListing(profile.oxyUserId, (await seedAddress(geo, gracia._id))._id, 1000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Barcelona' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const names = res.body.data.map((n: { name: string }) => n.name).sort();
    expect(names).toEqual(['Eixample', 'Gracia']);
  });

  it('filters by name query', async () => {
    const geo = await seedCity();
    await seedNeighborhood(geo, 'Gracia');
    await seedNeighborhood(geo, 'Eixample');

    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Barcelona', query: 'grac' });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Gracia');
  });

  it('returns an empty list for an unknown city', async () => {
    const res = await request(buildApp())
      .get('/api/neighborhoods/search')
      .query({ city: 'Atlantis' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('GET /api/neighborhoods/by-location', () => {
  beforeAll(async () => {
    // The $near lookup needs the Address 2dsphere index to exist.
    await Address.createIndexes();
  });

  it('resolves the nearest neighborhood-bearing address', async () => {
    const geo = await seedCity();
    const gracia = await seedNeighborhood(geo, 'Gracia');
    const profile = await seedProfile();
    const address = await seedAddress(geo, gracia._id, [2.17, 41.39]);
    await seedListing(profile.oxyUserId, address._id, 1000);

    const res = await request(buildApp())
      .get('/api/neighborhoods/by-location')
      .query({ latitude: 41.39, longitude: 2.17 });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Gracia');
    expect(res.body.data.listingCount).toBe(1);
  });

  it('404s when no neighborhood is near the coordinate', async () => {
    const res = await request(buildApp())
      .get('/api/neighborhoods/by-location')
      .query({ latitude: 0, longitude: 0 });
    expect(res.status).toBe(404);
  });

  it('400s on missing coordinates', async () => {
    const res = await request(buildApp()).get('/api/neighborhoods/by-location');
    expect(res.status).toBe(400);
  });
});
