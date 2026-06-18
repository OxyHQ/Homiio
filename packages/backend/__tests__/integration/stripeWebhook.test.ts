/**
 * Stripe webhook signature verification + dispatch.
 *
 * Stripe is NEVER called for real: the `stripe` SDK is mocked so
 * `webhooks.constructEvent` is fully under test control — it can throw (invalid
 * signature → 400) or return a crafted event (valid → dispatch). The Billing
 * model write is verified against the in-memory Mongo. Uses a dummy
 * `whsec_test` secret; no real secret is referenced.
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

const models = require('../../models');
const { Billing } = models;

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

describe('stripeWebhook signature verification', () => {
  beforeEach(() => {
    constructEvent.mockReset();
  });

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

    const res = await request(buildApp())
      .post('/webhook')
      .set('stripe-signature', 'good-sig')
      .set('content-type', 'application/json')
      .send(Buffer.from(JSON.stringify({ id: 'evt_2' })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const billing = await Billing.findOne({ oxyUserId: 'oxy-user-1' });
    expect(billing).not.toBeNull();
    expect(billing.plusActive).toBe(true);
    expect(billing.plusStripeSubscriptionId).toBe('sub_123');
    expect(billing.processedSessions).toContain('cs_test_123');
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

    const res = await request(buildApp())
      .post('/webhook')
      .set('stripe-signature', 'good-sig')
      .send(Buffer.from(JSON.stringify({ id: 'evt_3' })));

    expect(res.status).toBe(200);
    const billing = await Billing.findOne({ oxyUserId: 'oxy-user-2' });
    expect(billing.fileCredits).toBe(1);
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

    const res = await request(buildApp())
      .post('/webhook')
      .set('stripe-signature', 'good-sig')
      .send(Buffer.from(JSON.stringify({ id: 'evt_5' })));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});
