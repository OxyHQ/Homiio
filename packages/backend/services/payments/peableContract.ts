/**
 * Pure, unmounted Peable contract for rent (#518/#519). The published SDK owns
 * the wire — paths, idempotency keys, webhook cryptography and event envelopes;
 * Homiio owns its ledger meanings. No credential, network call, route, rent
 * action or settlement is enabled here. See docs/peable-rent-payments.md for
 * the current integration boundaries.
 */
import type { PaymentIntentStatus } from '@peable.to/sdk';
import { PeableSignatureVerificationError, WebhooksResource } from '@peable.to/sdk';

import type { LeaseMovementState } from '@homiio/shared-types';

/**
 * What each Peable PaymentIntent status MEANS to Homiio's ledger.
 *
 * Keyed by the SDK's own `PaymentIntentStatus`, so a status Peable adds fails
 * compilation here on the upgrade that brings it, instead of being copied into
 * a list that goes stale. The groupings answer "what has actually happened to
 * the money":
 *
 *  - the `requires_*` states before any money moves are `initiated` — nothing
 *    is in flight until somebody acts, so a tenant is never shown "awaiting
 *    settlement" for a payment that is waiting on them;
 *  - `processing` (coins broadcast, an async method settling) and
 *    `requires_capture` (authorized, not yet taken) are `pending`;
 *  - only `succeeded` is `succeeded`;
 *  - `canceled` — by the merchant, by expiry, or a FairCoin underpayment — is
 *    `failed`, because the rent is still owed.
 *
 * A refund is not a status (Peable ADR 0019): it is its own `Refund`, reported
 * by `refund.*` / `charge.refunded` events and summed in `amount_refunded`,
 * and in Homiio its own movement pointing at what it reverses. The original
 * stays `succeeded` forever, which is the one thing
 * `shared-types/leasePayment.ts` refuses to let anything edit.
 */
const LEDGER_STATE_BY_STATUS = {
  requires_payment_method: 'initiated',
  requires_confirmation: 'initiated',
  requires_action: 'initiated',
  processing: 'pending',
  requires_capture: 'pending',
  succeeded: 'succeeded',
  canceled: 'failed',
} as const satisfies Record<PaymentIntentStatus, LeaseMovementState>;

/** Every status this build gives a ledger meaning — exactly the SDK's statuses. */
export const PEABLE_INTENT_STATUSES = Object.keys(LEDGER_STATE_BY_STATUS) as PaymentIntentStatus[];

/**
 * What one status string means: the movement's {@link LeaseMovementState}, or
 * `unknown` for a status this build has never heard of. The caller records an
 * unknown status and changes nothing — treating an unrecognised status as a
 * settlement is how a payment system credits money that never arrived.
 */
export type PeableStatusMeaning =
  | { readonly kind: 'state'; readonly state: LeaseMovementState }
  | { readonly kind: 'unknown'; readonly status: string };

/** Total over every string; own-key lookup, so `toString` is not a status. */
export function peableStatusMeaning(status: string): PeableStatusMeaning {
  return Object.hasOwn(LEDGER_STATE_BY_STATUS, status)
    ? { kind: 'state', state: LEDGER_STATE_BY_STATUS[status as PaymentIntentStatus] }
    : { kind: 'unknown', status };
}

export type PeableSignatureVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'invalid_webhook' };

const webhooks = new WebhooksResource();

/**
 * Verify the signed raw bytes, the signed timestamp window (the SDK's default
 * tolerance) and the canonical event envelope. No HTTP, no credential. The
 * bytes go to the SDK as they arrived: it decodes them as exact UTF-8 (BOM
 * kept, an invalid sequence refused), so two different bodies can never verify
 * as one string.
 */
export function verifyPeableSignature(input: {
  readonly rawBody: Buffer | string;
  readonly header: string | undefined;
  readonly secret: string;
}): PeableSignatureVerdict {
  try {
    webhooks.constructEvent(input.rawBody, input.header ?? '', input.secret);
    return { ok: true };
  } catch (error) {
    if (error instanceof PeableSignatureVerificationError)
      return { ok: false, reason: 'invalid_webhook' };
    throw error;
  }
}
