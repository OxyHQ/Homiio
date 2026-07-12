/**
 * Admin moderation queue — the admin gate, the review + eviction queue filters,
 * the moderation transitions, and the admin-only `reports` projection.
 *
 * Uses the real admin router (so `requireAdmin` runs end-to-end) + real models
 * on in-memory Mongo, behind a fake-auth middleware (mirrors evictionBoard /
 * leaseOwnership). `config.admin.oxyUserIds` is set per test to drive the gate.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { Types } from 'mongoose';

import config from '../../config';

const adminRouter = require('../../routes/admin').default;
const reviewController = require('../../controllers/reviewController');
const { Review, EvictionCase, EvictionReport } = require('../../models');
const { errorHandler } = require('../../middlewares/errorHandler');

const ADMIN = 'oxy-admin';

beforeEach(() => {
  // Default: a single configured admin. Individual tests override this.
  config.admin.oxyUserIds = [ADMIN];
});

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
  app.use('/api/admin', adminRouter());
  // Public read — used to prove the public DTO still strips `reports`.
  app.get('/api/reviews/:reviewId', (req, res) => reviewController.getReviewById(req, res));
  app.use(errorHandler);
  return app;
}

interface ReviewReportSeed {
  oxyUserId: string;
  reason: string;
  details?: string;
}

async function seedReview(
  overrides: Record<string, unknown> = {},
  reports: ReviewReportSeed[] = [],
): Promise<string> {
  const addressId = new Types.ObjectId();
  const review = await Review.create({
    addressId,
    addressLevel: 'BUILDING',
    streetLevelId: addressId,
    buildingLevelId: addressId,
    oxyUserId: 'oxy-author',
    title: 'A perfectly reasonable review title',
    price: 1000,
    currency: 'EUR',
    livedFrom: new Date('2020-01-01'),
    livedTo: new Date('2021-01-01'),
    rating: 4,
    recommendation: true,
    opinion: 'Lived here a while — a reasonable opinion string.',
    reports,
    ...overrides,
  });
  return String(review._id);
}

async function seedCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const evictionCase = await EvictionCase.create({
    oxyUserId: 'oxy-owner',
    title: 'Desahucio en Carrer de Sants',
    description: 'Familia con menores — necesitamos presencia para pararlo.',
    location: {
      label: 'Carrer de Sants, Barcelona',
      coordinates: { type: 'Point', coordinates: [2.132, 41.376] },
      precision: 'approximate',
      city: 'Barcelona',
      countryCode: 'ES',
    },
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    ...overrides,
  });
  return String(evictionCase._id);
}

async function seedEvictionReport(
  caseId: string,
  reporter: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await EvictionReport.create({
    caseId,
    reporterOxyUserId: reporter,
    reason: 'inappropriate',
    status: 'open',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Admin gate.
// ---------------------------------------------------------------------------

describe('admin gate (requireAdmin)', () => {
  const dummyId = new Types.ObjectId().toString();
  const endpoints: { method: 'get' | 'post'; path: string }[] = [
    { method: 'get', path: '/api/admin/moderation/reviews' },
    { method: 'post', path: `/api/admin/moderation/reviews/${dummyId}` },
    { method: 'get', path: '/api/admin/moderation/evictions' },
    { method: 'post', path: `/api/admin/moderation/evictions/${dummyId}` },
  ];

  it('rejects an authenticated non-admin with 403 on every endpoint', async () => {
    for (const { method, path } of endpoints) {
      const app = buildApp('oxy-rando');
      const res = await (method === 'get'
        ? request(app).get(path)
        : request(app).post(path).send({ action: 'remove' }));
      expect(res.status).toBe(403);
    }
  });

  it('rejects an unauthenticated request with 401 on every endpoint', async () => {
    for (const { method, path } of endpoints) {
      const app = buildApp();
      const res = await (method === 'get'
        ? request(app).get(path)
        : request(app).post(path).send({ action: 'remove' }));
      expect(res.status).toBe(401);
    }
  });

  it('denies everyone — including a would-be admin — when the allowlist is empty', async () => {
    config.admin.oxyUserIds = [];
    for (const { method, path } of endpoints) {
      const app = buildApp(ADMIN);
      const res = await (method === 'get'
        ? request(app).get(path)
        : request(app).post(path).send({ action: 'remove' }));
      expect(res.status).toBe(403);
    }
  });

  it('lets a configured admin through the gate (200)', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Reviews queue.
// ---------------------------------------------------------------------------

describe('GET /api/admin/moderation/reviews — filters + admin reports projection', () => {
  async function seedQueue() {
    const underReview = await seedReview(
      { moderationStatus: 'under_review' },
      [
        { oxyUserId: 'r1', reason: 'spam' },
        { oxyUserId: 'r2', reason: 'offensive', details: 'abusive' },
        { oxyUserId: 'r3', reason: 'fake' },
      ],
    );
    const reportedActive = await seedReview({ moderationStatus: 'active' }, [
      { oxyUserId: 'r4', reason: 'spam' },
    ]);
    const removed = await seedReview({ moderationStatus: 'removed' });
    const clean = await seedReview({ moderationStatus: 'active' });
    return { underReview, reportedActive, removed, clean };
  }

  it('under_review returns only reviews flagged for moderation', async () => {
    const seeded = await seedQueue();
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews?filter=under_review');
    expect(res.status).toBe(200);
    const ids = res.body.reviews.map((r: { id: string }) => r.id);
    expect(ids).toEqual([seeded.underReview]);
  });

  it('reported returns every review with at least one report', async () => {
    const seeded = await seedQueue();
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews?filter=reported');
    expect(res.status).toBe(200);
    const ids = res.body.reviews.map((r: { id: string }) => r.id).sort();
    expect(ids).toEqual([seeded.underReview, seeded.reportedActive].sort());
  });

  it('removed returns only removed reviews', async () => {
    const seeded = await seedQueue();
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews?filter=removed');
    expect(res.status).toBe(200);
    const ids = res.body.reviews.map((r: { id: string }) => r.id);
    expect(ids).toEqual([seeded.removed]);
  });

  it('defaults to the under_review filter when none is supplied', async () => {
    const seeded = await seedQueue();
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews');
    expect(res.status).toBe(200);
    const ids = res.body.reviews.map((r: { id: string }) => r.id);
    expect(ids).toEqual([seeded.underReview]);
  });

  it('rejects an unknown filter with 400', async () => {
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews?filter=bogus');
    expect(res.status).toBe(400);
  });

  it('INCLUDES the reports array in the admin response', async () => {
    const seeded = await seedQueue();
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews?filter=under_review');
    const review = res.body.reviews.find((r: { id: string }) => r.id === seeded.underReview);
    expect(Array.isArray(review.reports)).toBe(true);
    expect(review.reports).toHaveLength(3);
    expect(review.reports[0]).toMatchObject({ oxyUserId: 'r1', reason: 'spam' });
    expect(review.reports[1]).toMatchObject({ reason: 'offensive', details: 'abusive' });
  });

  it('the PUBLIC review read still strips reports', async () => {
    const seeded = await seedQueue();
    const res = await request(buildApp()).get(`/api/reviews/${seeded.underReview}`);
    expect(res.status).toBe(200);
    expect(res.body.review.reports).toBeUndefined();
    expect(res.body.review.helpfulVoters).toBeUndefined();
  });

  it('exposes flat hasMore / totalPages pagination aliases', async () => {
    await seedReview({ moderationStatus: 'under_review' });
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/reviews?limit=1');
    expect(res.body).toHaveProperty('hasMore');
    expect(res.body).toHaveProperty('totalPages');
    expect(res.body.pagination).toMatchObject({ currentPage: 1, limit: 1 });
  });
});

describe('POST /api/admin/moderation/reviews/:reviewId — transitions', () => {
  it('remove sets moderationStatus to removed', async () => {
    const id = await seedReview({ moderationStatus: 'under_review' });
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/reviews/${id}`).send({ action: 'remove' });
    expect(res.status).toBe(200);
    expect(res.body.review.moderationStatus).toBe('removed');
    expect((await Review.findById(id)).moderationStatus).toBe('removed');
  });

  it('restore sets moderationStatus back to active', async () => {
    const id = await seedReview({ moderationStatus: 'removed' });
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/reviews/${id}`).send({ action: 'restore' });
    expect(res.status).toBe(200);
    expect(res.body.review.moderationStatus).toBe('active');
    expect((await Review.findById(id)).moderationStatus).toBe('active');
  });

  it('dismiss_reports clears reports and returns to active', async () => {
    const id = await seedReview({ moderationStatus: 'under_review' }, [
      { oxyUserId: 'r1', reason: 'spam' },
      { oxyUserId: 'r2', reason: 'fake' },
    ]);
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/reviews/${id}`).send({ action: 'dismiss_reports' });
    expect(res.status).toBe(200);
    expect(res.body.review.moderationStatus).toBe('active');
    expect(res.body.review.reports).toHaveLength(0);
    const persisted = await Review.findById(id);
    expect(persisted.reports).toHaveLength(0);
    expect(persisted.moderationStatus).toBe('active');
  });

  it('rejects an invalid action with 400', async () => {
    const id = await seedReview({ moderationStatus: 'under_review' });
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/reviews/${id}`).send({ action: 'nuke' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown review', async () => {
    const missing = new Types.ObjectId().toString();
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/reviews/${missing}`).send({ action: 'remove' });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Evictions queue.
// ---------------------------------------------------------------------------

describe('GET /api/admin/moderation/evictions — grouped open reports', () => {
  it('groups open reports per case and omits cases without open reports', async () => {
    const reportedCase = await seedCase({ title: 'Reported case' });
    await seedEvictionReport(reportedCase, 'reporter-a');
    await seedEvictionReport(reportedCase, 'reporter-b', { reason: 'scam' });
    await seedCase({ title: 'Clean case' }); // no reports → excluded

    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/evictions');
    expect(res.status).toBe(200);
    expect(res.body.cases).toHaveLength(1);
    expect(res.body.cases[0].case.id).toBe(reportedCase);
    expect(res.body.cases[0].case.title).toBe('Reported case');
    expect(res.body.cases[0].reports).toHaveLength(2);
    expect(res.body).toHaveProperty('hasMore');
    expect(res.body).toHaveProperty('totalPages');
  });

  it('ignores already-resolved / dismissed reports', async () => {
    const caseId = await seedCase();
    await seedEvictionReport(caseId, 'reporter-a', { status: 'resolved' });
    const res = await request(buildApp(ADMIN)).get('/api/admin/moderation/evictions');
    expect(res.body.cases).toHaveLength(0);
  });
});

describe('POST /api/admin/moderation/evictions/:caseId — transitions', () => {
  it('remove cancels the case and resolves its open reports', async () => {
    const caseId = await seedCase();
    await seedEvictionReport(caseId, 'reporter-a');
    await seedEvictionReport(caseId, 'reporter-b');

    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/evictions/${caseId}`).send({ action: 'remove' });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe('cancelled');
    expect(res.body.resolvedReports).toBe(2);

    expect((await EvictionCase.findById(caseId)).status).toBe('cancelled');
    expect(await EvictionReport.countDocuments({ caseId, status: 'open' })).toBe(0);
    expect(await EvictionReport.countDocuments({ caseId, status: 'resolved' })).toBe(2);
    // Non-destructive: the case document is NOT deleted.
    expect(await EvictionCase.findById(caseId)).not.toBeNull();
  });

  it('dismiss_reports dismisses open reports and leaves the case untouched', async () => {
    const caseId = await seedCase();
    await seedEvictionReport(caseId, 'reporter-a');

    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/evictions/${caseId}`).send({ action: 'dismiss_reports' });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe('upcoming');
    expect(res.body.dismissedReports).toBe(1);

    expect((await EvictionCase.findById(caseId)).status).toBe('upcoming');
    expect(await EvictionReport.countDocuments({ caseId, status: 'dismissed' })).toBe(1);
  });

  it('rejects an invalid action with 400', async () => {
    const caseId = await seedCase();
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/evictions/${caseId}`).send({ action: 'restore' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown case', async () => {
    const missing = new Types.ObjectId().toString();
    const res = await request(buildApp(ADMIN)).post(`/api/admin/moderation/evictions/${missing}`).send({ action: 'remove' });
    expect(res.status).toBe(404);
  });
});
