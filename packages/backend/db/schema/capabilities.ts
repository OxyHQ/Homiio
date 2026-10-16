/**
 * `capability_effect_receipts` — the durable answer to "did this tool call
 * already happen?".
 *
 * A capability tool with an effect (`idempotency: 'supported' | 'required'`)
 * may be retried by its coordinator with the same `Idempotency-Key`: a network
 * error after the effect committed, a turn replayed after a crash. The second
 * call must return what the first one did, not do it again — a second viewing
 * request, a second rent declaration, a second spent file credit.
 *
 * One row per (account, tool, key). The row is CLAIMED as `pending` before the
 * effect runs, so two concurrent calls with the same key cannot both execute:
 * the loser of the unique index sees the winner's row. It becomes `completed`
 * with the tool's result once the effect commits, and a failed effect deletes
 * its claim so an honest retry can run. The key itself is never stored, only
 * its SHA-256, and the input's digest is kept so a key reused with DIFFERENT
 * input is refused instead of replaying an unrelated answer.
 *
 * `result` is `jsonb` because it is a tool's response, whose shape is the
 * tool's contract and not this table's to decide (CONVENTIONS.md, "Arrays and
 * objects"). It is exactly what the caller already received.
 *
 * Rows expire after 30 days through `db/expiry.ts`: a retry is a matter of
 * seconds to hours, and a receipt kept forever would be every agent action's
 * response stored for no reader.
 */

import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, generatedId, inList, timestamptz } from '@oxy.so/db';

export const CAPABILITY_EFFECT_RECEIPT_STATUSES = ['pending', 'completed'] as const;

/** How long a receipt answers a retry. */
export const CAPABILITY_EFFECT_RECEIPT_RETENTION_DAYS = 30;

export const capabilityEffectReceipts = pgTable(
  'capability_effect_receipts',
  {
    id: generatedId(),

    /** The effective account the tool acted as (an Oxy account id). */
    oxyUserId: text().notNull(),

    /** The catalogue tool name. */
    tool: text().notNull(),

    /** SHA-256 (hex) of the caller's idempotency key. The key is never stored. */
    idempotencyKeyHash: text().notNull(),

    /** SHA-256 (hex) of the canonical input, to refuse a key reused with new input. */
    inputDigest: text().notNull(),

    status: text({ enum: CAPABILITY_EFFECT_RECEIPT_STATUSES }).notNull().default('pending'),

    /** The tool's structured result, once `completed`. */
    result: jsonb(),

    createdAt: createdAt(),
    completedAt: timestamptz(),

    /** When this receipt stops answering retries; swept by `db/expiry.ts`. */
    expiresAt: timestamptz().notNull(),
  },
  (table) => [
    uniqueIndex('capability_effect_receipts_key_unique').on(
      table.oxyUserId,
      table.tool,
      table.idempotencyKeyHash,
    ),
    index('capability_effect_receipts_expires_at_idx').on(table.expiresAt),
    check(
      'capability_effect_receipts_status_check',
      sql`${table.status} in (${sql.raw(inList(CAPABILITY_EFFECT_RECEIPT_STATUSES))})`,
    ),
    check(
      'capability_effect_receipts_completed_check',
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null and ${table.result} is not null)`,
    ),
  ],
);
