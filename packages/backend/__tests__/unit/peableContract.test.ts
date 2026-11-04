import { createHmac } from 'node:crypto';
import { closePostgres } from '../../db/postgres';
import {
  DEFAULT_WEBHOOK_TOLERANCE_SEC,
  PEABLE_API_VERSION,
  type PaymentIntent,
  type WebhookEvent,
} from '@peable.to/sdk';

import {
  PEABLE_INTENT_STATUSES,
  peableStatusMeaning,
  verifyPeableSignature,
} from '../../services/payments/peableContract';

const SECRET = 'whsec_test_secret';
const TIMESTAMP = 1791000000;
const created = TIMESTAMP;
const INTENT = {
  id: 'pi_fixture',
  object: 'payment_intent',
  livemode: false,
  status: 'succeeded',
  rail: 'faircoin',
  payment_method_types: ['faircoin'],
  payment_method_configuration_details: null,
  amount: '100000',
  amount_capturable: '0',
  amount_received: '100000',
  amount_refunded: '0',
  currency: 'FAIR',
  capture_method: 'automatic',
  setup_future_usage: null,
  customer: null,
  payment_method: null,
  latest_charge: null,
  next_action: null,
  last_payment_error: null,
  cancellation_reason: null,
  canceled_at: null,
  description: null,
  receipt_email: null,
  statement_descriptor_suffix: null,
  shipping: null,
  faircoin: {
    network: 'testnet',
    address: 'synthetic-address',
    txid: 'synthetic-tx',
    confirmations: 6,
    required_confirmations: 6,
  },
  merchant_id: 'merch_fixture',
  connected_account: null,
  application_fee_amount: null,
  transfer_data: null,
  on_behalf_of: null,
  client_secret: 'synthetic-unused-secret',
  metadata: {},
  expires_at: created,
  can_expire: false,
  created,
  updated_at: created,
} satisfies PaymentIntent;
const EVENT = {
  id: 'evt_fixture',
  object: 'event',
  type: 'payment_intent.succeeded',
  created,
  livemode: false,
  api_version: PEABLE_API_VERSION,
  data: { object: INTENT },
  request: { id: null, idempotency_key: null },
} satisfies WebhookEvent;
const BODY = JSON.stringify(EVENT);
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(TIMESTAMP * 1000);
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(closePostgres);

function sign(body: string, timestamp: number, secret = SECRET): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('what a Peable status means to the ledger', () => {
  it('settles only on `succeeded`', () => {
    const settling = PEABLE_INTENT_STATUSES.filter((status) => {
      const meaning = peableStatusMeaning(status);
      return meaning.kind === 'state' && meaning.state === 'succeeded';
    });
    // The whole list, checked at once: a mapping that credited money on
    // `processing` or `requires_capture` would be a payment system reporting
    // funds that never arrived, and it would look like a one-word mistake.
    expect(settling).toEqual(['succeeded']);
  });

  it('has no refund status: a refund is its own row, never a state', () => {
    // Peable reports money coming back as a Refund (`refund.*`, `charge.refunded`)
    // and `amount_refunded`; Homiio records it as a movement pointing at the
    // original, which stays `succeeded`. A status string must never reverse it.
    for (const status of ['refunded', 'partially_refunded'])
      expect(peableStatusMeaning(status)).toEqual({ kind: 'unknown', status });
  });

  it('calls a status it has never heard of unknown, rather than guessing', () => {
    // A new processor status, a retired 0.x one, or a prototype key must never
    // become a settlement by default.
    for (const status of ['captured_offline', 'settled', 'toString', ''])
      expect(peableStatusMeaning(status)).toEqual({ kind: 'unknown', status });
  });

  it('keeps every `requires_*` state before money moves out of flight', () => {
    // Nothing is moving until somebody does something, so it is `initiated`.
    // Reading it as `pending` would show a tenant "awaiting settlement" for a
    // payment that is waiting on them.
    for (const status of ['requires_payment_method', 'requires_confirmation', 'requires_action'])
      expect(peableStatusMeaning(status)).toEqual({ kind: 'state', state: 'initiated' });
    expect(peableStatusMeaning('requires_capture')).toEqual({ kind: 'state', state: 'pending' });
  });

  it('counts a cancellation (expiry, underpayment) as a failure, because the rent is still owed', () => {
    expect(peableStatusMeaning('canceled')).toEqual({ kind: 'state', state: 'failed' });
  });
});

describe('published SDK webhook verification without a client or token mint', () => {
  const verify = (rawBody: string | Buffer, header: string | undefined, secret = SECRET) =>
    verifyPeableSignature({ rawBody, header, secret });
  it('accepts canonical raw strings and buffers', () => {
    expect(verify(BODY, sign(BODY, TIMESTAMP))).toEqual({ ok: true });
    expect(verify(Buffer.from(BODY), sign(BODY, TIMESTAMP))).toEqual({ ok: true });
  });
  it('rejects tampering, reserialisation, another secret, and short forged digests', () => {
    const header = sign(BODY, TIMESTAMP);
    for (const raw of [BODY.replace('evt_fixture', 'evt_changed'), JSON.stringify(EVENT, null, 2)])
      expect(verify(raw, header).ok).toBe(false);
    expect(verify(BODY, header, 'other-secret').ok).toBe(false);
    expect(verify(BODY, `t=${TIMESTAMP},v1=ff`).ok).toBe(false);
  });
  it('enforces the exact signed timestamp window without refreshing old signatures', () => {
    expect(verify(BODY, sign(BODY, TIMESTAMP - DEFAULT_WEBHOOK_TOLERANCE_SEC)).ok).toBe(true);
    for (const offset of [-301, 301])
      expect(verify(BODY, sign(BODY, TIMESTAMP + offset)).ok).toBe(false);
    expect(
      verify(
        BODY,
        sign(BODY, TIMESTAMP - 10000).replace(`t=${TIMESTAMP - 10000}`, `t=${TIMESTAMP}`),
      ).ok,
    ).toBe(false);
  });
  it.each([
    undefined,
    '',
    'nonsense',
    't=abc,v1=ff',
    `t=${TIMESTAMP}`,
    `t=${TIMESTAMP},v2=deadbeef`,
  ])('refuses malformed or unknown-version headers: %s', (header) => {
    expect(verify(BODY, header)).toEqual({ ok: false, reason: 'invalid_webhook' });
  });
  it.each([
    'not-json',
    '{}',
    JSON.stringify({ ...EVENT, type: 'toString' }),
    JSON.stringify({ ...EVENT, type: 'unknown.event' }),
    JSON.stringify({ ...EVENT, type: 'payment_intent.settled' }),
    JSON.stringify({ ...EVENT, livemode: undefined }),
    JSON.stringify({ ...EVENT, request: undefined }),
    JSON.stringify({ ...EVENT, created: new Date(TIMESTAMP * 1000).toISOString() }),
  ])('refuses signed malformed or unknown event: %s', (raw) => {
    expect(verify(raw, sign(raw, TIMESTAMP))).toEqual({ ok: false, reason: 'invalid_webhook' });
  });
  // The events a rent ledger would read about its payment, each with the
  // resource it actually carries; and the billing observation, whose payload
  // the SDK validates field by field.
  const payloads = {
    'payment_intent.created': { ...INTENT, status: 'requires_action' },
    'payment_intent.requires_action': { ...INTENT, status: 'requires_action' },
    'payment_intent.processing': { ...INTENT, status: 'processing' },
    'payment_intent.succeeded': INTENT,
    'payment_intent.payment_failed': {
      ...INTENT,
      status: 'requires_payment_method',
      rail: 'card',
      payment_method_types: ['card'],
      currency: 'EUR',
      amount_received: '0',
      faircoin: null,
    },
    'payment_intent.canceled': { ...INTENT, status: 'canceled', cancellation_reason: 'abandoned' },
  } satisfies {
    [T in WebhookEvent['type']]?: Extract<WebhookEvent, { type: T }>['data']['object'];
  };
  for (const type of Object.keys(payloads) as (keyof typeof payloads)[]) {
    it(`accepts signed ${type} with its actual resource family`, () => {
      const raw = JSON.stringify({ ...EVENT, type, data: { object: payloads[type] } });
      expect(verify(raw, sign(raw, TIMESTAMP))).toEqual({ ok: true });
      expect(verify(raw, sign(raw, TIMESTAMP), 'wrong').ok).toBe(false);
    });
  }
  it('refuses a signed event of a type Peable retired (billing.observation.updated)', () => {
    const raw = JSON.stringify({
      ...EVENT,
      type: 'billing.observation.updated',
      data: {
        object: {
          object: 'billing_observation',
          livemode: false,
          resource_kind: 'subscription',
          resource_id: 'sub_fixture',
          revision: 1,
          observed_at: created,
        },
      },
    });
    expect(verify(raw, sign(raw, TIMESTAMP))).toEqual({ ok: false, reason: 'invalid_webhook' });
  });
  it('does not silently replace invalid UTF-8 before verifying raw buffer bytes', () => {
    const raw = JSON.stringify({ ...EVENT, id: 'evt_\uFFFD' });
    const bytes = Buffer.from(raw);
    const index = bytes.indexOf(Buffer.from('\uFFFD'));
    const malformed = Buffer.concat([
      bytes.subarray(0, index),
      Buffer.from([0xff]),
      bytes.subarray(index + 3),
    ]);
    expect(verify(raw, sign(raw, TIMESTAMP)).ok).toBe(true);
    expect(verify(malformed, sign(raw, TIMESTAMP)).ok).toBe(false);
  });
  it('never calls fetch or a credential provider', () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    expect(verify(BODY, sign(BODY, TIMESTAMP))).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
