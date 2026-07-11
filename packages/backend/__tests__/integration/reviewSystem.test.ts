/**
 * Reviucasa-parity review system: mass-assignment guards, helpful votes,
 * reports, agency attribution + reads, and the review-explore aggregations.
 *
 * Uses real Mongoose models against in-memory Mongo. Geo resolution runs fully
 * offline because every seeded address supplies a complete name set
 * (city + state + countryCode) plus coordinates, so `resolveGeo` never calls the
 * geocoder.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import { createRentProperty } from '../helpers/factories';

const reviewController = require('../../controllers/reviewController');
const { Review, Agency, Address, Property } = require('../../models');
const { clearResolutionCache } = require('../../services/geoResolutionService');

// The geo-resolution cache is process-level and short-circuits geo id
// resolution WITHOUT re-upserting the Country/Region/City/Neighborhood docs.
// The global `afterEach` wipes those collections, so reset the cache between
// tests or a later resolution returns an id for a deleted doc.
beforeEach(() => {
  clearResolutionCache();
});

// ---- Test app (auth shim mirrors the lease-ownership integration test) ----
function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });

  app.post('/reviews', (req, res) => reviewController.createReview(req, res));
  app.put('/reviews/:reviewId', (req, res) => reviewController.updateReview(req, res));
  app.delete('/reviews/:reviewId', (req, res) => reviewController.deleteReview(req, res));
  app.post('/reviews/:reviewId/helpful', (req, res) => reviewController.toggleHelpful(req, res));
  app.post('/reviews/:reviewId/report', (req, res) => reviewController.reportReview(req, res));

  app.get('/agencies/search', (req, res) => reviewController.searchAgencies(req, res));
  app.get('/agencies/:slug', (req, res) => reviewController.getAgencyBySlug(req, res));
  app.get('/agencies/:slug/reviews', (req, res) => reviewController.getAgencyReviews(req, res));
  app.get('/agencies/:slug/properties', (req, res) => reviewController.getAgencyProperties(req, res));

  app.get('/reviews/explore', (req, res) => reviewController.getExploreCities(req, res));
  app.get('/reviews/explore/city/:cityId', (req, res) => reviewController.getExploreCity(req, res));
  app.get('/reviews/explore/neighborhood/:neighborhoodId', (req, res) => reviewController.getExploreNeighborhood(req, res));

  return app;
}

interface AddressOverrides {
  street?: string;
  number?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  coordinates?: [number, number];
}

async function makeBuildingAddress(overrides: AddressOverrides = {}) {
  return Address.findOrCreateCanonical({
    street: overrides.street ?? 'Carrer de Test',
    number: overrides.number ?? '10',
    city: overrides.city ?? 'Barcelona',
    state: overrides.state ?? 'Catalonia',
    country: 'Spain',
    countryCode: 'ES',
    postal_code: '08013',
    neighborhood: overrides.neighborhood ?? 'Eixample',
    coordinates: { type: 'Point', coordinates: overrides.coordinates ?? [2.17, 41.39] },
  });
}

interface ReviewOverrides {
  address?: AddressOverrides;
  review?: Record<string, unknown>;
}

async function seedReview(oxyUserId: string, overrides: ReviewOverrides = {}) {
  const address = await makeBuildingAddress(overrides.address);
  const review = await Review.create({
    addressId: address._id,
    addressLevel: 'BUILDING',
    streetLevelId: address._id,
    buildingLevelId: address._id,
    cityId: address.cityId,
    neighborhoodId: address.neighborhoodId,
    oxyUserId,
    title: 'A perfectly reasonable title',
    price: 1000,
    currency: 'EUR',
    livedFrom: new Date('2020-01-01'),
    livedTo: new Date('2021-01-01'),
    rating: 4,
    recommendation: true,
    opinion: 'Lived here a while — a reasonable opinion string.',
    ...overrides.review,
  });
  return { address, review };
}

describe('createReview (allowlist + agency + geo)', () => {
  it('creates a review, resolves the agency, sets cityId, and ignores injected server fields', async () => {
    const res = await request(buildApp('oxy-reviewer'))
      .post('/reviews')
      .send({
        address: {
          street: 'Carrer Nou',
          number: '22',
          city: 'Barcelona',
          state: 'Catalonia',
          country: 'Spain',
          countryCode: 'ES',
          postal_code: '08010',
          neighborhood: 'Eixample',
          latitude: 41.39,
          longitude: 2.17,
        },
        title: 'Great flat overall',
        price: 1200,
        currency: 'EUR',
        livedFrom: '2020-01-01',
        livedTo: '2021-06-01',
        rating: 4,
        recommendation: true,
        opinion: 'Generally a very good experience living here.',
        prosItems: ['Bright', 'Quiet'],
        consItems: ['Cold in winter'],
        noise: 'quiet',
        depositReturned: 'full',
        agencyName: 'Fincas García',
        // Injected server-owned fields — must be ignored.
        oxyUserId: 'attacker',
        verified: true,
        moderationStatus: 'removed',
        helpfulVoters: ['x', 'y'],
      });

    expect(res.status).toBe(201);

    const agency = await Agency.findOne({ normalizedName: 'fincas garcia' });
    expect(agency).toBeTruthy();
    expect(agency.slug).toBe('fincas-garcia');

    const review = await Review.findOne({ title: 'Great flat overall' });
    expect(review.oxyUserId).toBe('oxy-reviewer');
    expect(review.verified).toBe(false);
    expect(review.moderationStatus).toBe('active');
    expect(review.helpfulVoters).toEqual([]);
    expect(review.cityId).toBeTruthy();
    expect(String(review.agencyId)).toBe(String(agency._id));
    expect(review.depositReturned).toBe('full');

    // DTO strips internal fields and derives helpful counters.
    expect(res.body.review.helpfulVoters).toBeUndefined();
    expect(res.body.review.reports).toBeUndefined();
    expect(res.body.review.helpfulCount).toBe(0);
    expect(res.body.review.agency).toMatchObject({ name: 'Fincas García', slug: 'fincas-garcia' });
  });

  it('rejects a review without a title', async () => {
    const res = await request(buildApp('oxy-reviewer'))
      .post('/reviews')
      .send({
        address: { street: 'X', number: '1', city: 'Barcelona', state: 'Catalonia', country: 'Spain', countryCode: 'ES', postal_code: '08010', latitude: 41.39, longitude: 2.17 },
        price: 1000, currency: 'EUR', livedFrom: '2020-01-01', livedTo: '2021-01-01',
        rating: 4, recommendation: true, opinion: 'A reasonable opinion string here.',
      });
    expect(res.status).toBe(400);
  });
});

describe('updateReview (mass-assignment guard + ownership)', () => {
  it('applies allowlisted edits and ignores injected server fields', async () => {
    const { review } = await seedReview('oxy-owner');
    const res = await request(buildApp('oxy-owner'))
      .put(`/reviews/${review._id}`)
      .send({
        title: 'An edited review title',
        oxyUserId: 'attacker',
        verified: true,
        helpfulVoters: ['a', 'b'],
        moderationStatus: 'removed',
        reports: [{ oxyUserId: 'a', reason: 'spam' }],
      });

    expect(res.status).toBe(200);
    const persisted = await Review.findById(review._id);
    expect(persisted.title).toBe('An edited review title');
    expect(persisted.oxyUserId).toBe('oxy-owner');
    expect(persisted.verified).toBe(false);
    expect(persisted.helpfulVoters).toEqual([]);
    expect(persisted.moderationStatus).toBe('active');
    expect(persisted.reports).toEqual([]);
  });

  it('returns 404 for a non-owner PUT', async () => {
    const { review } = await seedReview('oxy-owner');
    const res = await request(buildApp('oxy-stranger'))
      .put(`/reviews/${review._id}`)
      .send({ title: 'Stranger edit attempt here' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-owner DELETE and leaves the review intact', async () => {
    const { review } = await seedReview('oxy-owner');
    const res = await request(buildApp('oxy-stranger')).delete(`/reviews/${review._id}`);
    expect(res.status).toBe(404);
    expect(await Review.findById(review._id)).toBeTruthy();
  });

  it('lets the owner delete their review', async () => {
    const { review } = await seedReview('oxy-owner');
    const res = await request(buildApp('oxy-owner')).delete(`/reviews/${review._id}`);
    expect(res.status).toBe(200);
    expect(await Review.findById(review._id)).toBeNull();
  });
});

describe('toggleHelpful', () => {
  it('toggles on then off (1 → 0)', async () => {
    const { review } = await seedReview('oxy-author');
    const app = buildApp('oxy-voter');

    const first = await request(app).post(`/reviews/${review._id}/helpful`);
    expect(first.status).toBe(200);
    expect(first.body.helpfulCount).toBe(1);
    expect(first.body.viewerHasVotedHelpful).toBe(true);

    const second = await request(app).post(`/reviews/${review._id}/helpful`);
    expect(second.status).toBe(200);
    expect(second.body.helpfulCount).toBe(0);
    expect(second.body.viewerHasVotedHelpful).toBe(false);
  });

  it('rejects voting on your own review with 400', async () => {
    const { review } = await seedReview('oxy-author');
    const res = await request(buildApp('oxy-author')).post(`/reviews/${review._id}/helpful`);
    expect(res.status).toBe(400);
  });
});

describe('reportReview', () => {
  it('dedupes repeat reports from the same reporter', async () => {
    const { review } = await seedReview('oxy-author');
    const app = buildApp('oxy-reporter');

    const first = await request(app).post(`/reviews/${review._id}/report`).send({ reason: 'spam' });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/reviews/${review._id}/report`).send({ reason: 'spam' });
    expect(second.status).toBe(200);

    const persisted = await Review.findById(review._id);
    expect(persisted.reports).toHaveLength(1);
  });

  it('requires details when the reason is "other"', async () => {
    const { review } = await seedReview('oxy-author');
    const res = await request(buildApp('oxy-reporter')).post(`/reviews/${review._id}/report`).send({ reason: 'other' });
    expect(res.status).toBe(400);
  });

  it('escalates to under_review after 3 distinct reporters', async () => {
    const { review } = await seedReview('oxy-author');
    for (const reporter of ['r1', 'r2', 'r3']) {
      const res = await request(buildApp(reporter)).post(`/reviews/${review._id}/report`).send({ reason: 'fake' });
      expect(res.status).toBe(201);
    }
    const persisted = await Review.findById(review._id);
    expect(persisted.reports).toHaveLength(3);
    expect(persisted.moderationStatus).toBe('under_review');
  });

  it('keeps under_review reviews visible in agency reads but hides removed ones', async () => {
    const agency = await Agency.findOrCreateByName('Visible Agency');
    await seedReview('oxy-a', { review: { agencyId: agency._id, moderationStatus: 'under_review' } });
    await seedReview('oxy-b', { address: { number: '11' }, review: { agencyId: agency._id, moderationStatus: 'removed' } });

    const res = await request(buildApp()).get(`/agencies/${agency.slug}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
  });
});

describe('agency reads', () => {
  it('returns agency stats + listings count', async () => {
    const agency = await Agency.findOrCreateByName('Stats Agency');

    // Create the property FIRST: the factory's `ensureGeo` uses `Country.create`
    // (not upsert), so it must run before `resolveGeo` upserts the ES country.
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    await Property.updateOne({ _id: property._id }, { $set: { agencyId: agency._id } });

    await seedReview('oxy-a', { review: { agencyId: agency._id, rating: 5, recommendation: true, depositReturned: 'full' } });
    await seedReview('oxy-b', { address: { number: '12' }, review: { agencyId: agency._id, rating: 3, recommendation: false, depositReturned: 'no' } });

    const res = await request(buildApp()).get(`/agencies/${agency.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.agency).toMatchObject({ name: 'Stats Agency', slug: 'stats-agency' });
    expect(res.body.stats.totalReviews).toBe(2);
    expect(res.body.stats.averageRating).toBe(4);
    expect(res.body.stats.recommendationPercentage).toBe(50);
    expect(res.body.stats.depositFullPct).toBe(50);
    expect(res.body.stats.listingsCount).toBe(1);
  });

  it('lists agency properties with flat pagination aliases', async () => {
    const agency = await Agency.findOrCreateByName('Props Agency');
    const property = await createRentProperty({ oxyUserId: 'oxy-owner' });
    await Property.updateOne({ _id: property._id }, { $set: { agencyId: agency._id } });

    const res = await request(buildApp()).get(`/agencies/${agency.slug}/properties`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.totalPages).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('prefix-searches agencies by normalized name', async () => {
    await Agency.findOrCreateByName('Fincas García');
    await Agency.findOrCreateByName('Other Realty');

    const res = await request(buildApp()).get('/agencies/search').query({ q: 'fincas' });
    expect(res.status).toBe(200);
    expect(res.body.agencies).toHaveLength(1);
    expect(res.body.agencies[0]).toMatchObject({ name: 'Fincas García', slug: 'fincas-garcia' });
  });

  it('returns 404 for an unknown agency slug', async () => {
    const res = await request(buildApp()).get('/agencies/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('review explore aggregations', () => {
  it('summarizes cities → neighborhoods → buildings', async () => {
    // Two buildings in the same Barcelona neighborhood, one in Madrid.
    const { address: bcnA } = await seedReview('oxy-1', { address: { number: '10' }, review: { rating: 4, recommendation: true } });
    await seedReview('oxy-2', { address: { number: '20' }, review: { rating: 2, recommendation: false } });
    await seedReview('oxy-3', {
      address: { street: 'Gran Via', number: '5', city: 'Madrid', state: 'Madrid', neighborhood: 'Centro', coordinates: [-3.7, 40.4] },
      review: { rating: 5, recommendation: true },
    });

    const cities = await request(buildApp()).get('/reviews/explore');
    expect(cities.status).toBe(200);
    expect(cities.body.cities.length).toBe(2);
    const barcelona = cities.body.cities.find((c: { name: string }) => c.name === 'Barcelona');
    expect(barcelona).toBeTruthy();
    expect(barcelona.reviewCount).toBe(2);

    const neighborhoods = await request(buildApp()).get(`/reviews/explore/city/${barcelona.cityId}`);
    expect(neighborhoods.status).toBe(200);
    expect(neighborhoods.body.neighborhoods.length).toBe(1);
    const eixample = neighborhoods.body.neighborhoods[0];
    expect(eixample.name).toBe('Eixample');
    expect(eixample.reviewCount).toBe(2);

    const buildings = await request(buildApp()).get(`/reviews/explore/neighborhood/${eixample.neighborhoodId}`);
    expect(buildings.status).toBe(200);
    expect(buildings.body.buildings.length).toBe(2);
    expect(buildings.body.hasMore).toBe(false);
    // Building street/number come from the Address doc.
    expect(buildings.body.buildings.every((b: { street: string }) => b.street === 'Carrer de Test')).toBe(true);
    void bcnA;
  });

  it('excludes removed reviews from explore coverage', async () => {
    await seedReview('oxy-1', { review: { moderationStatus: 'removed' } });
    const cities = await request(buildApp()).get('/reviews/explore');
    expect(cities.status).toBe(200);
    expect(cities.body.cities).toHaveLength(0);
  });
});
