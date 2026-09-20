/**
 * The Peable side of rent payments, as far as it can be built without calling
 * it (#518 §7.2, #519 §7.2).
 *
 * Peable is the chosen processor. It is **not connected**, and this module
 * deliberately makes no network call, holds no credential and is wired into no
 * route. What it does hold is the two halves of the integration that are pure,
 * that can be tested today, and that are the easiest to get quietly wrong
 * later: how Peable's intent statuses map onto Homiio's ledger, and how a
 * webhook is proven to have come from Peable.
 *
 * `docs/peable-rent-payments.md` records what is blocking and what remains.
 * The short version, all verified against the Peable repository rather than
 * assumed:
 *
 *  1. **Rent in euros needs the card rail, which is not live.** Peable's own
 *     roadmap marks card payments implemented but never exercised against
 *     Stripe's sandbox and not deployed; a deployment without the Stripe
 *     secrets answers 503.
 *  2. **There is no FX anywhere in Peable**, and it says so in its own source.
 *     So a EUR rent amount cannot settle over the deployed FairCoin rail. The
 *     two facts together are why this is a seam and not an integration.
 *  3. **The published SDK cannot be installed.** `@peable.to/sdk@0.1.1`
 *     declares `"@peable.to/shared-types": "workspace:^"` as a runtime
 *     dependency, which resolves only inside Peable's own monorepo
 *     (`EUNSUPPORTEDPROTOCOL` anywhere else). Integrating means REST plus our
 *     own types — which is what the shapes below are.
 *  4. **Nothing in Peable is a subscription engine**, and rent is recurring by
 *     definition. Each month is its own intent, minted by Homiio against its
 *     own obligation, and the ledger is already shaped for exactly that.
 *
 * The ledger needs no migration to accept any of this: `lease_payment_movements`
 * already carries `kind: 'processor'` and a `processor_reference` with its own
 * partial unique index, which is what makes a replayed webhook find the row it
 * already created instead of making a second one.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { LeaseMovementState } from '@homiio/shared-types';

/** Where Peable lives. Not read by anything yet; here so it is read once later. */
export const PEABLE_API_BASE_URL = 'https://api.peable.to';

/**
 * The call that would take rent: `POST /v1/payment_intents`.
 *
 * `Idempotency-Key` is a REQUIRED header, not a body field, and replaying it
 * with a different amount, currency or rail is a 409 rather than a second
 * charge. Homiio already mints exactly such a key per obligation
 * (`frontend/services/leaseLedgerService.ts#idempotencyKeyFor`), so the two
 * idempotency schemes line up without either side inventing one.
 */
export const PEABLE_CREATE_INTENT_PATH = '/v1/payment_intents';
export const PEABLE_IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Peable's intent statuses, copied because the SDK cannot be depended on.
 *
 * Copied values go stale, so this is a closed list read by a TOTAL function
 * below: a status Peable adds and Homiio has not seen resolves to `unknown`
 * and is ignored loudly, rather than being silently treated as a settlement.
 */
export const PEABLE_INTENT_STATUSES = [
  'created',
  'awaiting_approval',
  'approved',
  'broadcast',
  'confirming',
  'requires_action',
  'processing',
  'settled',
  'refunded',
  'partially_refunded',
  'expired',
  'failed',
  'rejected',
] as const;
export type PeableIntentStatus = (typeof PEABLE_INTENT_STATUSES)[number];

/**
 * What one Peable status MEANS to Homiio's ledger.
 *
 * Three outcomes, not one, and the split is the point:
 *
 *  - `state` — the movement moves to this {@link LeaseMovementState}.
 *  - `refund` — **not a state change.** A refund is its own row in Homiio's
 *    ledger, pointing at what it reverses, and the original stays `succeeded`
 *    forever. Collapsing `refunded` into a state would edit history and leave
 *    nothing to reconcile against, which is the one thing
 *    `shared-types/leasePayment.ts` refuses by design.
 *  - `unknown` — a status this build has never heard of. The caller records it
 *    and changes nothing. Treating an unrecognised status as a settlement is
 *    how a payment system credits money that never arrived.
 */
export type PeableStatusMeaning =
  | { readonly kind: 'state'; readonly state: LeaseMovementState }
  | { readonly kind: 'refund'; readonly partial: boolean }
  | { readonly kind: 'unknown'; readonly status: string };

/**
 * Total, and exhaustive over the statuses this build knows.
 *
 * The groupings answer "what has actually happened to the money":
 * `requires_action` is `initiated` rather than `pending` because nothing is in
 * flight — somebody has to do something first — and `expired` is a failure
 * because the obligation is still owed.
 */
export function peableStatusMeaning(status: string): PeableStatusMeaning {
  switch (status) {
    case 'created':
    case 'awaiting_approval':
    case 'approved':
    case 'requires_action':
      return { kind: 'state', state: 'initiated' };
    case 'broadcast':
    case 'confirming':
    case 'processing':
      return { kind: 'state', state: 'pending' };
    case 'settled':
      return { kind: 'state', state: 'succeeded' };
    case 'failed':
    case 'rejected':
    case 'expired':
      return { kind: 'state', state: 'failed' };
    case 'refunded':
      return { kind: 'refund', partial: false };
    case 'partially_refunded':
      return { kind: 'refund', partial: true };
    default:
      return { kind: 'unknown', status };
  }
}

/** The header a Peable webhook is signed with. */
export const PEABLE_SIGNATURE_HEADER = 'Peable-Signature';

/** How far out of step a delivery's timestamp may be before it is a replay. */
export const PEABLE_SIGNATURE_TOLERANCE_SECONDS = 300;

export type PeableSignatureRefusal =
  | 'malformed_header'
  | 'unknown_version'
  | 'stale_timestamp'
  | 'bad_signature';

export type PeableSignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: PeableSignatureRefusal };

/**
 * Whether a webhook body really came from Peable.
 *
 * `Peable-Signature: t=<unix seconds>,v1=<hex>` over `HMAC-SHA256("<t>.<raw
 * body>")`. The RAW body, byte for byte — re-serialising the parsed JSON
 * changes the bytes and every signature stops verifying, which is the classic
 * way this is got wrong and the reason the caller must keep the raw buffer.
 *
 * The timestamp is inside the signed material, so a captured delivery cannot be
 * replayed later with a fresh `t`: changing it invalidates the digest. The
 * tolerance bounds how long a captured-and-unchanged delivery stays useful.
 *
 * Compared with {@link timingSafeEqual}, and only after a length check —
 * `timingSafeEqual` throws on a length mismatch rather than returning false,
 * so a shorter forged digest would be an exception instead of a refusal.
 */
export function verifyPeableSignature(input: {
  readonly rawBody: Buffer | string;
  readonly header: string | undefined;
  readonly secret: string;
  /** Injected so the tolerance can be tested without waiting. */
  readonly nowSeconds?: number;
}): PeableSignatureVerdict {
  const header = typeof input.header === 'string' ? input.header.trim() : '';
  if (header.length === 0) return { ok: false, reason: 'malformed_header' };

  let timestamp: string | undefined;
  let signature: string | undefined;
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key?.trim() === 't') timestamp = value?.trim();
    if (key?.trim() === 'v1') signature = value?.trim();
  }
  if (!timestamp || !/^\d+$/.test(timestamp)) return { ok: false, reason: 'malformed_header' };
  // A header carrying only an unrecognised version is refused as such rather
  // than as malformed, so a future `v2` is a legible failure and not a mystery.
  if (!signature) {
    return { ok: false, reason: header.includes('v') ? 'unknown_version' : 'malformed_header' };
  }
  if (!/^[0-9a-f]+$/i.test(signature)) return { ok: false, reason: 'malformed_header' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > PEABLE_SIGNATURE_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const raw = Buffer.isBuffer(input.rawBody) ? input.rawBody : Buffer.from(input.rawBody, 'utf8');
  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.`)
    .update(raw)
    .digest('hex');

  const given = Buffer.from(signature.toLowerCase(), 'hex');
  const mine = Buffer.from(expected, 'hex');
  if (given.length !== mine.length) return { ok: false, reason: 'bad_signature' };
  return timingSafeEqual(given, mine) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
