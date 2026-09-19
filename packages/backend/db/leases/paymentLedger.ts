/**
 * The rent ledger's writes and reads (#518 §7.2, #519 §7.2).
 *
 * ## Idempotency is an INSERT, not a lookup-then-insert
 *
 * Every write goes through `on conflict do nothing` on the unique key, then
 * re-reads. A `select` followed by an `insert` has a window between them, and
 * that window is exactly where a double tap lands: both requests find nothing,
 * both insert, and the tenant has paid twice. Pushing the decision into the
 * INDEX means the database arbitrates and the loser is told which row won.
 *
 * The same shape answers all four cases #518 §7.2 lists, because each of them
 * arrives carrying a key that already exists: a retried create, a double tap, a
 * checkout return, and a replayed webhook — the last through the processor
 * reference's own partial unique index rather than the caller's key, since a
 * processor has no idea what key Homiio used.
 *
 * ## The amount and the currency come from the OBLIGATION and the LEASE
 *
 * Never from a request body. A caller naming their own amount is the shape
 * `AGENTS.md` forbids for ownership, and it is worse here: it is a caller
 * naming how much they paid. The declared amount is checked against what is
 * actually outstanding, and the currency is read from the lease.
 *
 * ## Nothing here mutates a settled movement
 *
 * A refund is a new row pointing at what it reverses. Confirming a declaration
 * is the only state change this module performs, it moves `pending` →
 * `succeeded` only, and it is guarded by the same conditional update the
 * transitions elsewhere use — so two landlords confirming at once produce one
 * confirmation.
 */

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  leaseObligationSettlement,
  type LeaseMovementDirection,
  type LeaseMovementState,
  type LeasePaymentKind,
  type LeasePaymentMovement,
  type PaymentCurrency,
} from '@homiio/shared-types';

import type { DatabaseOrTransaction } from '../postgres';
import { leasePaymentMovements, leasePaymentSchedule, leases } from '../schema';

export type MovementRow = typeof leasePaymentMovements.$inferSelect;
export type ObligationRow = typeof leasePaymentSchedule.$inferSelect;

/** Every movement on a lease, oldest first. */
export async function listMovements(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<readonly MovementRow[]> {
  return db
    .select()
    .from(leasePaymentMovements)
    .where(eq(leasePaymentMovements.leaseId, leaseId))
    .orderBy(asc(leasePaymentMovements.createdAt));
}

/** One obligation, scoped to its lease so an id from elsewhere resolves to nothing. */
export async function findObligation(
  db: DatabaseOrTransaction,
  leaseId: string,
  obligationId: string,
): Promise<ObligationRow | undefined> {
  const [row] = await db
    .select()
    .from(leasePaymentSchedule)
    .where(
      and(
        eq(leasePaymentSchedule.id, obligationId),
        eq(leasePaymentSchedule.leaseId, leaseId),
      ),
    )
    .limit(1);
  return row;
}

/** The lease's payment currency. The ONE place a movement's currency comes from. */
export async function leasePaymentCurrency(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<PaymentCurrency | undefined> {
  const [row] = await db
    .select({ currency: leases.rentDetailsCurrency })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  return row?.currency as PaymentCurrency | undefined;
}

export interface RecordMovementInput {
  readonly leaseId: string;
  readonly obligationId: string;
  readonly direction: LeaseMovementDirection;
  readonly kind: LeasePaymentKind;
  readonly state: LeaseMovementState;
  readonly amount: number;
  readonly currency: PaymentCurrency;
  readonly createdByOxyUserId: string;
  readonly idempotencyKey: string;
  readonly reversesMovementId?: string;
  readonly note?: string;
  readonly confirmedByOxyUserId?: string;
  readonly confirmedAt?: Date;
  readonly processorReference?: string;
  readonly failureReason?: string;
}

export interface RecordMovementOutcome {
  readonly movement: MovementRow;
  /**
   * The key already existed and this is the row it named.
   *
   * Reported rather than swallowed so a caller can answer 200 instead of 201 —
   * and so a test can tell "the second request was deduped" from "the second
   * request created a second row", which is the whole property.
   */
  readonly deduped: boolean;
}

/**
 * Record a movement, exactly once per idempotency key.
 *
 * The `do nothing` and the re-read are one round trip each and BOTH are
 * required: the insert decides, and the read is how the caller learns which row
 * won when it did not.
 */
export async function recordMovement(
  db: DatabaseOrTransaction,
  input: RecordMovementInput,
): Promise<RecordMovementOutcome> {
  const [inserted] = await db
    .insert(leasePaymentMovements)
    .values({
      leaseId: input.leaseId,
      obligationId: input.obligationId,
      direction: input.direction,
      kind: input.kind,
      state: input.state,
      amount: input.amount,
      currency: input.currency,
      createdByOxyUserId: input.createdByOxyUserId,
      idempotencyKey: input.idempotencyKey,
      ...(input.reversesMovementId ? { reversesMovementId: input.reversesMovementId } : {}),
      ...(input.note ? { note: input.note } : {}),
      ...(input.confirmedByOxyUserId
        ? { confirmedByOxyUserId: input.confirmedByOxyUserId }
        : {}),
      ...(input.confirmedAt ? { confirmedAt: input.confirmedAt } : {}),
      ...(input.processorReference ? { processorReference: input.processorReference } : {}),
      ...(input.failureReason ? { failureReason: input.failureReason } : {}),
    })
    .onConflictDoNothing({
      target: [leasePaymentMovements.leaseId, leasePaymentMovements.idempotencyKey],
    })
    .returning();

  if (inserted) return { movement: inserted, deduped: false };

  const [existing] = await db
    .select()
    .from(leasePaymentMovements)
    .where(
      and(
        eq(leasePaymentMovements.leaseId, input.leaseId),
        eq(leasePaymentMovements.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  // Unreachable: the insert only declines on THIS conflict target, so the row
  // exists. Throwing rather than returning something invented keeps an
  // impossible state from becoming a confusing 200.
  if (!existing) {
    throw new Error('A movement conflicted on its idempotency key but could not be re-read.');
  }
  return { movement: existing, deduped: true };
}

export type ConfirmOutcome =
  | { readonly ok: true; readonly movement: MovementRow; readonly alreadyConfirmed: boolean }
  | { readonly ok: false; readonly reason: 'not_found' | 'not_pending' };

/**
 * Confirm a pending declaration.
 *
 * The state check is in the WHERE clause, not above it. Two landlords pressing
 * "confirm" at the same moment both read `pending`; with the check in the
 * predicate only one update matches, and the other is told the truth rather
 * than writing a second confirmation over the first.
 *
 * Confirming something already confirmed is reported as `alreadyConfirmed`
 * rather than refused: the person's intent has been satisfied, and a 409 for
 * "it is already how you wanted it" is a worse answer than a 200.
 */
export async function confirmMovement(
  db: DatabaseOrTransaction,
  input: {
    readonly leaseId: string;
    readonly movementId: string;
    readonly confirmedByOxyUserId: string;
  },
): Promise<ConfirmOutcome> {
  const [updated] = await db
    .update(leasePaymentMovements)
    .set({
      state: 'succeeded',
      confirmedByOxyUserId: input.confirmedByOxyUserId,
      confirmedAt: new Date(),
    })
    .where(
      and(
        eq(leasePaymentMovements.id, input.movementId),
        eq(leasePaymentMovements.leaseId, input.leaseId),
        eq(leasePaymentMovements.state, 'pending'),
      ),
    )
    .returning();
  if (updated) return { ok: true, movement: updated, alreadyConfirmed: false };

  const [existing] = await db
    .select()
    .from(leasePaymentMovements)
    .where(
      and(
        eq(leasePaymentMovements.id, input.movementId),
        eq(leasePaymentMovements.leaseId, input.leaseId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.state === 'succeeded') {
    return { ok: true, movement: existing, alreadyConfirmed: true };
  }
  return { ok: false, reason: 'not_pending' };
}

/** Reject a pending declaration, with a reason. Same conditional-update shape. */
export async function failMovement(
  db: DatabaseOrTransaction,
  input: {
    readonly leaseId: string;
    readonly movementId: string;
    readonly failureReason: string;
  },
): Promise<ConfirmOutcome> {
  const [updated] = await db
    .update(leasePaymentMovements)
    .set({ state: 'failed', failureReason: input.failureReason })
    .where(
      and(
        eq(leasePaymentMovements.id, input.movementId),
        eq(leasePaymentMovements.leaseId, input.leaseId),
        eq(leasePaymentMovements.state, 'pending'),
      ),
    )
    .returning();
  if (updated) return { ok: true, movement: updated, alreadyConfirmed: false };

  const [existing] = await db
    .select()
    .from(leasePaymentMovements)
    .where(
      and(
        eq(leasePaymentMovements.id, input.movementId),
        eq(leasePaymentMovements.leaseId, input.leaseId),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.state === 'failed') return { ok: true, movement: existing, alreadyConfirmed: true };
  return { ok: false, reason: 'not_pending' };
}

/** A movement on this lease, by id. */
export async function findMovement(
  db: DatabaseOrTransaction,
  leaseId: string,
  movementId: string,
): Promise<MovementRow | undefined> {
  const [row] = await db
    .select()
    .from(leasePaymentMovements)
    .where(
      and(
        eq(leasePaymentMovements.id, movementId),
        eq(leasePaymentMovements.leaseId, leaseId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * What is still outstanding on one obligation, computed from the ledger.
 *
 * The SHARED function does the arithmetic, so the server and the client answer
 * "how much is left?" identically. This only fetches its inputs.
 *
 * The obligation's own `status` column is deliberately not consulted: it holds
 * the landlord's lifecycle (`cancelled`, `overdue`) and nothing about money,
 * and reading it here would create a second answer that could disagree.
 */
export async function obligationSettlement(
  db: DatabaseOrTransaction,
  leaseId: string,
  obligation: ObligationRow,
): Promise<ReturnType<typeof leaseObligationSettlement>> {
  const movements = await db
    .select()
    .from(leasePaymentMovements)
    .where(
      and(
        eq(leasePaymentMovements.leaseId, leaseId),
        eq(leasePaymentMovements.obligationId, obligation.id),
      ),
    )
    .orderBy(desc(leasePaymentMovements.createdAt));

  return leaseObligationSettlement(
    obligation.id,
    obligation.amount,
    movements.map(toMovementDTO),
  );
}

/** A ledger row on the wire. No credential, no card detail — there are none. */
export function toMovementDTO(row: MovementRow): LeasePaymentMovement {
  return {
    id: row.id,
    leaseId: row.leaseId,
    obligationId: row.obligationId,
    direction: row.direction,
    kind: row.kind,
    state: row.state,
    amount: row.amount,
    currency: row.currency as PaymentCurrency,
    createdByOxyUserId: row.createdByOxyUserId,
    ...(row.confirmedByOxyUserId ? { confirmedByOxyUserId: row.confirmedByOxyUserId } : {}),
    ...(row.confirmedAt ? { confirmedAt: row.confirmedAt.toISOString() } : {}),
    ...(row.processorReference ? { processorReference: row.processorReference } : {}),
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    ...(row.reversesMovementId ? { reversesMovementId: row.reversesMovementId } : {}),
    ...(row.note ? { note: row.note } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * How much of an obligation has SETTLED, for a guard.
 *
 * Reads the same ledger, in SQL, so a concurrent declaration cannot slip past
 * an over-payment check computed from a stale read. `sum` over a filtered set
 * rather than in JavaScript, because the guard runs inside the transaction that
 * is about to insert.
 */
export async function settledAmountOf(
  db: DatabaseOrTransaction,
  leaseId: string,
  obligationId: string,
): Promise<number> {
  const [row] = await db
    .select({
      settled: sql<number>`coalesce(sum(
        case when ${leasePaymentMovements.direction} = 'refund'
          then -${leasePaymentMovements.amount}
          else ${leasePaymentMovements.amount}
        end
      ), 0)`,
    })
    .from(leasePaymentMovements)
    .where(
      and(
        eq(leasePaymentMovements.leaseId, leaseId),
        eq(leasePaymentMovements.obligationId, obligationId),
        eq(leasePaymentMovements.state, 'succeeded'),
      ),
    );
  return Number(row?.settled ?? 0);
}
