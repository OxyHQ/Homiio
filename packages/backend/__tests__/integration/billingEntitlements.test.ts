/**
 * The billing surface a signed-in person actually reaches, through the REAL
 * routers and controllers against the REAL Postgres this worker owns.
 *
 * `stripeWebhook.test.ts` covers the inbound Stripe path; this covers the other
 * eight handlers and the two entitlement routes on the profile router, which is
 * where the wire shape is decided. That shape is a contract with a shipped
 * mobile build (`packages/frontend/store/subscriptionStore.ts`), so the
 * assertions below are about the RESPONSE and not only about the rows.
 *
 * Stripe is never called for real: the SDK is mocked, so every handler that
 * consults it is driven from here.
 */

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const subscriptionsRetrieve = jest.fn();
const subscriptionsUpdate = jest.fn();
const checkoutSessionsRetrieve = jest.fn();
const stripeInstance = {
  webhooks: { constructEvent: jest.fn() },
  checkout: { sessions: { retrieve: checkoutSessionsRetrieve } },
  subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
};
jest.mock('stripe', () => jest.fn(() => stripeInstance));

import express, { type Express } from 'express';
import request from 'supertest';
import { uuidv7 } from '@oxyhq/db';

import {
  confirmCheckoutSession,
  debugBillingStatus,
  manuallyActivateSubscription,
  manuallyCancelSubscription,
  reactivateSubscription,
  syncSubscriptionStatus,
} from '../../controllers/billingController';
import { creditCheckoutSession, findBillingByOxyUserId } from '../../db/billing/billingRepository';
import { getDb } from '../../db/postgres';
import { billing } from '../../db/schema';
import profilesRouter from '../../routes/profiles';

function buildApp(oxyUserId: string | null): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    next();
  });
  app.use('/profiles', profilesRouter());
  app.post('/billing/confirm', (req, res) => void confirmCheckoutSession(req, res));
  app.post('/billing/manual-activate', (req, res) => void manuallyActivateSubscription(req, res));
  app.post('/billing/manual-cancel', (req, res) => void manuallyCancelSubscription(req, res));
  app.post('/billing/reactivate', (req, res) => void reactivateSubscription(req, res));
  app.post('/billing/sync', (req, res) => void syncSubscriptionStatus(req, res));
  app.get('/billing/debug', (req, res) => void debugBillingStatus(req, res));
  return app;
}

const account = (): string => `oxy-${uuidv7()}`;
const stripeId = (prefix: string): string => `${prefix}_${uuidv7().replace(/-/g, '')}`;

beforeEach(async () => {
  jest.clearAllMocks();
  await getDb().delete(billing);
});

describe('GET /profiles/me/entitlements', () => {
  /**
   * An account that has never paid gets the free shape and NO row is created.
   * The read minting a record would make "has this account ever paid?"
   * unanswerable, and the frontend store defaults to exactly this object.
   */
  it('answers the free shape without creating a record', async () => {
    const oxyUserId = account();

    const res = await request(buildApp(oxyUserId)).get('/profiles/me/entitlements');

    expect(res.status).toBe(200);
    expect(res.body.entitlements).toEqual({
      plusActive: false,
      fileCredits: 0,
      founderSupporter: false,
      processedSessions: [],
    });
    expect(await findBillingByOxyUserId(oxyUserId)).toBeNull();
  });

  /**
   * The shipped mobile build declares `processedSessions: string[]` as REQUIRED
   * on `Entitlements`. It became a TABLE in this port, and the wire contract is
   * deliberately held — a type asserting a field the server stopped sending is
   * the two-sided break `~/Oxy/AGENTS.md` records against Homiio's own
   * `_id` → `id` change.
   */
  it('keeps every field the frontend Entitlements type declares', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');
    await creditCheckoutSession({
      oxyUserId,
      sessionId,
      product: 'plus',
      stripeSubscriptionId: stripeId('sub'),
    });

    const res = await request(buildApp(oxyUserId)).get('/profiles/me/entitlements');

    expect(res.status).toBe(200);
    expect(res.body.entitlements.plusActive).toBe(true);
    expect(res.body.entitlements.fileCredits).toBe(0);
    expect(res.body.entitlements.founderSupporter).toBe(false);
    expect(res.body.entitlements.processedSessions).toEqual([sessionId]);
    expect(typeof res.body.entitlements.plusSince).toBe('string');
    // Mongo baggage does not travel.
    expect(res.body.entitlements).not.toHaveProperty('_id');
    expect(res.body.entitlements).not.toHaveProperty('__v');
  });

  it('requires authentication', async () => {
    const res = await request(buildApp(null)).get('/profiles/me/entitlements');
    expect(res.status).toBe(401);
  });
});

describe('POST /profiles/me/entitlements/consume-file-credit', () => {
  it('refuses with 402 when there are no credits', async () => {
    const res = await request(buildApp(account())).post(
      '/profiles/me/entitlements/consume-file-credit',
    );

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('NO_CREDITS');
  });

  it('spends a credit and reports the remainder', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });

    const res = await request(buildApp(oxyUserId)).post(
      '/profiles/me/entitlements/consume-file-credit',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, remaining: 0, consumed: true });
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(0);
  });

  it('consumes nothing for a Plus subscriber', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: stripeId('sub'),
    });

    const res = await request(buildApp(oxyUserId)).post(
      '/profiles/me/entitlements/consume-file-credit',
    );

    expect(res.body).toEqual({ success: true, remaining: 'unlimited', consumed: false });
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(1);
  });
});

describe('POST /billing/confirm — the post-redirect finalisation', () => {
  /**
   * The confirm endpoint and the webhook race for the same session by design:
   * the buyer is redirected back the instant Stripe accepts the payment, which
   * is often before the webhook is delivered. Both take the SAME claim, so
   * whichever arrives second credits nothing.
   */
  it('credits once even when the webhook already did', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');
    await creditCheckoutSession({ oxyUserId, sessionId, product: 'file' });

    checkoutSessionsRetrieve.mockResolvedValue({
      id: sessionId,
      payment_status: 'paid',
      status: 'complete',
      client_reference_id: oxyUserId,
      metadata: { product: 'file', oxyUserId },
    });

    const res = await request(buildApp(oxyUserId))
      .post('/billing/confirm')
      .send({ session_id: sessionId });

    expect(res.status).toBe(200);
    expect((await findBillingByOxyUserId(oxyUserId))?.fileCredits).toBe(1);
  });

  it('activates Plus and answers with the entitlements', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');
    const subscriptionId = stripeId('sub');
    checkoutSessionsRetrieve.mockResolvedValue({
      id: sessionId,
      payment_status: 'paid',
      status: 'complete',
      client_reference_id: oxyUserId,
      subscription: { id: subscriptionId },
      metadata: { product: 'plus', oxyUserId },
    });

    const res = await request(buildApp(oxyUserId))
      .post('/billing/confirm')
      .send({ session_id: sessionId });

    expect(res.status).toBe(200);
    expect(res.body.entitlements.plusActive).toBe(true);
    // Stripe returns the EXPANDED subscription here (the handler asks for it);
    // reading `.id` off the string form would have indexed into a string.
    expect(res.body.entitlements.plusStripeSubscriptionId).toBe(subscriptionId);
  });

  it('refuses a session that is not paid', async () => {
    checkoutSessionsRetrieve.mockResolvedValue({
      id: stripeId('cs'),
      payment_status: 'unpaid',
      status: 'open',
    });

    const res = await request(buildApp(account()))
      .post('/billing/confirm')
      .send({ session_id: 'cs_open' });

    expect(res.status).toBe(409);
  });
});

describe('POST /billing/manual-activate — the fallback when a webhook never arrives', () => {
  it('activates Plus, then reports the repeat as already activated', async () => {
    const oxyUserId = account();
    const sessionId = stripeId('cs');
    const app = buildApp(oxyUserId);

    const first = await request(app)
      .post('/billing/manual-activate')
      .send({ session_id: sessionId, product: 'plus' });

    expect(first.status).toBe(200);
    expect(first.body.message).toBe('Plus subscription activated successfully');
    expect(first.body.entitlements.plusActive).toBe(true);

    const second = await request(app)
      .post('/billing/manual-activate')
      .send({ session_id: sessionId, product: 'plus' });

    expect(second.status).toBe(200);
    expect(second.body.message).toBe('Subscription already activated');
  });

  /**
   * `founder` is deliberately NOT reachable here: this endpoint grants an
   * entitlement with no Stripe evidence, so its product list stays as narrow as
   * the Mongo handler's was.
   */
  it('refuses a product it does not sell, and creates nothing', async () => {
    const oxyUserId = account();

    const res = await request(buildApp(oxyUserId))
      .post('/billing/manual-activate')
      .send({ session_id: stripeId('cs'), product: 'founder' });

    expect(res.status).toBe(400);
    expect(await findBillingByOxyUserId(oxyUserId)).toBeNull();
  });
});

describe('cancel, reactivate and sync', () => {
  it('answers 404 when there is no record to cancel', async () => {
    const res = await request(buildApp(account())).post('/billing/manual-cancel');
    expect(res.status).toBe(404);
  });

  it('cancels and returns the updated entitlements', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: stripeId('sub'),
    });

    const res = await request(buildApp(oxyUserId)).post('/billing/manual-cancel');

    expect(res.status).toBe(200);
    expect(res.body.entitlements.plusActive).toBe(false);
    expect(typeof res.body.entitlements.plusCanceledAt).toBe('string');
  });

  /**
   * Reactivating must CLEAR the cancellation stamp. The Mongo spelling was
   * `$set: { plusCanceledAt: undefined }`, which Mongoose strips — so it never
   * did, and `syncSubscriptionStatus`'s guard (`|| billing.plusCanceledAt`) then
   * reported `statusChanged: true` on every later call, forever. The fixture
   * CANCELS first, because clearing an already-absent value cannot tell a real
   * clear from a no-op.
   */
  it('clears the cancellation stamp on reactivate', async () => {
    const oxyUserId = account();
    const subscriptionId = stripeId('sub');
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: subscriptionId,
    });
    const app = buildApp(oxyUserId);
    await request(app).post('/billing/manual-cancel');
    expect((await findBillingByOxyUserId(oxyUserId))?.plusCanceledAt).toBeInstanceOf(Date);

    subscriptionsUpdate.mockResolvedValue({ id: subscriptionId, cancel_at_period_end: false });
    const res = await request(app).post('/billing/reactivate');

    expect(res.status).toBe(200);
    expect(res.body.entitlements.plusActive).toBe(true);
    expect(res.body.entitlements.plusCanceledAt).toBeNull();
    expect((await findBillingByOxyUserId(oxyUserId))?.plusCanceledAt).toBeNull();
  });

  /**
   * The same clear, one endpoint over — and the assertion that pins the defect
   * rather than the fix: a SECOND sync must report `statusChanged: false`,
   * which it could not do while the stamp survived.
   */
  it('syncs an active subscription once and then reports no change', async () => {
    const oxyUserId = account();
    const subscriptionId = stripeId('sub');
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: subscriptionId,
    });
    const app = buildApp(oxyUserId);
    await request(app).post('/billing/manual-cancel');

    subscriptionsRetrieve.mockResolvedValue({
      id: subscriptionId,
      status: 'active',
      cancel_at_period_end: false,
      canceled_at: null,
    });

    const first = await request(app).post('/billing/sync');
    expect(first.status).toBe(200);
    expect(first.body.syncInfo.statusChanged).toBe(true);
    expect(first.body.entitlements.plusActive).toBe(true);

    const second = await request(app).post('/billing/sync');
    expect(second.body.syncInfo.statusChanged).toBe(false);
  });

  it('answers 404 when Stripe does not know the subscription', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({
      oxyUserId,
      sessionId: stripeId('cs'),
      product: 'plus',
      stripeSubscriptionId: stripeId('sub'),
    });
    subscriptionsRetrieve.mockRejectedValue(new Error('No such subscription'));

    const res = await request(buildApp(oxyUserId)).post('/billing/sync');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});

describe('GET /billing/debug', () => {
  it('answers 404 for an account with no record', async () => {
    const res = await request(buildApp(account())).get('/billing/debug');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BILLING_NOT_FOUND');
  });

  it('reports the session count alongside the record', async () => {
    const oxyUserId = account();
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });
    await creditCheckoutSession({ oxyUserId, sessionId: stripeId('cs'), product: 'file' });

    const res = await request(buildApp(oxyUserId)).get('/billing/debug');

    expect(res.status).toBe(200);
    expect(res.body.billing.processedSessionsCount).toBe(2);
    expect(res.body.billing.fileCredits).toBe(2);
    expect(res.body.billing.plusActive).toBe(false);
    expect(res.body.message).toBe('Plus subscription is not active');
  });
});
