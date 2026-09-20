/**
 * The rent ledger's HTTP surface (#518 §7.2, #519 §7.2).
 *
 * ## The three things a person can actually do
 *
 * A tenant **declares** a payment — "I sent the transfer on Friday". A landlord
 * **confirms** or **rejects** it. A landlord **records a refund**. That is the
 * whole of what Homiio can honestly offer without a processor, and each one is
 * a different claim by a different person:
 *
 *  - a declaration is the tenant's word, and it is stored as `pending`;
 *  - a confirmation is the landlord's, and it is the ONLY thing that moves the
 *    balance;
 *  - a refund is money going back, recorded as its own movement so the original
 *    payment survives.
 *
 * #518 §7.2 is explicit that the first must never be rendered as the second:
 * "Un pago declarado por transferencia debe identificarse como
 * declarado/confirmado según su flujo, no fingirse liquidado por un procesador."
 *
 * ## "Pay rent" is NOT here, and the model says why rather than hiding it
 *
 * There is no processor route. `kind: 'processor'` exists in the ledger because
 * the split is what both epics require and because bolting it on later would
 * mean migrating a ledger that had already recorded payments — but nothing
 * creates one, and no card or bank detail is modelled anywhere. Choosing a
 * processor is a delivery block recorded in `docs/housing-parity.md`. A button
 * that opened a checkout Homiio cannot settle would be exactly the simulated
 * success both epics forbid.
 *
 * ## Amounts are resolved, never accepted
 *
 * The obligation says what is owed and the lease says in what currency. A
 * caller supplies an amount only so a PARTIAL payment is expressible, and it
 * is checked against what is actually outstanding — read inside the same
 * transaction, so a second declaration cannot slip past a stale total.
 */

import type { NextFunction, Request, Response } from 'express';

import { ReceiptNotAvailableError, rentReceiptFor } from '../services/payments/rentReceipt';
import {
  LEASE_IDEMPOTENCY_KEY_PATTERN,
  LEASE_PAYMENT_NOTE_MAX,
  leaseObligationSettlement,
  type PaymentCurrency,
} from '@homiio/shared-types';

import { and, eq } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { leasePaymentMovements, leasePaymentSchedule } from '../db/schema';
import { findLeaseAccess } from '../db/leases/leaseReads';
import {
  confirmMovement,
  failMovement,
  findMovement,
  findObligation,
  leasePaymentCurrency,
  listMovements,
  recordMovement,
  settledAmountOf,
  toMovementDTO,
} from '../db/leases/paymentLedger';
import { AppError, successResponse } from '../middlewares/errorHandler';
import notificationDispatchService from '../services/notificationDispatchService';
import { requireSessionOxyUserId } from '../utils/sessionUser';

/** Everyone on the lease. A payment is between the parties to it. */
function isParty(
  access: NonNullable<Awaited<ReturnType<typeof findLeaseAccess>>>,
  oxyUserId: string,
): boolean {
  return (
    access.landlordOxyUserId === oxyUserId ||
    access.tenantOxyUserId === oxyUserId ||
    access.coTenantOxyUserIds.includes(oxyUserId)
  );
}

const isLandlord = (
  access: NonNullable<Awaited<ReturnType<typeof findLeaseAccess>>>,
  oxyUserId: string,
): boolean => access.landlordOxyUserId === oxyUserId;

/**
 * The lease this request is about, and the caller's standing on it.
 *
 * 404 for a lease that does not exist AND for one the caller is not on — the
 * same rule the rest of the package follows, for the same reason: confirming
 * an id exists is already an answer.
 */
async function requireLeaseAccess(req: Request, oxyUserId: string) {
  const access = await findLeaseAccess(getDb(), String(req.params.id));
  if (!access || !isParty(access, oxyUserId)) {
    throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  }
  return access;
}

/** A caller-supplied idempotency key, or a 400 naming it. */
function requireIdempotencyKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!LEASE_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError(
      'idempotencyKey must be 8-64 characters of letters, digits, hyphen or underscore',
      400,
      'VALIDATION_ERROR',
    );
  }
  return key;
}

/** A positive money amount, or a 400. Never rounded or coerced. */
function requireAmount(value: unknown): number {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('amount must be a positive number', 400, 'VALIDATION_ERROR');
  }
  return amount;
}

function optionalNote(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const note = value.trim();
  if (note.length === 0) return undefined;
  if (note.length > LEASE_PAYMENT_NOTE_MAX) {
    throw new AppError(
      `note must be at most ${LEASE_PAYMENT_NOTE_MAX} characters`,
      400,
      'VALIDATION_ERROR',
    );
  }
  return note;
}

/**
 * `GET /api/leases/:id/ledger` — every movement, and what each obligation
 * stands at.
 *
 * One response rather than two endpoints, because a balance read separately
 * from the movements it is computed from is a balance that can be a request
 * behind — and the whole point of deriving it is that the two agree.
 */
export async function getLedger(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    await requireLeaseAccess(req, oxyUserId);

    const db = getDb();
    const leaseId = String(req.params.id);
    const movements = (await listMovements(db, leaseId)).map(toMovementDTO);

    const obligations = await db
      .select()
      .from(leasePaymentSchedule)
      .where(eq(leasePaymentSchedule.leaseId, leaseId));

    const summaries = obligations.map((obligation) =>
      leaseObligationSettlement(obligation.id, obligation.amount, movements),
    );

    res.json(
      successResponse({ movements, obligations: summaries }, 'Lease payment ledger retrieved'),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/leases/:id/movements/:movementId/receipt` — a receipt for rent that
 * actually settled.
 *
 * §7.2: "Recibos reales con permisos de descarga. Totales y estados derivados
 * de datos persistidos, no de una página parcial ni de las cifras del
 * template." Both halves are here:
 *
 *  - **Permissions.** Mounted on the authenticated router and scoped to the
 *    lease's parties through the same `requireLeaseAccess` every other handler
 *    here uses, so a stranger gets 404 and a movement id from another lease
 *    resolves to nothing. Knowing an id grants nothing.
 *  - **Derived from persisted data.** Built from the movement, its obligation
 *    and the lease at the moment it is asked for. Nothing is stored, so there
 *    is no second answer to "what was paid" and no stored copy to go on saying
 *    something the ledger no longer does — after a refund, most obviously.
 *
 * A receipt exists only for a `succeeded` movement. Issuing one for a tenant's
 * unconfirmed declaration would be a document asserting that money arrived
 * because somebody said it had, which is the confusion this whole ledger exists
 * to prevent, printed onto a page.
 */
export async function getReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const access = await requireLeaseAccess(req, oxyUserId);

    const db = getDb();
    const leaseId = String(req.params.id);
    const movementId = String(req.params.movementId);

    // Scoped to the lease as well as the movement, in the query: an id from
    // somebody else's tenancy must resolve to nothing rather than to a 403.
    const [movement] = await db
      .select()
      .from(leasePaymentMovements)
      .where(
        and(
          eq(leasePaymentMovements.id, movementId),
          eq(leasePaymentMovements.leaseId, leaseId),
        ),
      )
      .limit(1);
    if (!movement) throw new AppError('Receipt not found', 404, 'NOT_FOUND');

    const [obligation] = await db
      .select()
      .from(leasePaymentSchedule)
      .where(eq(leasePaymentSchedule.id, movement.obligationId))
      .limit(1);

    let receipt;
    try {
      receipt = rentReceiptFor({
        movementId: movement.id,
        state: movement.state,
        amount: movement.amount,
        currency: movement.currency,
        confirmedAt: movement.confirmedAt?.toISOString(),
        createdAt: movement.createdAt.toISOString(),
        obligationDueDate: obligation?.dueDate?.toISOString(),
        obligationType: obligation?.type,
        tenantOxyUserId: access.tenantOxyUserId,
        landlordOxyUserId: access.landlordOxyUserId,
        propertyLabel: undefined,
        kind: movement.kind,
        locale: receiptLocale(req),
      });
    } catch (error) {
      if (error instanceof ReceiptNotAvailableError) {
        // 409, not 404: the payment is there and the person may see it. What
        // does not exist is a receipt, because it has not settled — and saying
        // so is more use than pretending the movement is missing.
        throw new AppError(
          'A receipt exists only once the payment has been confirmed',
          409,
          'RECEIPT_NOT_SETTLED',
        );
      }
      throw error;
    }

    // Base64 in the ordinary envelope, like every other private document this
    // app serves. The Oxy linked client owns auth and is JSON-only, and
    // `AGENTS.md` forbids a second manual token path, so there is no
    // authenticated way for the client to fetch a raw `text/html` body. The
    // client writes the file and opens it (`utils/privateDocument.ts`).
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(
      successResponse(
        {
          id: movement.id,
          filename: receipt.filename,
          contentType: receipt.contentType,
          base64: Buffer.from(receipt.html, 'utf8').toString('base64'),
        },
        'Receipt retrieved',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * The language to render a receipt in.
 *
 * `Accept-Language`'s first tag, validated as a BCP-47-ish shape before it
 * reaches `Intl` — an arbitrary header value throws a `RangeError` there, which
 * would turn a malformed request into a 500. English when there is nothing
 * usable, because a receipt must render for every caller.
 */
function receiptLocale(req: Request): string {
  const header = req.headers['accept-language'];
  const first = (typeof header === 'string' ? header : '').split(',')[0]?.trim() ?? '';
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(first) ? first : 'en';
}

/**
 * `POST /api/leases/:id/obligations/:obligationId/declarations` — the tenant
 * says they paid.
 *
 * Creates a `pending` movement. It does NOT move the balance, and the response
 * says `state: 'pending'` so nothing downstream can mistake it for a
 * settlement.
 */
export async function declarePayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const access = await requireLeaseAccess(req, oxyUserId);
    if (isLandlord(access, oxyUserId)) {
      // A landlord declaring a payment on their own tenant's behalf would be
      // the landlord's word recorded as the tenant's. If a landlord received
      // money outside the app, the honest action is to confirm a declaration
      // or to record one explicitly as themselves — neither of which this
      // endpoint is.
      throw new AppError(
        'Only a tenant or co-tenant can declare a payment on this lease',
        403,
        'FORBIDDEN',
      );
    }

    const leaseId = String(req.params.id);
    const obligationId = String(req.params.obligationId);
    const idempotencyKey = requireIdempotencyKey(req.body?.idempotencyKey);
    const note = optionalNote(req.body?.note);

    const db = getDb();
    const outcome = await db.transaction(async (tx) => {
      const obligation = await findObligation(tx, leaseId, obligationId);
      if (!obligation) {
        throw new AppError('Payment obligation not found', 404, 'NOT_FOUND');
      }
      if (obligation.status === 'cancelled') {
        throw new AppError(
          'That obligation has been cancelled and cannot be paid',
          409,
          'OBLIGATION_CANCELLED',
        );
      }

      const currency = await leasePaymentCurrency(tx, leaseId);
      if (!currency) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }

      // Defaults to WHAT IS LEFT, not to the obligation's full amount: after a
      // partial payment the natural next declaration is the remainder, and a
      // default that ignored the ledger would over-declare by design.
      const settled = await settledAmountOf(tx, leaseId, obligationId);
      const outstanding = Math.max(0, obligation.amount - settled);
      const amount =
        req.body?.amount === undefined ? outstanding : requireAmount(req.body.amount);

      if (outstanding <= 0) {
        throw new AppError('That obligation is already settled', 409, 'OBLIGATION_SETTLED');
      }
      if (amount > outstanding) {
        // Refusing rather than clamping: a person declaring more than is owed
        // has misunderstood something, and quietly recording a different number
        // than they typed is worse than telling them.
        throw new AppError(
          'amount is more than the outstanding balance on that obligation',
          400,
          'AMOUNT_EXCEEDS_OUTSTANDING',
        );
      }

      return recordMovement(tx, {
        leaseId,
        obligationId,
        direction: 'payment',
        kind: 'manual_declaration',
        // PENDING. The tenant has said something; nobody has confirmed it.
        state: 'pending',
        amount,
        currency: currency as PaymentCurrency,
        createdByOxyUserId: oxyUserId,
        idempotencyKey,
        ...(note ? { note } : {}),
      });
    });

    if (!outcome.deduped) {
      void notificationDispatchService.createForUser(access.landlordOxyUserId, {
        type: 'lease_payment_declared',
        title: 'A tenant says they have paid',
        message: 'Confirm it to update the balance.',
        priority: 'medium',
        data: { leaseId, obligationId, movementId: outcome.movement.id },
      });
    }

    // 200 for a deduped request, 201 for a new one. The difference is what
    // makes "my retry created a second payment" testable rather than believed.
    res
      .status(outcome.deduped ? 200 : 201)
      .json(
        successResponse(
          toMovementDTO(outcome.movement),
          outcome.deduped ? 'Payment already declared' : 'Payment declared',
        ),
      );
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/leases/:id/movements/:movementId/confirm` — the landlord agrees
 * the money arrived.
 *
 * The only thing in Homiio that moves a balance.
 */
export async function confirmPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const access = await requireLeaseAccess(req, oxyUserId);
    if (!isLandlord(access, oxyUserId)) {
      throw new AppError(
        'Only the landlord can confirm a payment on this lease',
        403,
        'FORBIDDEN',
      );
    }

    const leaseId = String(req.params.id);
    const outcome = await confirmMovement(getDb(), {
      leaseId,
      movementId: String(req.params.movementId),
      confirmedByOxyUserId: oxyUserId,
    });

    if (!outcome.ok) {
      if (outcome.reason === 'not_found') {
        throw new AppError('Payment not found', 404, 'NOT_FOUND');
      }
      throw new AppError(
        'That payment is not awaiting confirmation',
        409,
        'PAYMENT_NOT_PENDING',
      );
    }

    if (!outcome.alreadyConfirmed) {
      void notificationDispatchService.createForUser(access.tenantOxyUserId, {
        type: 'lease_payment_confirmed',
        title: 'Your payment was confirmed',
        message: 'The balance has been updated.',
        priority: 'medium',
        data: { leaseId, movementId: outcome.movement.id },
      });
    }

    res.json(successResponse(toMovementDTO(outcome.movement), 'Payment confirmed'));
  } catch (error) {
    next(error);
  }
}

/** `POST /api/leases/:id/movements/:movementId/reject` — the money did not arrive. */
export async function rejectPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const access = await requireLeaseAccess(req, oxyUserId);
    if (!isLandlord(access, oxyUserId)) {
      throw new AppError('Only the landlord can reject a payment on this lease', 403, 'FORBIDDEN');
    }

    const reason = optionalNote(req.body?.reason);
    if (!reason) {
      // A rejection without a reason is a tenant told "no" with nowhere to go.
      // The CHECK would refuse it anyway; this names the field.
      throw new AppError('reason is required to reject a payment', 400, 'VALIDATION_ERROR');
    }

    const leaseId = String(req.params.id);
    const outcome = await failMovement(getDb(), {
      leaseId,
      movementId: String(req.params.movementId),
      failureReason: reason,
    });

    if (!outcome.ok) {
      if (outcome.reason === 'not_found') {
        throw new AppError('Payment not found', 404, 'NOT_FOUND');
      }
      throw new AppError('That payment is not awaiting confirmation', 409, 'PAYMENT_NOT_PENDING');
    }

    if (!outcome.alreadyConfirmed) {
      void notificationDispatchService.createForUser(access.tenantOxyUserId, {
        type: 'lease_payment_rejected',
        title: 'A payment could not be confirmed',
        message: reason,
        priority: 'high',
        data: { leaseId, movementId: outcome.movement.id },
      });
    }

    res.json(successResponse(toMovementDTO(outcome.movement), 'Payment rejected'));
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/leases/:id/movements/:movementId/refunds` — money going back.
 *
 * A NEW movement pointing at the one it reverses. The original stays
 * `succeeded`, which is what makes the history reconcilable.
 */
export async function refundPayment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const access = await requireLeaseAccess(req, oxyUserId);
    if (!isLandlord(access, oxyUserId)) {
      throw new AppError('Only the landlord can record a refund on this lease', 403, 'FORBIDDEN');
    }

    const leaseId = String(req.params.id);
    const movementId = String(req.params.movementId);
    const idempotencyKey = requireIdempotencyKey(req.body?.idempotencyKey);
    const note = optionalNote(req.body?.note);

    const db = getDb();
    const outcome = await db.transaction(async (tx) => {
      const original = await findMovement(tx, leaseId, movementId);
      if (!original) throw new AppError('Payment not found', 404, 'NOT_FOUND');
      if (original.state !== 'succeeded' || original.direction !== 'payment') {
        // Refunding something that never settled would take money out of a
        // balance it was never in.
        throw new AppError(
          'Only a confirmed payment can be refunded',
          409,
          'PAYMENT_NOT_REFUNDABLE',
        );
      }

      const amount =
        req.body?.amount === undefined ? original.amount : requireAmount(req.body.amount);
      if (amount > original.amount) {
        throw new AppError(
          'amount is more than the payment being refunded',
          400,
          'AMOUNT_EXCEEDS_PAYMENT',
        );
      }

      return recordMovement(tx, {
        leaseId,
        obligationId: original.obligationId,
        direction: 'refund',
        kind: original.kind,
        // A refund the landlord records has already happened as far as Homiio
        // can tell — they are the one who sent it — so it settles immediately
        // and says who confirmed it.
        state: 'succeeded',
        amount,
        currency: original.currency as PaymentCurrency,
        createdByOxyUserId: oxyUserId,
        confirmedByOxyUserId: oxyUserId,
        confirmedAt: new Date(),
        reversesMovementId: original.id,
        idempotencyKey,
        ...(note ? { note } : {}),
      });
    });

    if (!outcome.deduped) {
      void notificationDispatchService.createForUser(access.tenantOxyUserId, {
        type: 'lease_payment_refunded',
        title: 'A payment was refunded',
        message: 'Your balance has been updated.',
        priority: 'medium',
        data: { leaseId, movementId: outcome.movement.id },
      });
    }

    res
      .status(outcome.deduped ? 200 : 201)
      .json(
        successResponse(
          toMovementDTO(outcome.movement),
          outcome.deduped ? 'Refund already recorded' : 'Refund recorded',
        ),
      );
  } catch (error) {
    next(error);
  }
}
