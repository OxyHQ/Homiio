/**
 * Pure, unmounted Peable contract for rent (#518/#519). The published SDK owns
 * webhook cryptography and event envelopes; Homiio owns its ledger meanings.
 * No credential, network call, route, rent action or settlement is enabled here.
 * See docs/peable-rent-payments.md for the current integration boundaries.
 */
import { PeableSignatureVerificationError, WebhooksResource, WEBHOOK_SIGNATURE_HEADER } from '@peable.to/sdk';

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
 * Intent statuses for which Homiio defines a ledger meaning.
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

/** Canonical header name; all parsing and cryptography belong to the SDK. */
export const PEABLE_SIGNATURE_HEADER = WEBHOOK_SIGNATURE_HEADER;
export const PEABLE_SIGNATURE_TOLERANCE_SECONDS = 300;
export type PeableSignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_webhook' };
const webhooks = new WebhooksResource();

/** Verify both the signed raw bytes and the canonical event envelope. No HTTP. */
export function verifyPeableSignature(input: {
  readonly rawBody: Buffer | string;
  readonly header: string | undefined;
  readonly secret: string;
}): PeableSignatureVerdict {
  const raw = Buffer.isBuffer(input.rawBody) ? input.rawBody.toString('utf8') : input.rawBody;
  // SDK accepts UTF-8 strings; reject lossy decoding so different raw bytes cannot verify as the same string.
  if (Buffer.isBuffer(input.rawBody) && !Buffer.from(raw, 'utf8').equals(input.rawBody)) return { ok: false, reason: 'invalid_webhook' };
  try {
    webhooks.constructEvent(
      raw,
      input.header ?? '', input.secret, { toleranceSec: PEABLE_SIGNATURE_TOLERANCE_SECONDS },
    );
    return { ok: true };
  } catch (error) {
    if (error instanceof PeableSignatureVerificationError) return { ok: false, reason: 'invalid_webhook' };
    throw error;
  }
}
