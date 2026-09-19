/**
 * Rent payments as a LEDGER (#518 §7.2, #519 §7.2).
 *
 * ## What existed, and why it was not a payment system
 *
 * `lease_payment_schedule` is a list of **obligations**: rent falls due on the
 * 1st, the deposit is owed at the start. Its `status` could be set to `paid`
 * with a date, an amount and a method — and `recordPayment`, the one function
 * that did that, **had no caller anywhere in the package**. So nothing in
 * Homiio had ever recorded a payment; the only live write was a landlord adding
 * another due date.
 *
 * Both epics say the same thing about that: "Extender el vencimiento existente,
 * no confundirlo con un pago procesado. Separar obligaciones, intentos, pagos
 * confirmados, importes parciales, fallos, devoluciones y registros manuales."
 *
 * ## The distinction that shapes the whole file
 *
 * **An obligation is not a payment, and a claim is not a settlement.**
 *
 * A row here is a MOVEMENT against an obligation, and it carries how it was
 * made and how far it got. That is what makes the three states a person
 * actually cares about expressible, none of which a boolean on the obligation
 * can say:
 *
 *  - *"I sent the transfer on Friday"* — a `manual_declaration` that is
 *    `pending`. **Not paid.** The tenant has said something; nobody has
 *    confirmed it. #518 §7.2: "Un pago declarado por transferencia debe
 *    identificarse como declarado/confirmado según su flujo, no fingirse
 *    liquidado por un procesador."
 *  - *"I paid half"* — a `succeeded` movement smaller than the obligation. The
 *    balance is the obligation minus what settled, and it is derived rather
 *    than stored, so it cannot drift.
 *  - *"that was refunded"* — a separate row pointing at what it reverses. The
 *    original stays `succeeded` forever: a ledger that edits its own history is
 *    a ledger nobody can reconcile.
 *
 * ## Idempotency is in the shape, not in a caller's discipline
 *
 * Every movement carries a client-supplied `idempotencyKey`, unique per lease.
 * A double tap, a retried request and a replayed webhook all resolve to the row
 * that already exists. #518 §7.2 lists the four cases — creation, double tap,
 * checkout return and duplicate or out-of-order webhooks — and one key answers
 * all four because the row is the dedupe.
 *
 * ## What is deliberately NOT here
 *
 * **No processor integration.** `kind: 'processor'` and `processorReference`
 * exist in the model because the split is what both epics ask for, and because
 * adding them later would mean migrating a ledger that had already recorded
 * payments. There is no route that creates one, and no card or bank detail is
 * modelled anywhere — #518 §7.2 forbids storing them outright. Choosing and
 * provisioning a processor is a delivery block, recorded in
 * `docs/housing-parity.md`, not a reason to leave the model unable to express a
 * confirmed payment.
 *
 * **No escrow, no penalties, no invented fees.**
 */

import type { PaymentCurrency } from './currency';

/**
 * How a movement was made.
 *
 * Two values, and the gap between them is the point: a declaration is somebody
 * SAYING they paid, and a processor movement is money that actually moved
 * through a system Homiio can ask. They settle differently — one by a landlord
 * confirming, one by a webhook — and a UI that drew them the same way would be
 * telling a tenant their transfer had cleared when nobody had looked.
 */
export const LEASE_PAYMENT_KINDS = ['manual_declaration', 'processor'] as const;
export type LeasePaymentKind = (typeof LEASE_PAYMENT_KINDS)[number];

/** Money out of the tenant, or back to them. */
export const LEASE_MOVEMENT_DIRECTIONS = ['payment', 'refund'] as const;
export type LeaseMovementDirection = (typeof LEASE_MOVEMENT_DIRECTIONS)[number];

/**
 * How far a movement got.
 *
 *  - `initiated` — created, nothing has happened yet. A processor checkout that
 *    has been opened but not completed lives here, and so does nothing else.
 *  - `pending` — awaiting somebody or something. A declared transfer waiting
 *    for the landlord; a processor payment awaiting settlement.
 *  - `succeeded` — confirmed. **Only this state moves the balance.**
 *  - `failed` — it did not happen, with a reason.
 *
 * There is no `refunded`: a refund is its own row. Mutating a settled payment
 * to say it was reversed destroys the record of the original, and reconciling
 * against a processor then has nothing to reconcile against.
 */
export const LEASE_MOVEMENT_STATES = ['initiated', 'pending', 'succeeded', 'failed'] as const;
export type LeaseMovementState = (typeof LEASE_MOVEMENT_STATES)[number];

/** A single movement against one obligation. */
export interface LeasePaymentMovement {
  readonly id: string;
  readonly leaseId: string;
  /** The `lease_payment_schedule` row this pays or refunds. */
  readonly obligationId: string;
  readonly direction: LeaseMovementDirection;
  readonly kind: LeasePaymentKind;
  readonly state: LeaseMovementState;
  /** Always positive. A refund's DIRECTION is what makes it subtract. */
  readonly amount: number;
  /** Resolved from the lease by the server. Never taken from a request body. */
  readonly currency: PaymentCurrency;
  /** Who created the movement. */
  readonly createdByOxyUserId: string;
  /** Who confirmed it, when somebody had to. */
  readonly confirmedByOxyUserId?: string;
  readonly confirmedAt?: string;
  /** The processor's own reference. Never a credential, never a card detail. */
  readonly processorReference?: string;
  readonly failureReason?: string;
  /** Present on a refund: the movement it reverses. */
  readonly reversesMovementId?: string;
  readonly note?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What an obligation actually stands at.
 *
 * Every field is DERIVED from the ledger rather than stored, which is what
 * makes it impossible for the summary and the movements to disagree. The
 * obligation row's own `status` column is deliberately not consulted for
 * `settled` — see {@link leaseObligationSettlement}.
 */
export interface LeaseObligationSummary {
  readonly obligationId: string;
  /** What is owed. */
  readonly amount: number;
  /** What has actually settled: succeeded payments minus succeeded refunds. */
  readonly settledAmount: number;
  /** `amount - settledAmount`, floored at zero. */
  readonly outstandingAmount: number;
  /** Money a tenant has claimed and nobody has confirmed. NOT settled. */
  readonly declaredAmount: number;
  readonly settled: boolean;
  /** When the last confirmation landed, when there is one. */
  readonly settledAt?: string;
}

/**
 * Compute an obligation's standing from its movements.
 *
 * Shared, and used by BOTH sides: the server serialises it and the client can
 * recompute it for an optimistic update without a second definition of what
 * "paid" means.
 *
 * Only `succeeded` moves the balance. A `pending` declaration is counted
 * separately as `declaredAmount` so a surface can say "you said you sent €900;
 * your landlord has not confirmed it" — which is the honest sentence, and the
 * one #518 §7.2 asks for in place of a green tick.
 */
export function leaseObligationSettlement(
  obligationId: string,
  amount: number,
  movements: readonly LeasePaymentMovement[],
): LeaseObligationSummary {
  let settledAmount = 0;
  let declaredAmount = 0;
  let settledAt: string | undefined;

  for (const movement of movements) {
    if (movement.obligationId !== obligationId) continue;

    if (movement.state === 'succeeded') {
      settledAmount += movement.direction === 'refund' ? -movement.amount : movement.amount;
      if (movement.confirmedAt && (!settledAt || movement.confirmedAt > settledAt)) {
        settledAt = movement.confirmedAt;
      }
      continue;
    }

    // A claim nobody has confirmed. Counted, and counted SEPARATELY: adding it
    // to the settled total is precisely the lie this contract exists to
    // prevent.
    if (movement.state === 'pending' && movement.direction === 'payment') {
      declaredAmount += movement.amount;
    }
  }

  // A refund can exceed what was paid only through a data error; flooring the
  // NEGATIVE at zero would hide it, so the raw sum is reported and only the
  // OUTSTANDING figure is floored — a negative "still owed" is meaningless on a
  // screen, while a negative "settled" is a signal.
  const outstandingAmount = Math.max(0, amount - settledAmount);

  return {
    obligationId,
    amount,
    settledAmount,
    outstandingAmount,
    declaredAmount,
    settled: settledAmount >= amount && amount > 0,
    ...(settledAt ? { settledAt } : {}),
  };
}

/**
 * What a lease owes in total, across its obligations.
 *
 * Summed from the per-obligation answers rather than from the movements
 * directly, so the two can never disagree about one obligation while agreeing
 * about the total.
 */
export function leaseOutstandingTotal(summaries: readonly LeaseObligationSummary[]): number {
  return summaries.reduce((total, summary) => total + summary.outstandingAmount, 0);
}

/** The most a note or a failure reason may carry. */
export const LEASE_PAYMENT_NOTE_MAX = 500;
/** An idempotency key's shape, checked on both sides. */
export const LEASE_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
