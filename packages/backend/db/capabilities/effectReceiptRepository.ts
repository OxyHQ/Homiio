/**
 * The `capability_effect_receipts` repository: claim, complete, release.
 *
 * The claim is ONE `INSERT … ON CONFLICT DO NOTHING`, never a read followed by
 * a write: the unique index on (account, tool, key hash) is what decides which
 * of two concurrent calls with the same key runs the effect. The loser reads
 * the winner's row and gets one of three answers — a completed receipt to
 * replay, a claim still in flight, or a key that was used with other input.
 *
 * A receipt past its `expires_at` that the sweep has not reaped yet is treated
 * as absent: it is deleted and the claim retried once, so a key reused after
 * the retention window behaves the same whether or not the sweep has run.
 */

import { and, eq, lte } from 'drizzle-orm';

import { getDb, type DatabaseOrTransaction } from '../postgres';
import { capabilityEffectReceipts } from '../schema';

export type ReceiptClaim =
  | { readonly kind: 'claimed'; readonly id: string }
  | { readonly kind: 'replay'; readonly result: Record<string, unknown> }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'input_mismatch' };

export interface ReceiptKey {
  readonly oxyUserId: string;
  readonly tool: string;
  readonly idempotencyKeyHash: string;
}

export async function claimEffectReceipt(
  key: ReceiptKey & { readonly inputDigest: string; readonly expiresAt: Date },
  db: DatabaseOrTransaction = getDb(),
): Promise<ReceiptClaim> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [claimed] = await db
      .insert(capabilityEffectReceipts)
      .values({
        oxyUserId: key.oxyUserId,
        tool: key.tool,
        idempotencyKeyHash: key.idempotencyKeyHash,
        inputDigest: key.inputDigest,
        expiresAt: key.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: capabilityEffectReceipts.id });
    if (claimed) return { kind: 'claimed', id: claimed.id };

    const [existing] = await db
      .select()
      .from(capabilityEffectReceipts)
      .where(
        and(
          eq(capabilityEffectReceipts.oxyUserId, key.oxyUserId),
          eq(capabilityEffectReceipts.tool, key.tool),
          eq(capabilityEffectReceipts.idempotencyKeyHash, key.idempotencyKeyHash),
        ),
      )
      .limit(1);
    // Released between our insert and this read: claim again.
    if (!existing) continue;
    if (existing.expiresAt.getTime() <= Date.now()) {
      await db
        .delete(capabilityEffectReceipts)
        .where(
          and(
            eq(capabilityEffectReceipts.id, existing.id),
            lte(capabilityEffectReceipts.expiresAt, new Date()),
          ),
        );
      continue;
    }
    if (existing.inputDigest !== key.inputDigest) return { kind: 'input_mismatch' };
    if (existing.status === 'completed' && existing.result !== null) {
      return { kind: 'replay', result: existing.result as Record<string, unknown> };
    }
    return { kind: 'in_progress' };
  }
  return { kind: 'in_progress' };
}

/** Record the effect's result on a claim this process holds. */
export async function completeEffectReceipt(
  id: string,
  result: Record<string, unknown>,
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .update(capabilityEffectReceipts)
    .set({ status: 'completed', result, completedAt: new Date() })
    .where(
      and(eq(capabilityEffectReceipts.id, id), eq(capabilityEffectReceipts.status, 'pending')),
    );
}

/** Drop a claim whose effect failed, so an honest retry can run it. */
export async function releaseEffectReceipt(
  id: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .delete(capabilityEffectReceipts)
    .where(
      and(eq(capabilityEffectReceipts.id, id), eq(capabilityEffectReceipts.status, 'pending')),
    );
}
