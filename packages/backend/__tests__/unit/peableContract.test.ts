import { createHmac } from 'node:crypto';
import { closePostgres } from '../../db/postgres';
import type { WebhooksResource } from '@peable.to/sdk';

import {
  PEABLE_INTENT_STATUSES,
  PEABLE_SIGNATURE_TOLERANCE_SECONDS,
  peableStatusMeaning,
  verifyPeableSignature,
} from '../../services/payments/peableContract';

const SECRET = 'whsec_test_secret';
const TIMESTAMP = 1791000000;
const created = new Date(TIMESTAMP * 1000).toISOString();
type Event = ReturnType<WebhooksResource['constructEvent']>;
const EVENT = {
  id: 'evt_fixture',
  object: 'event',
  type: 'payment_intent.settled',
  created,
  data: {
    object: {
      id: 'pi_fixture',
      object: 'payment_intent',
      status: 'settled',
      rail: 'faircoin',
      amount: '100000',
      currency: 'FAIR',
      network: 'testnet',
      address: 'synthetic-address',
      merchantId: 'merch_fixture',
      txid: 'synthetic-tx',
      confirmations: 6,
      clientSecret: 'synthetic-unused-secret',
      metadata: {},
      expiresAt: created,
      createdAt: created,
      updatedAt: created,
    },
  },
} satisfies Event;
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
  it('settles only on `settled`', () => {
    const settling = PEABLE_INTENT_STATUSES.filter((status) => {
      const meaning = peableStatusMeaning(status);
      return meaning.kind === 'state' && meaning.state === 'succeeded';
    });
    // The whole list, checked at once: a mapping that credited money on
    // `approved` or `broadcast` would be a payment system reporting funds that
    // never arrived, and it would look like a one-word mistake in a switch.
    expect(settling).toEqual(['settled']);
  });

  it('treats a refund as a ROW, never as a state', () => {
    expect(peableStatusMeaning('refunded')).toEqual({ kind: 'refund', partial: false });
    expect(peableStatusMeaning('partially_refunded')).toEqual({ kind: 'refund', partial: true });
    // Homiio's ledger records a refund as its own movement pointing at what it
    // reverses, and the original stays `succeeded`. Collapsing these into a
    // state would edit history and leave nothing to reconcile against.
  });

  it('calls a status it has never heard of unknown, rather than guessing', () => {
    // A new processor status must never become a settlement by default.
    expect(peableStatusMeaning('captured_offline')).toEqual({
      kind: 'unknown',
      status: 'captured_offline',
    });
    expect(peableStatusMeaning('')).toMatchObject({ kind: 'unknown' });
  });

  it('is total over every status this build knows', () => {
    for (const status of PEABLE_INTENT_STATUSES) {
      expect(peableStatusMeaning(status).kind).not.toBe('unknown');
    }
  });

  it('keeps `requires_action` out of flight', () => {
    // Nothing is moving until somebody does something, so it is `initiated`.
    // Reading it as `pending` would show a tenant "awaiting settlement" for a
    // payment that is waiting on them.
    expect(peableStatusMeaning('requires_action')).toEqual({ kind: 'state', state: 'initiated' });
  });

  it('counts an expiry as a failure, because the rent is still owed', () => {
    expect(peableStatusMeaning('expired')).toEqual({ kind: 'state', state: 'failed' });
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
    expect(verify(BODY, sign(BODY, TIMESTAMP - PEABLE_SIGNATURE_TOLERANCE_SECONDS)).ok).toBe(true);
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
    JSON.stringify({ ...EVENT, created: 42 }),
  ])('refuses signed malformed or unknown event: %s', (raw) => {
    expect(verify(raw, sign(raw, TIMESTAMP))).toEqual({ ok: false, reason: 'invalid_webhook' });
  });
  const dispute = {
    id: 'dp_fixture',
    object: 'dispute',
    paymentIntentId: 'pi_fixture',
    amount: '100',
    currency: 'EUR',
    status: 'needs_response',
    reason: null,
    evidenceDueAt: null,
    evidenceSubmittedAt: null,
    createdAt: created,
    updatedAt: created,
  } as const;
  const account = {
    id: 'ca_fixture',
    object: 'connected_account',
    externalRef: 'synthetic-fixture',
    country: 'ES',
    defaultCurrency: 'EUR',
    payable: false,
    payoutsEnabled: false,
    chargesEnabled: false,
    transfersCapability: 'pending',
    cardPaymentsCapability: null,
    requirements: { currentlyDue: 1, eventuallyDue: 1, pastDue: 0, pendingVerification: 0 },
    disabledReasonCodes: [],
    lastSyncedAt: null,
    createdAt: created,
    updatedAt: created,
  } as const;
  const payloads = {
    'payment_intent.confirming': EVENT.data.object,
    'payment_intent.settled': EVENT.data.object,
    'payment_intent.failed': EVENT.data.object,
    'payment_intent.rejected': EVENT.data.object,
    'payment_intent.expired': EVENT.data.object,
    'payment_intent.refunded': EVENT.data.object,
    'payment_intent.partially_refunded': EVENT.data.object,
    'payment_intent.disputed': dispute,
    'payment_intent.dispute_closed': { ...dispute, status: 'won' },
    'connected_account.updated': account,
  } satisfies { [T in Event['type']]: Extract<Event, { type: T }>['data']['object'] };
  for (const type of Object.keys(payloads) as (keyof typeof payloads)[]) {
    it(`accepts signed ${type} with its actual resource family`, () => {
      const raw = JSON.stringify({ ...EVENT, type, data: { object: payloads[type] } });
      expect(verify(raw, sign(raw, TIMESTAMP))).toEqual({ ok: true });
      expect(verify(raw, sign(raw, TIMESTAMP), 'wrong').ok).toBe(false);
    });
  }
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
