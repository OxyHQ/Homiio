/**
 * Reviucasa-parity review system, end to end through the real controllers:
 * mass-assignment guards, ownership, helpful votes, reports, agency attribution
 * and the review-explore aggregations.
 *
 * Postgres throughout — `reviewController` has no Mongoose import left. Geo
 * resolution still runs fully OFFLINE, because every seeded address supplies a
 * complete name set (city + state + countryCode) plus coordinates, so
 * `resolveGeoChain` never reaches the geocoder.
 *
 * ## Why the fixtures create addresses through the real create endpoint
 *
 * A review's address hierarchy is resolved by `findOrCreateCanonicalAddress` +
 * `resolveAddressHierarchy`, and those two are half of what this suite is
 * checking. Seeding rows directly would let a broken hierarchy pass, so the
 * reviews here are created by POSTing to the controller exactly as a client
 * does, and the ids come back out of the response.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import express, { type Express } from 'express';
import request from 'supertest';
import { uuidv7 } from '@oxyhq/db';

import * as reviewController from '../../controllers/reviewController';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';
import { seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';
import { getDb } from '../../db/postgres';
import { findOrCreateAgencyByName } from '../../db/agencies/agencyWrites';
import { findOwnerOxyUserIdsAtAddresses } from '../../db/properties/propertyReads';
import { Review } from '../../models';
import { agencies, reviewReports, reviews as reviewsTable } from '../../db/schema';

/** One city per RUN, so a rerun against the worker's database cannot meet its own rows. */
const SUITE = uuidv7().slice(-8);
const CITY = `Barcelona ${SUITE}`;
const NEIGHBORHOOD = `Eixample ${SUITE}`;

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
  app.get('/reviews/:reviewId', (req, res) => reviewController.getReviewById(req, res));
  app.put('/reviews/:reviewId', (req, res) => reviewController.updateReview(req, res));
  app.delete('/reviews/:reviewId', (req, res) => reviewController.deleteReview(req, res));
  app.get('/reviews/user/:oxyUserId', (req, res) => reviewController.getUserReviews(req, res));
  app.post('/reviews/:reviewId/helpful', (req, res) => reviewController.toggleHelpful(req, res));
  app.post('/reviews/:reviewId/report', (req, res) => reviewController.reportReview(req, res));

  app.get('/agencies/search', (req, res) => reviewController.searchAgencies(req, res));
  app.get('/agencies/:slug', (req, res) => reviewController.getAgencyBySlug(req, res));
  app.get('/agencies/:slug/reviews', (req, res) => reviewController.getAgencyReviews(req, res));
  app.get('/agencies/:slug/properties', (req, res) => reviewController.getAgencyProperties(req, res));

  app.get('/addresses/:addressId/reviews', (req, res) => reviewController.getReviewsByAddress(req, res));
  app.get('/addresses/:addressId/stats', (req, res) => reviewController.getAddressReviewStats(req, res));

  app.get('/reviews-explore', (req, res) => reviewController.getExploreCities(req, res));
  app.get('/reviews-explore/city/:cityId', (req, res) => reviewController.getExploreCity(req, res));
  app.get('/reviews-explore/neighborhood/:neighborhoodId', (req, res) => reviewController.getExploreNeighborhood(req, res));

  return app;
}

interface AddressOverrides {
  street?: string;
  number?: string;
  unit?: string;
  city?: string;
  state?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
}

function addressBody(overrides: AddressOverrides = {}) {
  return {
    street: overrides.street ?? `Carrer de Test ${SUITE}`,
    number: overrides.number ?? '10',
    unit: overrides.unit,
    city: overrides.city ?? CITY,
    state: overrides.state ?? 'Catalonia',
    country: 'Spain',
    countryCode: 'ES',
    postal_code: '08013',
    neighborhood: overrides.neighborhood ?? NEIGHBORHOOD,
    latitude: overrides.latitude ?? 41.39,
    longitude: overrides.longitude ?? 2.17,
  };
}

interface ReviewBody {
  [key: string]: unknown;
}

/** POST a review through the real controller and return the created DTO. */
async function postReview(
  oxyUserId: string,
  options: { address?: AddressOverrides; review?: ReviewBody } = {},
): Promise<Record<string, unknown>> {
  const res = await request(buildApp(oxyUserId))
    .post('/reviews')
    .send({
      address: addressBody(options.address),
      title: 'A perfectly reasonable title',
      price: 1000,
      currency: 'EUR',
      livedFrom: '2020-01-01',
      livedTo: '2021-01-01',
      rating: 4,
      recommendation: true,
      opinion: 'Lived here a while — a reasonable opinion string.',
      ...options.review,
    });
  if (res.status !== 201) {
    throw new Error(`review create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.review as Record<string, unknown>;
}

/** Attribute a stored review to an agency and/or move its moderation state. */
async function amendReview(
  reviewId: string,
  patch: { agencyId?: string; moderationStatus?: 'active' | 'under_review' | 'removed'; rating?: number; recommendation?: boolean; depositReturned?: 'full' | 'partial' | 'no' },
): Promise<void> {
  await getDb().update(reviewsTable).set(patch).where(eq(reviewsTable.id, reviewId));
}

describe('createReview (allowlist + agency + geo)', () => {
  it('creates a review, resolves the agency, sets cityId, and ignores injected server fields', async () => {
    const res = await request(buildApp('oxy-reviewer'))
      .post('/reviews')
      .send({
        address: addressBody({ street: `Carrer Nou ${SUITE}`, number: '22' }),
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
        agencyName: `Fincas García ${SUITE}`,
        // Injected server-owned fields — must be ignored.
        oxyUserId: 'attacker',
        verified: true,
        moderationStatus: 'removed',
        livedForMonths: 999,
        helpfulVoters: ['x', 'y'],
      });

    expect(res.status).toBe(201);

    const [agency] = await getDb()
      .select()
      .from(agencies)
      .where(eq(agencies.normalizedName, `fincas garcia ${SUITE}`));
    expect(agency).toBeDefined();
    expect(agency.slug).toBe(`fincas-garcia-${SUITE}`);

    const [stored] = await getDb()
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, String(res.body.review.id)));
    expect(stored.oxyUserId).toBe('oxy-reviewer');
    expect(stored.verified).toBe(false);
    expect(stored.moderationStatus).toBe('active');
    expect(stored.cityId).toBeTruthy();
    expect(stored.agencyId).toBe(agency.id);
    expect(stored.depositReturned).toBe('full');
    // Derived server-side from the dates, never taken from the body: 517 days
    // over the 30.44-day average month is 17, not the injected 999.
    expect(stored.livedForMonths).toBe(17);

    // DTO strips internal fields and derives the helpful counters.
    expect(res.body.review.helpfulVoters).toBeUndefined();
    expect(res.body.review.reports).toBeUndefined();
    expect(res.body.review.helpfulCount).toBe(0);
    expect(res.body.review.livedDurationText).toBe('1 year 5 months');
    expect(res.body.review.agency).toMatchObject({ name: `Fincas García ${SUITE}`, slug: `fincas-garcia-${SUITE}` });
  });

  it('rejects a review without a title', async () => {
    const res = await request(buildApp('oxy-untitled'))
      .post('/reviews')
      .send({
        address: addressBody({ street: `Carrer X ${SUITE}`, number: '1' }),
        price: 1000, currency: 'EUR', livedFrom: '2020-01-01', livedTo: '2021-01-01',
        rating: 4, recommendation: true, opinion: 'A reasonable opinion string here.',
      });
    expect(res.status).toBe(400);
  });

  /**
   * Mongoose used to CAST and VALIDATE on the way in; `controllers/review/reviewInput.ts`
   * is what replaced it, and its whole job is to keep a rejection a 400 rather
   * than letting a CHECK answer 500 from the driver.
   */
  it('rejects an out-of-range rating with a 400 rather than a constraint violation', async () => {
    const res = await request(buildApp('oxy-bad-rating'))
      .post('/reviews')
      .send({
        address: addressBody({ street: `Carrer Rating ${SUITE}`, number: '2' }),
        title: 'A perfectly reasonable title',
        price: 1000, currency: 'EUR', livedFrom: '2020-01-01', livedTo: '2021-01-01',
        rating: 9, recommendation: true, opinion: 'A reasonable opinion string here.',
      });
    expect(res.status).toBe(400);
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('rating')]));
  });

  it('rejects an undeclared dimension value with a 400', async () => {
    const res = await request(buildApp('oxy-bad-enum'))
      .post('/reviews')
      .send({
        address: addressBody({ street: `Carrer Enum ${SUITE}`, number: '3' }),
        title: 'A perfectly reasonable title',
        price: 1000, currency: 'EUR', livedFrom: '2020-01-01', livedTo: '2021-01-01',
        rating: 4, recommendation: true, opinion: 'A reasonable opinion string here.',
        noise: 'deafening',
      });
    expect(res.status).toBe(400);
  });

  it('refuses a second review of the same address by the same person', async () => {
    const address = { street: `Carrer Once ${SUITE}`, number: '4' };
    await postReview('oxy-once', { address });
    const res = await request(buildApp('oxy-once'))
      .post('/reviews')
      .send({
        address: addressBody(address),
        title: 'A perfectly reasonable title',
        price: 1000, currency: 'EUR', livedFrom: '2020-01-01', livedTo: '2021-01-01',
        rating: 4, recommendation: true, opinion: 'A reasonable opinion string here.',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('already reviewed');
  });
});

describe('updateReview (mass-assignment guard + ownership)', () => {
  it('applies allowlisted edits and ignores injected server fields', async () => {
    const created = await postReview('oxy-owner', { address: { street: `Carrer Edit ${SUITE}`, number: '5' } });

    const res = await request(buildApp('oxy-owner'))
      .put(`/reviews/${created.id}`)
      .send({
        title: 'An edited review title',
        oxyUserId: 'attacker',
        verified: true,
        helpfulVoters: ['a', 'b'],
        moderationStatus: 'removed',
        reports: [{ oxyUserId: 'a', reason: 'spam' }],
      });

    expect(res.status).toBe(200);
    const [persisted] = await getDb()
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, String(created.id)));
    expect(persisted.title).toBe('An edited review title');
    expect(persisted.oxyUserId).toBe('oxy-owner');
    expect(persisted.verified).toBe(false);
    expect(persisted.moderationStatus).toBe('active');
  });

  it('returns 404 for a non-owner PUT', async () => {
    const created = await postReview('oxy-owner-2', { address: { street: `Carrer Guard ${SUITE}`, number: '6' } });
    const res = await request(buildApp('oxy-stranger'))
      .put(`/reviews/${created.id}`)
      .send({ title: 'Stranger edit attempt here' });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-owner DELETE and leaves the review intact', async () => {
    const created = await postReview('oxy-owner-3', { address: { street: `Carrer Keep ${SUITE}`, number: '7' } });
    const res = await request(buildApp('oxy-stranger')).delete(`/reviews/${created.id}`);
    expect(res.status).toBe(404);
    const rows = await getDb().select().from(reviewsTable).where(eq(reviewsTable.id, String(created.id)));
    expect(rows).toHaveLength(1);
  });

  it('lets the owner delete their review', async () => {
    const created = await postReview('oxy-owner-4', { address: { street: `Carrer Gone ${SUITE}`, number: '8' } });
    const res = await request(buildApp('oxy-owner-4')).delete(`/reviews/${created.id}`);
    expect(res.status).toBe(200);
    const rows = await getDb().select().from(reviewsTable).where(eq(reviewsTable.id, String(created.id)));
    expect(rows).toHaveLength(0);
  });
});

describe('getReviewById + getUserReviews and the removed-review rule', () => {
  it('hides a removed review from a stranger and shows it to its author', async () => {
    const created = await postReview('oxy-removed-author', { address: { street: `Carrer Hidden ${SUITE}`, number: '9' } });
    await amendReview(String(created.id), { moderationStatus: 'removed' });

    expect((await request(buildApp('oxy-nobody')).get(`/reviews/${created.id}`)).status).toBe(404);
    expect((await request(buildApp()).get(`/reviews/${created.id}`)).status).toBe(404);
    expect((await request(buildApp('oxy-removed-author')).get(`/reviews/${created.id}`)).status).toBe(200);
  });

  /**
   * The one deliberate behaviour change in this port, stated here as a test.
   *
   * The Mongo listing filtered `$ne: 'removed'` for EVERYONE including the
   * author, which contradicted both `getReviewById` above and the docblock on
   * `reviews_oxy_user_created_idx` — the ONE scoped index that is not partial,
   * precisely so this listing can show an author their own removed review.
   * Hiding it makes a removal indistinguishable from a lost submission.
   */
  it('lists a removed review to its author and to nobody else', async () => {
    const author = `oxy-my-reviews-${SUITE}`;
    const visible = await postReview(author, { address: { street: `Carrer Mine A ${SUITE}`, number: '1' } });
    const removed = await postReview(author, { address: { street: `Carrer Mine B ${SUITE}`, number: '2' } });
    await amendReview(String(removed.id), { moderationStatus: 'removed' });

    const mine = await request(buildApp(author)).get(`/reviews/user/${author}`);
    expect(mine.status).toBe(200);
    expect(mine.body.reviews.map((review: { id: string }) => review.id).sort()).toEqual(
      [String(visible.id), String(removed.id)].sort(),
    );

    const theirs = await request(buildApp('oxy-someone-else')).get(`/reviews/user/${author}`);
    expect(theirs.body.reviews.map((review: { id: string }) => review.id)).toEqual([String(visible.id)]);

    const anonymous = await request(buildApp()).get(`/reviews/user/${author}`);
    expect(anonymous.body.reviews.map((review: { id: string }) => review.id)).toEqual([String(visible.id)]);
  });
});

describe('toggleHelpful', () => {
  it('toggles on then off (1 → 0)', async () => {
    const created = await postReview('oxy-vote-author', { address: { street: `Carrer Vote ${SUITE}`, number: '11' } });
    const app = buildApp('oxy-voter');

    const first = await request(app).post(`/reviews/${created.id}/helpful`);
    expect(first.status).toBe(200);
    expect(first.body.helpfulCount).toBe(1);
    expect(first.body.viewerHasVotedHelpful).toBe(true);

    const second = await request(app).post(`/reviews/${created.id}/helpful`);
    expect(second.status).toBe(200);
    expect(second.body.helpfulCount).toBe(0);
    expect(second.body.viewerHasVotedHelpful).toBe(false);
  });

  it('rejects voting on your own review with 400', async () => {
    const created = await postReview('oxy-self-vote', { address: { street: `Carrer Self ${SUITE}`, number: '12' } });
    const res = await request(buildApp('oxy-self-vote')).post(`/reviews/${created.id}/helpful`);
    expect(res.status).toBe(400);
  });

  /**
   * A uuid v7 id, which is what every review created after the cutover carries.
   *
   * The eight deleted `Types.ObjectId.isValid` guards would have answered
   * "Invalid review ID" here — for a review that had just been created by this
   * very suite.
   */
  it('accepts a uuid v7 review id, which the deleted guards would have refused', async () => {
    const created = await postReview('oxy-uuid-author', { address: { street: `Carrer Uuid ${SUITE}`, number: '13' } });
    expect(String(created.id)).not.toMatch(/^[0-9a-f]{24}$/);
    const res = await request(buildApp('oxy-uuid-voter')).post(`/reviews/${created.id}/helpful`);
    expect(res.status).toBe(200);
  });
});

/** The report rows Postgres holds for one review. */
async function reportsForReview(reviewId: string) {
  return getDb().select().from(reviewReports).where(eq(reviewReports.reviewId, reviewId));
}

/** The moderation status Postgres holds for one review. */
async function moderationStatusOf(reviewId: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ moderationStatus: reviewsTable.moderationStatus })
    .from(reviewsTable)
    .where(eq(reviewsTable.id, reviewId));
  return row?.moderationStatus;
}

describe('reportReview', () => {
  it('dedupes repeat reports from the same reporter', async () => {
    const created = await postReview('oxy-report-author', { address: { street: `Carrer Report ${SUITE}`, number: '14' } });
    const reviewId = String(created.id);
    const app = buildApp('oxy-reporter');

    const first = await request(app).post(`/reviews/${reviewId}/report`).send({ reason: 'spam' });
    expect(first.status).toBe(201);

    const second = await request(app).post(`/reviews/${reviewId}/report`).send({ reason: 'spam' });
    expect(second.status).toBe(200);

    // One ROW, not one subdocument — and the count matters beyond tidiness: it
    // is what the escalation below compares against three, so a duplicate is a
    // vote for removal cast twice by one person.
    expect(await reportsForReview(reviewId)).toHaveLength(1);
  });

  it('requires details when the reason is "other"', async () => {
    const created = await postReview('oxy-other-author', { address: { street: `Carrer Other ${SUITE}`, number: '15' } });
    const res = await request(buildApp('oxy-reporter')).post(`/reviews/${created.id}/report`).send({ reason: 'other' });
    expect(res.status).toBe(400);
  });

  it('escalates to under_review after 3 distinct reporters', async () => {
    const created = await postReview('oxy-escalate-author', { address: { street: `Carrer Escalate ${SUITE}`, number: '16' } });
    const reviewId = String(created.id);

    expect(await moderationStatusOf(reviewId)).toBe('active');
    for (const reporter of ['r1', 'r2', 'r3']) {
      const res = await request(buildApp(reporter)).post(`/reviews/${reviewId}/report`).send({ reason: 'fake' });
      expect(res.status).toBe(201);
    }

    expect(await reportsForReview(reviewId)).toHaveLength(3);
    expect(await moderationStatusOf(reviewId)).toBe('under_review');
  });

  it('keeps under_review reviews visible in agency reads but hides removed ones', async () => {
    const agency = await findOrCreateAgencyByName(`Visible Agency ${SUITE}`);
    expect(agency).not.toBeNull();
    if (!agency) return;

    const shown = await postReview('oxy-a', { address: { street: `Carrer Visible ${SUITE}`, number: '17' } });
    const hidden = await postReview('oxy-b', { address: { street: `Carrer Visible ${SUITE}`, number: '18' } });
    await amendReview(String(shown.id), { agencyId: agency.id, moderationStatus: 'under_review' });
    await amendReview(String(hidden.id), { agencyId: agency.id, moderationStatus: 'removed' });

    const res = await request(buildApp()).get(`/agencies/${agency.slug}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.reviews).toHaveLength(1);
    expect(res.body.reviews[0].id).toBe(String(shown.id));
  });
});

/** A published Postgres listing managed by an agency. */
async function seedAgencyListing(agencyId: string, label: string): Promise<string> {
  const chain = await seedGeoChain({ cityName: `Listings ${label} ${SUITE}`, countryCode: `L${label.slice(0, 1).toUpperCase()}` });
  const addressId = await seedAddress({ chain, street: `Carrer Listing ${label} ${SUITE}` });
  return seedProperty({
    addressId,
    overrides: {
      oxyUserId: 'oxy-owner',
      agencyId,
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1200,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
    },
  });
}

describe('agency reads', () => {
  it('returns agency stats + listings count', async () => {
    const agency = await findOrCreateAgencyByName(`Stats Agency ${SUITE}`);
    expect(agency).not.toBeNull();
    if (!agency) return;

    await seedAgencyListing(agency.id, 'stats');

    const first = await postReview('oxy-stats-a', { address: { street: `Carrer Stats ${SUITE}`, number: '19' } });
    const second = await postReview('oxy-stats-b', { address: { street: `Carrer Stats ${SUITE}`, number: '20' } });
    await amendReview(String(first.id), { agencyId: agency.id, rating: 5, recommendation: true, depositReturned: 'full' });
    await amendReview(String(second.id), { agencyId: agency.id, rating: 3, recommendation: false, depositReturned: 'no' });

    const res = await request(buildApp()).get(`/agencies/${agency.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.agency).toMatchObject({ name: `Stats Agency ${SUITE}`, slug: agency.slug });
    expect(res.body.stats.totalReviews).toBe(2);
    expect(res.body.stats.averageRating).toBe(4);
    expect(res.body.stats.recommendationPercentage).toBe(50);
    expect(res.body.stats.depositFullPct).toBe(50);
    expect(res.body.stats.listingsCount).toBe(1);
  });

  it('lists agency properties with flat pagination aliases', async () => {
    const agency = await findOrCreateAgencyByName(`Props Agency ${SUITE}`);
    expect(agency).not.toBeNull();
    if (!agency) return;
    const propertyId = await seedAgencyListing(agency.id, 'props');

    const res = await request(buildApp()).get(`/agencies/${agency.slug}/properties`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(propertyId);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.totalPages).toBe(1);
    expect(res.body.total).toBe(1);
  });

  it('prefix-searches agencies by normalized name', async () => {
    await findOrCreateAgencyByName(`Fincas Buscada ${SUITE}`);
    await findOrCreateAgencyByName(`Other Realty ${SUITE}`);

    const res = await request(buildApp()).get('/agencies/search').query({ q: `fincas buscada ${SUITE}` });
    expect(res.status).toBe(200);
    expect(res.body.agencies).toHaveLength(1);
    expect(res.body.agencies[0]).toMatchObject({ name: `Fincas Buscada ${SUITE}` });
  });

  /**
   * The LIKE escape, not the regex escape.
   *
   * Mongo ran the term through `escapeRegex`; the Postgres form is `LIKE`, whose
   * metacharacter set is `%`, `_` and `\`. A term containing `%` would silently
   * stop filtering — see `db/likePattern.ts`.
   */
  it('treats a wildcard character in the search term literally', async () => {
    await findOrCreateAgencyByName(`Wildcard ${SUITE}`);
    const res = await request(buildApp()).get('/agencies/search').query({ q: '%' });
    expect(res.status).toBe(200);
    expect(res.body.agencies).toHaveLength(0);
  });

  it('returns 404 for an unknown agency slug', async () => {
    const res = await request(buildApp()).get('/agencies/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('the hierarchical address reads', () => {
  it('answers a BUILDING address with its own reviews, its flats, and the rollup', async () => {
    const street = `Carrer Hierarchy ${SUITE}`;
    const buildingReview = await postReview('oxy-h-building', { address: { street, number: '30' } });
    const flatReview = await postReview('oxy-h-flat', { address: { street, number: '30', unit: '1a' } });

    const [storedFlat] = await getDb()
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, String(flatReview.id)));
    expect(storedFlat.addressLevel).toBe('UNIT');
    // The fix: the flat's building is the building address, not the flat itself.
    expect(storedFlat.buildingLevelId).toBe(String(buildingReview.addressId));

    const res = await request(buildApp()).get(`/addresses/${buildingReview.addressId}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.level).toBe('BUILDING');
    expect(res.body.buildingReviews.map((review: { id: string }) => review.id)).toEqual([String(buildingReview.id)]);
    expect(res.body.unitReviews.map((review: { id: string }) => review.id)).toEqual([String(flatReview.id)]);
    expect(res.body.aggregatedStats.totalReviews).toBe(2);
    expect(res.body.totalReviews).toBe(2);

    const stats = await request(buildApp()).get(`/addresses/${buildingReview.addressId}/stats`);
    expect(stats.status).toBe(200);
    expect(stats.body.stats).toMatchObject({
      level: 'BUILDING',
      buildingReviewCount: 1,
      unitReviewCount: 1,
    });
  });

  it('answers a UNIT address with its own reviews and its building summary', async () => {
    const street = `Carrer Unit ${SUITE}`;
    await postReview('oxy-u-building', { address: { street, number: '40' } });
    const flatReview = await postReview('oxy-u-flat', { address: { street, number: '40', unit: '2b' } });

    const res = await request(buildApp()).get(`/addresses/${flatReview.addressId}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.level).toBe('UNIT');
    expect(res.body.unitReviews.map((review: { id: string }) => review.id)).toEqual([String(flatReview.id)]);
    // The building summary counts BUILDING-level reviews only, which is why it
    // reads 1 rather than 2.
    expect(res.body.buildingSummary.totalReviews).toBe(1);

    const stats = await request(buildApp()).get(`/addresses/${flatReview.addressId}/stats`);
    expect(stats.body.stats.level).toBe('UNIT');
    expect(stats.body.stats.unitStats.totalReviews).toBe(1);
  });

  it('answers a STREET address with the rollup and a distinct building count', async () => {
    const street = `Carrer Street ${SUITE}`;
    const first = await postReview('oxy-s-a', { address: { street, number: '50' } });
    await postReview('oxy-s-b', { address: { street, number: '51' } });

    const [stored] = await getDb()
      .select()
      .from(reviewsTable)
      .where(eq(reviewsTable.id, String(first.id)));

    const res = await request(buildApp()).get(`/addresses/${stored.streetLevelId}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.level).toBe('STREET');
    expect(res.body.buildingCount).toBe(2);
    expect(res.body.aggregatedStats.totalReviews).toBe(2);
  });

  it('404s an address that does not exist, for every id shape', async () => {
    expect((await request(buildApp()).get(`/addresses/${uuidv7()}/reviews`)).status).toBe(404);
    expect((await request(buildApp()).get('/addresses/6a78735979b1a7d9f19af7a7/reviews')).status).toBe(404);
    expect((await request(buildApp()).get('/addresses/not-an-id-at-all/reviews')).status).toBe(404);
  });
});

describe('review explore aggregations', () => {
  it('summarizes cities → neighborhoods → buildings', async () => {
    // Its OWN neighborhood, so the building page is this test's two rows rather
    // than whatever the rest of the file has already put in `NEIGHBORHOOD` —
    // that list is paginated at ten, and a shared one makes the assertion depend
    // on test ORDER.
    const neighborhood = `Explorable ${uuidv7().slice(-8)}`;
    await postReview('oxy-e-1', {
      address: { street: `Carrer Explore ${SUITE}`, number: '60', neighborhood },
      review: { rating: 4, recommendation: true },
    });
    await postReview('oxy-e-2', {
      address: { street: `Carrer Explore ${SUITE}`, number: '61', neighborhood },
      review: { rating: 2, recommendation: false },
    });

    const cities = await request(buildApp()).get('/reviews-explore');
    expect(cities.status).toBe(200);
    const barcelona = cities.body.cities.find((city: { name: string }) => city.name === CITY);
    expect(barcelona).toBeTruthy();
    expect(barcelona.reviewCount).toBeGreaterThanOrEqual(2);

    const neighborhoods = await request(buildApp()).get(`/reviews-explore/city/${barcelona.cityId}`);
    expect(neighborhoods.status).toBe(200);
    const explorable = neighborhoods.body.neighborhoods.find(
      (entry: { name: string }) => entry.name === neighborhood,
    );
    expect(explorable).toBeTruthy();
    expect(explorable.reviewCount).toBe(2);
    expect(explorable.averageRating).toBe(3);
    // The neighborhood the rest of the file uses is a DIFFERENT row in the same
    // city, which is what makes the grouping — rather than the city filter —
    // the thing under test.
    expect(neighborhoods.body.neighborhoods.some((entry: { name: string }) => entry.name === NEIGHBORHOOD)).toBe(true);

    const buildings = await request(buildApp()).get(`/reviews-explore/neighborhood/${explorable.neighborhoodId}`);
    expect(buildings.status).toBe(200);
    expect(buildings.body.buildings).toHaveLength(2);
    expect(
      buildings.body.buildings.every((building: { street: string }) => building.street === `Carrer Explore ${SUITE}`),
    ).toBe(true);
    expect(buildings.body.buildings.map((building: { number: string }) => building.number).sort()).toEqual(['60', '61']);
  });

  it('excludes removed reviews from explore coverage', async () => {
    const isolatedCity = `Quietville ${uuidv7()}`;
    const created = await postReview('oxy-e-removed', {
      address: { street: `Carrer Quiet ${SUITE}`, number: '70', city: isolatedCity, neighborhood: `Silent ${SUITE}` },
    });
    await amendReview(String(created.id), { moderationStatus: 'removed' });

    const cities = await request(buildApp()).get('/reviews-explore');
    expect(cities.body.cities.find((city: { name: string }) => city.name === isolatedCity)).toBeUndefined();
  });

  it('accepts a uuid v7 city id, which the deleted guard would have refused', async () => {
    const cities = await request(buildApp()).get('/reviews-explore');
    const barcelona = cities.body.cities.find((city: { name: string }) => city.name === CITY);
    expect(String(barcelona.cityId)).not.toMatch(/^[0-9a-f]{24}$/);

    const res = await request(buildApp()).get(`/reviews-explore/city/${barcelona.cityId}`);
    expect(res.status).toBe(200);
  });
});

describe('the review-created notification fan-out', () => {
  /**
   * `Property.distinct('oxyUserId', …)` became `selectDistinct`, and BOTH halves
   * of its `$nin: [null, '']` are carried across. The fixture has one owner, one
   * external listing with a NULL owner and one with an EMPTY-STRING owner at the
   * same address — the shape that tells a complete filter from a partial one,
   * since either omission dispatches to a recipient that is not a person.
   */
  it('notifies only real owners at the reviewed address', async () => {
    const chain = await seedGeoChain({ cityName: `Ownerville ${uuidv7()}`, countryCode: 'OW' });
    const addressId = await seedAddress({ chain, street: `Carrer Owner ${uuidv7()}` });

    await seedProperty({ addressId, overrides: { oxyUserId: 'oxy-real-owner' } });
    await seedProperty({ addressId, overrides: { oxyUserId: null } });
    await seedProperty({ addressId, overrides: { oxyUserId: '' } });

    expect(await findOwnerOxyUserIdsAtAddresses([addressId])).toEqual(['oxy-real-owner']);
    expect(await findOwnerOxyUserIdsAtAddresses([])).toEqual([]);
  });
});

describe('nothing in this controller reaches Mongo', () => {
  /**
   * A guard against the failure mode `db/MIGRATION-CONTRACT.md` opens with: a
   * stale Mongo read against a collection whose rows live in Postgres is not an
   * error, it is an empty result.
   */
  it('has no mongoose import left in reviewController', () => {
    const source = readFileSync(join(__dirname, '../../controllers/reviewController.ts'), 'utf8');
    // Anti-vacuity: a path typo would read as a clean pass, so assert the file
    // really is the one under test before asserting what it does not contain.
    expect(source).toContain('export const createReview');
    expect(source).not.toMatch(/from 'mongoose'/);
    expect(source).not.toMatch(/from '\.\.\/models'/);
  });

  /**
   * The Mongoose model still exists and nothing in the request path reads it.
   *
   * This is the guard that says so: every review in this file was created
   * through the real controller, so a single stray Mongo write anywhere in the
   * create path would show up here as a non-zero count.
   */
  it('leaves no review rows behind in Mongo', async () => {
    expect(await Review.countDocuments({})).toBe(0);
  });
});
