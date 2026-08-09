/**
 * Stripe webhook signature verification + dispatch, through the REAL controller
 * against the REAL Postgres this worker owns.
 *
 * Stripe is NEVER called for real: the `stripe` SDK is mocked so
 * `webhooks.constructEvent` is fully under test control — it can throw (invalid
 * signature → 400) or return a crafted event (valid → dispatch). Uses a dummy
 * `whsec_test` secret; no real secret is referenced.
 *
 * The billing assertions moved from the in-memory Mongo to Postgres with the
 * port. What that buys is not tidiness: the idempotency this endpoint depends on
 * is now `billing_processed_sessions_key`, a real unique index, and the
 * redelivery case below is the one an in-memory document array could not have
 * failed on.
 */

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const constructEvent = jest.fn();
const stripeInstance = { webhooks: { constructEvent } };
jest.mock('stripe', () => jest.fn(() => stripeInstance));

import express, { type Express } from 'express';
import bodyParser from 'body-parser';
import request from 'supertest';

import { stripeWebhook } from '../../controllers/billingController';
import { findBillingByOxyUserId, readEntitlements } from '../../db/billing/billingRepository';
import { getDb } from '../../db/postgres';
import { billing } from '../../db/schema';
import { assertFound } from '../helpers/assertFound';

function buildApp(): Express {
  const app = express();
  app.post(
    '/webhook',
    bodyParser.raw({ type: '*/*' }),
    (req, res, next) => {
      (req as unknown as { rawBody: Buffer }).rawBody = req.body as Buffer;
      return stripeWebhook(req as never, res as never).catch(next);
    },
  );
  return app;
}

/** One delivery of an already-crafted event. */
function deliver(app: Express, body: object) {
  return request(app)
    .post('/webhook')
    .set('stripe-signature', 'good-sig')
    .set('content-type', 'application/json')
    .send(Buffer.from(JSON.stringify(body)));
}

beforeEach(async () => {
  constructEvent.mockReset();
  // `billing_processed_sessions` is `ON DELETE CASCADE`, so this clears both.
  await getDb().delete(billing);
});

describe('stripeWebhook signature verification', () => {
  it('responds 400 when the signature is invalid', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const res = await request(buildApp())
      .post('/webhook')
      .set('stripe-signature', 'bad-sig')
      .set('content-type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_1' })));

    expect(res.status).toBe(400);
    expect(res.text).toContain('Webhook Error');
    expect(constructEvent).toHaveBeenCalledTimes(1);
  });

  it('accepts a valid event and dispatches checkout.session.completed (plus)', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          client_reference_id: 'oxy-user-1',
          subscription: 'sub_123',
          metadata: { product: 'plus', oxyUserId: 'oxy-user-1' },
        },
      },
    });

    const res = await deliver(buildApp(), { id: 'evt_2' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const entitlements = await readEntitlements('oxy-user-1');
    assertFound(entitlements, 'entitlements');
    expect(entitlements.plusActive).toBe(true);
    expect(entitlements.plusStripeSubscriptionId).toBe('sub_123');
    expect(entitlements.processedSessions).toContain('cs_test_123');
  });

  it('grants a file credit for a one-off file purchase', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_file',
          client_reference_id: 'oxy-user-2',
          metadata: { product: 'file', oxyUserId: 'oxy-user-2' },
        },
      },
    });

    const res = await deliver(buildApp(), { id: 'evt_3' });

    expect(res.status).toBe(200);
    const record = await findBillingByOxyUserId('oxy-user-2');
    assertFound(record, 'billing');
    expect(record.fileCredits).toBe(1);
  });

  /**
   * The case the endpoint exists to survive, end to end. Stripe retries any
   * non-2xx and the confirm redirect races this handler for the same session by
   * design, so a redelivery is ORDINARY. Under Mongo the guard was a
   * read-modify-write of `processedSessions[]`; it is a unique index now, and
   * this asserts the account is credited ONCE across two full HTTP deliveries.
   */
  it('credits only once when Stripe redelivers the same session', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_redelivered',
          client_reference_id: 'oxy-user-3',
          metadata: { product: 'file', oxyUserId: 'oxy-user-3' },
        },
      },
    });

    const app = buildApp();
    expect((await deliver(app, { id: 'evt_6' })).status).toBe(200);
    expect((await deliver(app, { id: 'evt_6' })).status).toBe(200);

    const record = await findBillingByOxyUserId('oxy-user-3');
    assertFound(record, 'billing');
    expect(record.fileCredits).toBe(1);
  });

  it('responds 400 when the raw body is missing', async () => {
    const app = express();
    app.post('/webhook', bodyParser.json(), (req, res, next) =>
      stripeWebhook(req as never, res as never).catch(next),
    );

    const res = await request(app)
      .post('/webhook')
      .set('stripe-signature', 'good-sig')
      .send({ id: 'evt_4' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Missing raw body');
    expect(constructEvent).not.toHaveBeenCalled();
  });

  it('ignores a dispatched event with no oxyUserId without erroring', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_no_user', metadata: { product: 'plus' } } },
    });

    const res = await deliver(buildApp(), { id: 'evt_5' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  /**
   * An unrecognised product must credit NOTHING rather than fall into a default
   * branch. Mongo's three `if`/`else if` arms did this by omission; the port
   * narrows the metadata explicitly, so this pins the refusal rather than the
   * accident.
   */
  it('creates no record for a product this server does not sell', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_bogus_product',
          client_reference_id: 'oxy-user-4',
          metadata: { product: 'unicorn', oxyUserId: 'oxy-user-4' },
        },
      },
    });

    const res = await deliver(buildApp(), { id: 'evt_7' });

    expect(res.status).toBe(200);
    expect(await findBillingByOxyUserId('oxy-user-4')).toBeNull();
  });

  /**
   * `customer.subscription.deleted` carries a `Subscription`, whose own `id` is
   * the subscription; `invoice.payment_failed` carries an `Invoice`, which NAMES
   * one. Mongo read `sub.id || sub.subscription` off an `any` and happened to be
   * right; this pins both shapes, because reading the wrong field would
   * deactivate nothing and leave a lapsed subscriber entitled.
   */
  it('deactivates on customer.subscription.deleted', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_for_deletion',
          client_reference_id: 'oxy-user-5',
          subscription: 'sub_to_delete',
          metadata: { product: 'plus', oxyUserId: 'oxy-user-5' },
        },
      },
    });
    const app = buildApp();
    await deliver(app, { id: 'evt_8' });
    expect((await findBillingByOxyUserId('oxy-user-5'))?.plusActive).toBe(true);

    constructEvent.mockReturnValue({
      type: 'customer.subscription.deleted',
      data: { object: { object: 'subscription', id: 'sub_to_delete' } },
    });
    expect((await deliver(app, { id: 'evt_9' })).status).toBe(200);

    const record = await findBillingByOxyUserId('oxy-user-5');
    assertFound(record, 'billing');
    expect(record.plusActive).toBe(false);
    expect(record.plusCanceledAt).toBeInstanceOf(Date);
  });

  it('deactivates on invoice.payment_failed, which names the subscription', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_for_failure',
          client_reference_id: 'oxy-user-6',
          subscription: 'sub_unpaid',
          metadata: { product: 'plus', oxyUserId: 'oxy-user-6' },
        },
      },
    });
    const app = buildApp();
    await deliver(app, { id: 'evt_10' });

    constructEvent.mockReturnValue({
      type: 'invoice.payment_failed',
      data: { object: { object: 'invoice', id: 'in_1', subscription: 'sub_unpaid' } },
    });
    expect((await deliver(app, { id: 'evt_11' })).status).toBe(200);

    expect((await findBillingByOxyUserId('oxy-user-6'))?.plusActive).toBe(false);
  });

  it('stamps a renewal on invoice.payment_succeeded', async () => {
    constructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_for_renewal',
          client_reference_id: 'oxy-user-7',
          subscription: 'sub_renewing',
          metadata: { product: 'plus', oxyUserId: 'oxy-user-7' },
        },
      },
    });
    const app = buildApp();
    await deliver(app, { id: 'evt_12' });
    const before = await findBillingByOxyUserId('oxy-user-7');

    await new Promise((resolve) => setTimeout(resolve, 25));
    constructEvent.mockReturnValue({
      type: 'invoice.payment_succeeded',
      data: { object: { object: 'invoice', id: 'in_2', subscription: 'sub_renewing' } },
    });
    expect((await deliver(app, { id: 'evt_13' })).status).toBe(200);

    const after = await findBillingByOxyUserId('oxy-user-7');
    assertFound(after, 'billing');
    expect(after.lastPaymentAt?.getTime()).toBeGreaterThan(before?.lastPaymentAt?.getTime() ?? 0);
    expect(after.plusActive).toBe(true);
  });
});
