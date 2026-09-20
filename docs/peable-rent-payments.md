# Paying rent through Peable

Peable is the chosen processor for rent. **It is not connected**, and this page
says exactly why, what is already in place, and what remains.

Everything below was read out of `~/Oxy/Peable` and verified against the live
service and the public registry on 2026-09-20, with file paths, because the
difference between "the gateway supports cards" and "the card rail has ever
taken a payment" is the whole of this page.

## What is already in place

**The ledger.** `lease_payment_movements` was built with a processor in mind and
needs no migration to accept one:

- `kind: 'processor'` sits beside `manual_declaration`, so a processor payment
  and a tenant's claim that they sent a transfer are different rows with
  different settlement rules rather than one column with a flag.
- `processor_reference` carries its own **partial** unique index, which is what
  makes a replayed webhook find the row it already created instead of creating a
  second one. Partial, because every declaration's reference is null and a total
  index would permit exactly one declaration in the whole table.
- Every write already takes an idempotency key, unique per lease.

**The pure half of the integration**, in
`packages/backend/services/payments/peableContract.ts`, with tests:

- `peableStatusMeaning` — what each Peable intent status means to the ledger.
  Three outcomes, not one: a state, a **refund** (which is its own row in
  Homiio's ledger, never an edit to the original), or `unknown`. A status this
  build has never seen changes nothing, because reading a new status as a
  settlement is how a payment system credits money that never arrived.
- `verifyPeableSignature` — `Peable-Signature: t=…,v1=…`, HMAC-SHA256 over
  `"<t>.<raw body>"`. The raw bytes; re-serialising the parsed JSON breaks every
  signature, and the test suite pins that case specifically.

No credential is held, no route is mounted, and nothing calls Peable.

## Why it is not connected: four blockers

**1. Rent in euros needs the card rail, and the card rail is not live.**
Peable's own roadmap (`docs/PEABLE-ROADMAP.md`) marks card payments as
implemented, **never exercised against Stripe's sandbox by a person**, not
deployed and not live — and says no row may move without that. A deployment
without the Stripe secrets answers `503` on `POST /v1/payment_intents`
(`services/createIntent.ts`).

**2. There is no FX anywhere in Peable**, and its source says so in as many
words. The FairCoin rail is deployed and healthy (`api.peable.to/health` answers
`200`), but `assertRailCurrency` refuses any currency but `FAIR` on it. So a EUR
rent amount cannot settle over the rail that works, and the rail that could take
EUR is the one that is not live. These two facts together are why this is a seam
and not an integration.

**3. The published SDK cannot be installed.** `@peable.to/sdk@0.1.1` declares
`"@peable.to/shared-types": "workspace:^"` as a runtime dependency, which
resolves only inside Peable's own monorepo — anywhere else npm fails with
`EUNSUPPORTEDPROTOCOL`. Verified directly against the registry manifest. The
published surface is also behind the repository: it carries no refunds,
transfers or disputes namespace. So integrating means REST plus our own types,
which is what `peableContract.ts` holds.

**4. Nothing in Peable is a subscription engine**, and its roadmap says so
outright. Rent is recurring by definition. That is not an obstacle so much as a
shape: each month is its own intent minted by Homiio against its own obligation
row, which is what the ledger already models.

## What the wiring will be

Recorded now so it is not re-derived under time pressure later.

| Piece | Shape |
|---|---|
| Auth | No Peable API key exists. The SDK presents the **same Oxy `ApplicationCredential`** Console already issues, exchanges it at `POST https://api.oxy.so/auth/service-token`, and caches the token. Homiio needs an Oxy Application with a `service` credential carrying `payments:read` and `payments:write`, then one `POST /v1/merchants`. |
| Taking money | `POST /v1/payment_intents`, with `Idempotency-Key` as a **required header**. Amounts are canonical minor-unit integer strings, never floats. A replay with a different amount, currency or rail is a `409`, not a second charge. |
| Hosted payment | `POST /v1/checkout_sessions` wraps exactly one intent and returns a `checkout.peable.to` URL. |
| Settlement | The webhook. `payment_intent.settled` is the only event that may move a movement to `succeeded`. |
| Refunds | `POST /v1/refunds`, idempotent on `externalRef` rather than a header. **A FairCoin payment cannot be refunded through Peable at all** — the gateway never held the funds — so it answers `503`. Homiio's refund-as-its-own-row model already tolerates that: the row simply never reaches `succeeded`. |
| Environment | Test versus live comes from the credential, never from a flag Homiio sends. |

**One bug to route around when the time comes.** Peable's SDK
`constructEvent` structurally whitelists five event types, so a
`payment_intent.refunded`, `.partially_refunded`, `.disputed`,
`.dispute_closed` or `connected_account.updated` delivery verifies its signature
and is then discarded as not matching the expected shape. Homiio verifies
signatures itself (`verifyPeableSignature`) and is not exposed to it, but
anybody reaching for the SDK should know.

## What Homiio must not do meanwhile

There is **no "Pay rent" button**, and there must not be one until a rail can
actually settle the amount. A button that opened a checkout Homiio cannot
confirm is the simulated success both epics forbid, and #518 §7.2 is explicit
that the absence is a documented delivery block rather than licence to drop the
row.

The honest affordance is the one that ships: a tenant declares a transfer, the
landlord confirms it or rejects it with a reason, and the ledger records who
said what and when.
