/**
 * A handler that answers a failure itself must not echo a THIRD PARTY's error
 * text into the response — the same rule `errorHandler.test.ts` pins for errors
 * that reach the global handler, applied to the three places that used to
 * bypass it.
 *
 * Stripe's and Telegram's messages are the ones at issue: they name the
 * account, the request id, the signature scheme and (for a 401) the tail of the
 * bot token. Each case here asserts BOTH halves — nothing sensitive in the
 * body, and the original still reachable in the log — because dropping the
 * message entirely would fix the leak and lose the diagnosis.
 */

const mockLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() };
jest.mock('../../middlewares/logging', () => ({
  logger: mockLogger,
  businessLogger: mockLogger,
  requestLogger: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const mockGetOxyUserId = jest.fn();
jest.mock('@oxy.so/core/server', () => ({
  ...jest.requireActual('@oxy.so/core/server'),
  getOxyUserId: (...args: unknown[]) => mockGetOxyUserId(...args),
}));

const mockFindBillingByOxyUserId = jest.fn();
jest.mock('../../db/billing/billingRepository', () => ({
  findBillingByOxyUserId: (...args: unknown[]) => mockFindBillingByOxyUserId(...args),
  creditCheckoutSession: jest.fn(),
  deactivateSubscriptionByStripeId: jest.fn(),
  readEntitlements: jest.fn(),
  recordSubscriptionPayment: jest.fn(),
  updateBilling: jest.fn(),
}));

const mockConstructEvent = jest.fn();
const mockSubscriptionsRetrieve = jest.fn();
jest.mock('stripe', () => {
  return {
    __esModule: true,
    default: class FakeStripe {
      webhooks = { constructEvent: (...args: unknown[]) => mockConstructEvent(...args) };
      subscriptions = { retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args) };
    },
  };
});

const mockGetBotInfo = jest.fn();
jest.mock('../../services', () => ({
  telegramService: {
    getBotInfo: (...args: unknown[]) => mockGetBotInfo(...args),
    getGroupsSummary: () => ({ totalGroups: 0, configuredGroups: 0 }),
  },
}));

import type { Request, Response } from 'express';
import config from '../../config';
import { stripeWebhook, syncSubscriptionStatus } from '../../controllers/billingController';
import telegramController from '../../controllers/telegramController';

/** Stripe's real text for a body that does not match the signature header. */
const SIGNATURE_FAILURE =
  'No signatures found matching the expected signature for payload. ' +
  'Are you passing the raw request body you received from Stripe? ' +
  'https://github.com/stripe/stripe-node#webhook-signing';

/** Stripe's real text for a subscription the account cannot see. */
const MISSING_SUBSCRIPTION =
  'No such subscription: \'sub_1PsecretXYZ\'; a similar object exists in test mode, ' +
  'but a live mode key was used to make this request. (request req_lEaKeD123)';

/** Telegram's real text for a rejected token — the token's tail is in it. */
const TELEGRAM_UNAUTHORIZED =
  'ETELEGRAM: 401 Unauthorized. https://api.telegram.org/bot7712345678:AAH-sEcReTtOkEn/getMe';

function mockRequest(overrides: Record<string, unknown> = {}): Request {
  return {
    method: 'POST',
    baseUrl: '/api/billing',
    path: '/webhook',
    originalUrl: '/api/billing/webhook',
    route: { path: '/webhook' },
    headers: {},
    body: {},
    params: {},
    query: {},
    get: () => undefined,
    ...overrides,
  } as unknown as Request;
}

function mockResponse() {
  const res = { headersSent: false, statusCode: 200, body: undefined as any } as any;
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  res.send = jest.fn((body: unknown) => {
    res.body = body;
    return res;
  });
  return res as Response & { statusCode: number; body: any };
}

/** Every string anywhere in the logger's arguments, so a nested meta still counts. */
function loggedText(): string {
  return JSON.stringify([
    mockLogger.error.mock.calls,
    mockLogger.warn.mock.calls,
    mockLogger.info.mock.calls,
  ]);
}

const originalStripeConfig = config.stripe;
const originalTelegramConfig = config.telegram;

beforeEach(() => {
  jest.clearAllMocks();
  config.stripe = {
    secretKey: 'sk_test_key',
    webhookSecret: 'whsec_test_secret',
    successUrl: 'https://homiio.com/ok',
    cancelUrl: 'https://homiio.com/no',
  } as typeof config.stripe;
});

afterAll(() => {
  config.stripe = originalStripeConfig;
  config.telegram = originalTelegramConfig;
});

describe('stripeWebhook, on a signature that does not verify', () => {
  it('still REFUSES the delivery with a 400', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error(SIGNATURE_FAILURE);
    });
    const res = mockResponse();

    await stripeWebhook(
      mockRequest({ headers: { 'stripe-signature': 'v1=nope' }, rawBody: Buffer.from('{}') }),
      res,
    );

    // The status is the whole contract with Stripe: it is how a forged or
    // mis-signed delivery is rejected and a genuine one is retried.
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('answers a fixed message and logs the library text instead', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error(SIGNATURE_FAILURE);
    });
    const res = mockResponse();

    await stripeWebhook(
      mockRequest({ headers: { 'stripe-signature': 'v1=nope' }, rawBody: Buffer.from('{}') }),
      res,
    );

    expect(res.body.error.message).toBe('Webhook signature verification failed');
    expect(JSON.stringify(res.body)).not.toContain('No signatures found');
    expect(JSON.stringify(res.body)).not.toContain('stripe-node');
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain('No signatures found');
  });
});

describe('syncSubscriptionStatus, when Stripe cannot find the subscription', () => {
  beforeEach(() => {
    mockGetOxyUserId.mockReturnValue('oxy-user-1');
    mockFindBillingByOxyUserId.mockResolvedValue({
      oxyUserId: 'oxy-user-1',
      plusActive: true,
      plusStripeSubscriptionId: 'sub_1PsecretXYZ',
      plusCanceledAt: null,
    });
    mockSubscriptionsRetrieve.mockRejectedValue(new Error(MISSING_SUBSCRIPTION));
  });

  it('answers a 404 naming neither the subscription nor the Stripe request id', async () => {
    const res = mockResponse();

    await syncSubscriptionStatus(mockRequest({ path: '/sync-subscription' }), res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toEqual({
      message: 'Subscription not found in Stripe',
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('sub_1PsecretXYZ');
    expect(serialized).not.toContain('req_lEaKeD123');
    expect(serialized).not.toContain('live mode key');
  });

  it('keeps the original in the log', async () => {
    await syncSubscriptionStatus(mockRequest({ path: '/sync-subscription' }), mockResponse());

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain('req_lEaKeD123');
  });
});

describe('telegram getBotStatus, when the bot cannot be reached', () => {
  it('reports only that it is not initialized, never the client message', async () => {
    mockGetBotInfo.mockRejectedValue(new Error(TELEGRAM_UNAUTHORIZED));
    const res = mockResponse();

    await telegramController.getBotStatus(mockRequest({ method: 'GET' }), res, jest.fn());

    expect(res.body.success).toBe(true);
    expect(res.body.data.initialized).toBe(false);
    expect(res.body.data).not.toHaveProperty('botInfoError');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('AAH-sEcReTtOkEn');
    expect(serialized).not.toContain('api.telegram.org');
  });

  it('logs the failure rather than swallowing it', async () => {
    mockGetBotInfo.mockRejectedValue(new Error(TELEGRAM_UNAUTHORIZED));

    await telegramController.getBotStatus(mockRequest({ method: 'GET' }), mockResponse(), jest.fn());

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(loggedText()).toContain('ETELEGRAM: 401 Unauthorized');
  });

  it('still reports a reachable bot', async () => {
    mockGetBotInfo.mockResolvedValue({ id: 7712345678, username: 'homiio_bot', first_name: 'Homiio' });
    const res = mockResponse();

    await telegramController.getBotStatus(mockRequest({ method: 'GET' }), res, jest.fn());

    expect(res.body.data.initialized).toBe(true);
    expect(res.body.data.botInfo).toMatchObject({ username: 'homiio_bot' });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});
