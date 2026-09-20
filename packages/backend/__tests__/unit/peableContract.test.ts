/**
 * The two halves of the Peable integration that can be proven before it is
 * connected (#518 §7.2, #519 §7.2).
 *
 * Peable is the chosen processor and is not wired up — rent in euros needs its
 * card rail, which is implemented but not live, and it performs no FX, so a
 * euro amount cannot settle over its deployed FairCoin rail.
 *
 * What CAN be built now is the part that is pure, and it happens to be the part
 * most easily got wrong later: what a processor status means to a ledger, and
 * whether a webhook really came from the processor. Both are worth having
 * settled and covered before anybody is holding a production incident.
 */

import { createHmac } from 'node:crypto';

import {
  PEABLE_INTENT_STATUSES,
  PEABLE_SIGNATURE_TOLERANCE_SECONDS,
  peableStatusMeaning,
  verifyPeableSignature,
} from '../../services/payments/peableContract';

const SECRET = 'whsec_test_secret';
const BODY = JSON.stringify({ id: 'evt_1', type: 'payment_intent.settled' });

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
    // The statuses are copied, because Peable's SDK cannot be installed. Copied
    // values go stale. The failure mode that matters is a NEW status being read
    // as a settlement.
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

describe('proving a webhook came from Peable', () => {
  const now = 1_800_000_000;

  it('accepts a correctly signed delivery', () => {
    expect(
      verifyPeableSignature({ rawBody: BODY, header: sign(BODY, now), secret: SECRET, nowSeconds: now }),
    ).toEqual({ ok: true });
  });

  it('refuses a body that changed by one byte', () => {
    const header = sign(BODY, now);
    const tampered = BODY.replace('settled', 'settle_');

    expect(
      verifyPeableSignature({ rawBody: tampered, header, secret: SECRET, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a re-serialised body — the classic way this is got wrong', () => {
    // Same JSON, different bytes: a caller that parsed and re-stringified would
    // break every signature, and the symptom is "webhooks stopped working"
    // rather than anything pointing at the cause.
    const header = sign(BODY, now);
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 2);

    expect(
      verifyPeableSignature({ rawBody: reserialised, header, secret: SECRET, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses another merchant\'s secret', () => {
    expect(
      verifyPeableSignature({
        rawBody: BODY,
        header: sign(BODY, now, 'whsec_someone_else'),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a delivery captured and replayed later', () => {
    const header = sign(BODY, now);

    expect(
      verifyPeableSignature({
        rawBody: BODY,
        header,
        secret: SECRET,
        nowSeconds: now + PEABLE_SIGNATURE_TOLERANCE_SECONDS + 1,
      }),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
    // …and it is still good one second inside the window, so the tolerance is
    // a boundary rather than an approximation.
    expect(
      verifyPeableSignature({
        rawBody: BODY,
        header,
        secret: SECRET,
        nowSeconds: now + PEABLE_SIGNATURE_TOLERANCE_SECONDS - 1,
      }),
    ).toEqual({ ok: true });
  });

  it('refuses a replay dressed in a fresh timestamp', () => {
    // The timestamp is inside the signed material, so moving it forward to beat
    // the tolerance invalidates the digest. This is the attack the window
    // exists for, and it must fail as a SIGNATURE problem.
    const header = sign(BODY, now).replace(`t=${now}`, `t=${now + 10_000}`);

    expect(
      verifyPeableSignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: now + 10_000 }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('refuses a header that is missing, empty or malformed', () => {
    for (const header of [undefined, '', '   ', 'nonsense', 't=abc,v1=ff', `t=${now}`]) {
      expect(
        verifyPeableSignature({ rawBody: BODY, header, secret: SECRET, nowSeconds: now }).ok,
      ).toBe(false);
    }
  });

  it('names an unrecognised signature version rather than calling it malformed', () => {
    expect(
      verifyPeableSignature({
        rawBody: BODY,
        header: `t=${now},v2=deadbeef`,
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toEqual({ ok: false, reason: 'unknown_version' });
  });

  it('refuses a short forged digest instead of throwing', () => {
    // `timingSafeEqual` throws on a length mismatch rather than returning
    // false, so a one-byte signature would be a 500 on a public endpoint.
    expect(
      verifyPeableSignature({ rawBody: BODY, header: `t=${now},v1=ff`, secret: SECRET, nowSeconds: now }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
