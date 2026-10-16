/**
 * Rent payments — the lease's obligations and its LEDGER, as use cases.
 *
 * `controllers/leaseController.ts` (obligations), `controllers/
 * leasePaymentController.ts` (the ledger) and `capabilities/handlers/
 * payments.ts` (the catalogue tools) all call these.
 *
 * ## What a person can actually do, and what Homiio cannot
 *
 * Peable is not connected (`docs/peable-rent-payments.md`): there is no
 * processor, no card and no "Pay rent" button. What exists is the ledger:
 *
 *  - a tenant **declares** a payment — stored `pending`, it moves nothing;
 *  - a landlord **confirms** it (the ONLY thing that moves a balance) or
 *    **rejects** it with a reason;
 *  - a landlord **records a refund**, a new movement pointing at the original;
 *  - a landlord **adds an obligation** (an amount due on a date).
 *
 * ## Amounts are resolved, never trusted
 *
 * The obligation says what is owed and the lease in what currency. An amount
 * is accepted only so a PARTIAL payment is expressible, and it is checked
 * against what is outstanding, read inside the same transaction.
 *
 * ## Idempotency
 *
 * Every declaration and refund carries an idempotency key unique per lease;
 * a retry with the same key is the same movement (`deduped`). A catalogue tool
 * passes its capability `Idempotency-Key` through {@link ledgerIdempotencyKey},
 * so a coordinator's retry is the same ledger write as well as the same
 * capability receipt.
 */

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import {
  LEASE_IDEMPOTENCY_KEY_PATTERN,
  LEASE_PAYMENT_NOTE_MAX,
  leaseObligationSettlement,
  type PaymentCurrency,
} from '@homiio/shared-types';

import {
  addLeasePayment,
  findLeaseAccess,
  listLeasePayments as listLeasePaymentRows,
  listLeasePaymentsForParty,
  type LeasePaymentStatusValue,
} from '../db/leases/leaseReads';
import { serializeLeasePayment } from '../db/leases/leaseSerializer';
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
import { getDb } from '../db/postgres';
import { leasePaymentMovements, leasePaymentSchedule } from '../db/schema';
import { LEASE_PAYMENT_STATUSES, LEASE_PAYMENT_TYPES } from '../db/schema/leases';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import notificationDispatchService from '../services/notificationDispatchService';
import { ReceiptNotAvailableError, rentReceiptFor } from '../services/payments/rentReceipt';
import { isLeaseLandlord, isLeaseParty, type PageInput, parsePagination } from './leases';

type LeaseAccess = NonNullable<Awaited<ReturnType<typeof findLeaseAccess>>>;

/**
 * The lease and the caller's standing on it, for the LEDGER routes: 404 for a
 * lease that does not exist AND for one the caller is not on — confirming an id
 * exists is already an answer.
 */
async function requireLedgerAccess(oxyUserId: string, leaseId: string): Promise<LeaseAccess> {
  const access = await findLeaseAccess(getDb(), leaseId);
  if (!access || !isLeaseParty(access, oxyUserId)) {
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

/**
 * The ledger key for a capability `Idempotency-Key`: the key itself when it
 * already has the ledger's shape, otherwise its SHA-256 (64 hex characters,
 * which does). Deterministic, so a retry with the same capability key is the
 * same ledger write.
 */
export function ledgerIdempotencyKey(capabilityKey: string): string {
  const key = capabilityKey.trim();
  return LEASE_IDEMPOTENCY_KEY_PATTERN.test(key)
    ? key
    : createHash('sha256').update(key).digest('hex');
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

function paymentStatusFilter(status: unknown): LeasePaymentStatusValue | undefined {
  const statuses: readonly string[] = LEASE_PAYMENT_STATUSES;
  return typeof status === 'string' && statuses.includes(status)
    ? (status as LeasePaymentStatusValue)
    : undefined;
}

// ── Obligations ────────────────────────────────────────────────────────────

/**
 * A lease's payment schedule (what is owed), to a party. 403 for a
 * non-party — the obligations route's historical answer, unlike the ledger.
 */
export async function listLeasePayments(
  oxyUserId: string,
  leaseId: string,
  input: PageInput & { status?: unknown },
) {
  const access = await findLeaseAccess(getDb(), leaseId);
  if (!access) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  if (!isLeaseParty(access, oxyUserId)) {
    throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
  }
  const { page, limit, skip } = parsePagination(input);
  const result = await listLeasePaymentRows(
    getDb(),
    leaseId,
    { status: paymentStatusFilter(input.status) },
    { limit, offset: skip },
  );
  return { payments: result.rows.map(serializeLeasePayment), page, limit, total: result.total };
}

/** Every obligation on every lease I am a party to, soonest due first. */
export async function listMyPayments(oxyUserId: string, input: PageInput & { status?: unknown }) {
  const { page, limit, skip } = parsePagination(input);
  const result = await listLeasePaymentsForParty(
    getDb(),
    oxyUserId,
    { status: paymentStatusFilter(input.status) },
    { limit, offset: skip },
  );
  return {
    payments: result.rows.map((row) => ({ ...serializeLeasePayment(row), leaseId: row.leaseId })),
    page,
    limit,
    total: result.total,
  };
}

/** Add an obligation (an amount due on a date) to a lease — the landlord only. */
export async function createLeasePaymentObligation(
  oxyUserId: string,
  leaseId: string,
  input: { dueDate?: unknown; amount?: unknown; type?: unknown; description?: unknown },
) {
  const { dueDate, amount, type, description } = input;
  if (!dueDate || amount === undefined || amount === null || !type) {
    throw new AppError('dueDate, amount, and type are required', 400, 'VALIDATION_ERROR');
  }
  const parsedDueDate = new Date(dueDate as string);
  if (Number.isNaN(parsedDueDate.getTime())) {
    throw new AppError('dueDate must be a valid date', 400, 'VALIDATION_ERROR');
  }
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount)) {
    throw new AppError('amount must be a number', 400, 'VALIDATION_ERROR');
  }
  // Narrowed here rather than left to the CHECK: an undeclared type arriving as
  // a `23514` would be a 500 where the caller earned a 400 naming the field.
  const types: readonly string[] = LEASE_PAYMENT_TYPES;
  if (typeof type !== 'string' || !types.includes(type)) {
    throw new AppError('type must be one of rent, deposit, fee, utility', 400, 'VALIDATION_ERROR');
  }

  const db = getDb();
  const access = await findLeaseAccess(db, leaseId);
  if (!access) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  if (!isLeaseLandlord(access, oxyUserId)) {
    throw new AppError('Access denied - only the landlord can add payments', 403, 'FORBIDDEN');
  }

  const created = await addLeasePayment(db, leaseId, {
    dueDate: parsedDueDate,
    amount: parsedAmount,
    type: type as (typeof LEASE_PAYMENT_TYPES)[number],
    description: typeof description === 'string' ? description : undefined,
    status: 'pending',
  });
  logger.info('Lease payment created', {
    leaseId,
    paymentId: created.id,
    amount: parsedAmount,
    createdBy: oxyUserId,
  });
  return serializeLeasePayment(created);
}

// ── The ledger ─────────────────────────────────────────────────────────────

/**
 * Every movement, and what each obligation stands at — one answer, so the
 * balance and the movements it is computed from always agree.
 */
export async function getLeaseLedger(oxyUserId: string, leaseId: string) {
  await requireLedgerAccess(oxyUserId, leaseId);
  const db = getDb();
  const movements = (await listMovements(db, leaseId)).map(toMovementDTO);
  const obligations = await db
    .select()
    .from(leasePaymentSchedule)
    .where(eq(leasePaymentSchedule.leaseId, leaseId));
  const summaries = obligations.map((obligation) =>
    leaseObligationSettlement(obligation.id, obligation.amount, movements),
  );
  return { movements, obligations: summaries };
}

/**
 * A receipt for rent that actually settled (409 before confirmation), built
 * from persisted data at the moment it is asked for. The HTML travels as
 * base64 in the ordinary envelope.
 */
export async function readRentReceipt(
  oxyUserId: string,
  leaseId: string,
  movementId: string,
  locale: string,
) {
  const access = await requireLedgerAccess(oxyUserId, leaseId);
  const db = getDb();
  // Scoped to the lease as well as the movement, in the query.
  const [movement] = await db
    .select()
    .from(leasePaymentMovements)
    .where(
      and(eq(leasePaymentMovements.id, movementId), eq(leasePaymentMovements.leaseId, leaseId)),
    )
    .limit(1);
  if (!movement) throw new AppError('Receipt not found', 404, 'NOT_FOUND');

  const [obligation] = await db
    .select()
    .from(leasePaymentSchedule)
    .where(eq(leasePaymentSchedule.id, movement.obligationId))
    .limit(1);

  let receipt: ReturnType<typeof rentReceiptFor>;
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
      locale,
    });
  } catch (error) {
    if (error instanceof ReceiptNotAvailableError) {
      // 409, not 404: the payment is there and the person may see it. What
      // does not exist is a receipt, because it has not settled.
      throw new AppError(
        'A receipt exists only once the payment has been confirmed',
        409,
        'RECEIPT_NOT_SETTLED',
      );
    }
    throw error;
  }
  return {
    id: movement.id,
    filename: receipt.filename,
    contentType: receipt.contentType,
    base64: Buffer.from(receipt.html, 'utf8').toString('base64'),
  };
}

export interface LedgerWrite {
  readonly movement: ReturnType<typeof toMovementDTO>;
  /** True when this key had already recorded the movement (a retry). */
  readonly deduped: boolean;
}

/**
 * The tenant says they paid. A `pending` movement: it moves no balance until
 * the landlord confirms. `amount` defaults to WHAT IS LEFT on the obligation.
 */
export async function declareRentPayment(
  oxyUserId: string,
  input: {
    leaseId: string;
    obligationId: string;
    idempotencyKey: unknown;
    amount?: unknown;
    note?: unknown;
  },
): Promise<LedgerWrite> {
  const access = await requireLedgerAccess(oxyUserId, input.leaseId);
  if (isLeaseLandlord(access, oxyUserId)) {
    // A landlord declaring on a tenant's behalf would be the landlord's word
    // recorded as the tenant's.
    throw new AppError(
      'Only a tenant or co-tenant can declare a payment on this lease',
      403,
      'FORBIDDEN',
    );
  }

  const { leaseId, obligationId } = input;
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const note = optionalNote(input.note);

  const outcome = await getDb().transaction(async (tx) => {
    const obligation = await findObligation(tx, leaseId, obligationId);
    if (!obligation) throw new AppError('Payment obligation not found', 404, 'NOT_FOUND');
    if (obligation.status === 'cancelled') {
      throw new AppError(
        'That obligation has been cancelled and cannot be paid',
        409,
        'OBLIGATION_CANCELLED',
      );
    }
    const currency = await leasePaymentCurrency(tx, leaseId);
    if (!currency) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');

    const settled = await settledAmountOf(tx, leaseId, obligationId);
    const outstanding = Math.max(0, obligation.amount - settled);
    const amount = input.amount === undefined ? outstanding : requireAmount(input.amount);

    if (outstanding <= 0) {
      throw new AppError('That obligation is already settled', 409, 'OBLIGATION_SETTLED');
    }
    if (amount > outstanding) {
      // Refusing rather than clamping: recording a different number than the
      // person typed is worse than telling them.
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
  return { movement: toMovementDTO(outcome.movement), deduped: outcome.deduped };
}

/** The landlord agrees the money arrived — the only thing that moves a balance. */
export async function confirmRentPayment(
  oxyUserId: string,
  input: { leaseId: string; movementId: string },
) {
  const access = await requireLedgerAccess(oxyUserId, input.leaseId);
  if (!isLeaseLandlord(access, oxyUserId)) {
    throw new AppError('Only the landlord can confirm a payment on this lease', 403, 'FORBIDDEN');
  }
  const outcome = await confirmMovement(getDb(), {
    leaseId: input.leaseId,
    movementId: input.movementId,
    confirmedByOxyUserId: oxyUserId,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'not_found') throw new AppError('Payment not found', 404, 'NOT_FOUND');
    throw new AppError('That payment is not awaiting confirmation', 409, 'PAYMENT_NOT_PENDING');
  }
  if (!outcome.alreadyConfirmed) {
    void notificationDispatchService.createForUser(access.tenantOxyUserId, {
      type: 'lease_payment_confirmed',
      title: 'Your payment was confirmed',
      message: 'The balance has been updated.',
      priority: 'medium',
      data: { leaseId: input.leaseId, movementId: outcome.movement.id },
    });
  }
  return toMovementDTO(outcome.movement);
}

/** The landlord says the money did not arrive. A reason is required. */
export async function rejectRentPayment(
  oxyUserId: string,
  input: { leaseId: string; movementId: string; reason?: unknown },
) {
  const access = await requireLedgerAccess(oxyUserId, input.leaseId);
  if (!isLeaseLandlord(access, oxyUserId)) {
    throw new AppError('Only the landlord can reject a payment on this lease', 403, 'FORBIDDEN');
  }
  const reason = optionalNote(input.reason);
  if (!reason) {
    throw new AppError('reason is required to reject a payment', 400, 'VALIDATION_ERROR');
  }
  const outcome = await failMovement(getDb(), {
    leaseId: input.leaseId,
    movementId: input.movementId,
    failureReason: reason,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'not_found') throw new AppError('Payment not found', 404, 'NOT_FOUND');
    throw new AppError('That payment is not awaiting confirmation', 409, 'PAYMENT_NOT_PENDING');
  }
  if (!outcome.alreadyConfirmed) {
    void notificationDispatchService.createForUser(access.tenantOxyUserId, {
      type: 'lease_payment_rejected',
      title: 'A payment could not be confirmed',
      message: reason,
      priority: 'high',
      data: { leaseId: input.leaseId, movementId: outcome.movement.id },
    });
  }
  return toMovementDTO(outcome.movement);
}

/**
 * Money going back: a NEW movement pointing at the confirmed payment it
 * reverses (which stays `succeeded`). Defaults to the full payment.
 */
export async function refundRentPayment(
  oxyUserId: string,
  input: {
    leaseId: string;
    movementId: string;
    idempotencyKey: unknown;
    amount?: unknown;
    note?: unknown;
  },
): Promise<LedgerWrite> {
  const access = await requireLedgerAccess(oxyUserId, input.leaseId);
  if (!isLeaseLandlord(access, oxyUserId)) {
    throw new AppError('Only the landlord can record a refund on this lease', 403, 'FORBIDDEN');
  }
  const { leaseId, movementId } = input;
  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const note = optionalNote(input.note);

  const outcome = await getDb().transaction(async (tx) => {
    const original = await findMovement(tx, leaseId, movementId);
    if (!original) throw new AppError('Payment not found', 404, 'NOT_FOUND');
    if (original.state !== 'succeeded' || original.direction !== 'payment') {
      throw new AppError('Only a confirmed payment can be refunded', 409, 'PAYMENT_NOT_REFUNDABLE');
    }
    const amount = input.amount === undefined ? original.amount : requireAmount(input.amount);
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
      // can tell — they sent it — so it settles immediately.
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
  return { movement: toMovementDTO(outcome.movement), deduped: outcome.deduped };
}
