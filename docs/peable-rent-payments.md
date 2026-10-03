# Paying rent through Peable

Peable remains the intended rent processor. Homiio has an **unmounted, pure contract module**; it holds no payment credential, mounts no webhook route, calls no provider, and enables no Pay rent button. Publication of a client package does not establish a Homiio merchant namespace or authorize a rent charge.

## Current evidence — 2026-10-03

The earlier 2026-09-20 report identified an un-installable SDK0.1.1 (`workspace:^` runtime dependency) and a five-event allowlist. Both package blockers have been resolved upstream: **`@peable.to/sdk@0.2.2` with `@peable.to/shared-types@0.3.0` is published and installable**, and its standalone `WebhooksResource` covers ten canonical event types, including refunds, disputes and connected-account updates. [Publication evidence](https://github.com/OxyHQ/Peable/pull/98) records registry digests, isolated CJS/ESM/TypeScript checks and independent review. Homiio installs the registry release and has no local HMAC implementation.

Peable backend readiness was verified on TD7, with health/ready200 and unauthenticated billing401; its provider/cohort configuration remained absent. Separately, the approved **Mercaria-specific** cohort implementation passed real Stripe test-account Checkout and TestClock exercises. Those facts replace “never tested anywhere”; they do not prove a configured Homiio EUR rail, Homiio acceptance, a production card payment, or permission to reuse Mercaria's financial namespace. [I08 and its scope](https://github.com/OxyHQ/Peable/issues/87) remain the authority for that distinction.

Peable's billing provider exposes explicit customer/checkout/portal/subscription operations for an approved cohort. That is not a rent scheduler, mandate, automatic entitlement or a change to Homiio's obligation model. No FX assumption changes: a EUR obligation cannot be treated as a FAIR payment.

## What Homiio owns

`lease_payment_movements` distinguishes `processor` movements from `manual_declaration`, and a partial unique processor-reference index supports replay detection. Each ledger write already carries an idempotency key unique per lease. A refund is a new movement referencing the original; it never rewrites a succeeded payment.

`packages/backend/services/payments/peableContract.ts` retains the existing domain mapping:

- Only `settled` means `succeeded`.
- Created/approval/action states mean initiated; in-flight states mean pending.
- Refunded and partially refunded mean a separate refund row.
- Unknown statuses remain unknown and authorize no ledger change.

`verifyPeableSignature` delegates to the **published standalone `WebhooksResource`**. It verifies the raw UTF-8 bytes, signed timestamp window, JSON event envelope and canonical event type without constructing a credential-bearing client or minting a token. Invalid UTF-8 buffers are refused before lossy decoding. The local unmounted seam now reports one `invalid_webhook` refusal instead of parsing SDK error messages into the old local header/version categories. No mounted caller relied on those categories. Tests control the clock rather than adding a production time override.

The SDK's envelope check is not Homiio domain authorization or full nested-resource validation. A future mounted ingress still needs exact merchant/environment, obligation/reference/amount/currency validation, event deduplication and atomic ledger handling. Valid HMAC alone is never sufficient authority to settle an obligation.

## Remaining activation gates

| Piece | Required evidence before connection |
|---|---|
| Identity | Existing Homiio app, properly issued service credential with only the required payment scopes, correct environment, and verified technical merchant mapping. No invented user or merchant consent. |
| Rail | Exact deployed processor account/mode, currency support, Homiio commercial scope and a verified sandbox-to-live rollout. Package installation does not activate a rail. |
| Creating payment | Canonical minor-unit integer strings, one stable idempotency key per obligation/intent, parameter-conflict refusal and explicit retry of an uncertain response using the same key. |
| Hosted checkout | Published SDK checkout surface, correct obligation correlation and success confirmed by authorized ingress, never by the browser return URL. |
| Ingress | Raw-body mount, SDK verification, merchant/environment/obligation/resource checks, deduplication and atomic processor movement. No local signature or token client. |
| Refund | Separate authorized refund movement and processor evidence; no reversal inferred from a status string or a FairCoin rail that cannot refund custody it never held. |
| Recurrence | Existing obligation model and explicit approved operations. No scheduler, mandate, dunning or automatic debit is introduced by this change. |

There is still no Pay rent button. This change adopts a published verifier and updates source-backed readiness facts; it does not connect Homiio payments or migrate commercial records. TNP and other planned consumers do not acquire an integration from this module.
