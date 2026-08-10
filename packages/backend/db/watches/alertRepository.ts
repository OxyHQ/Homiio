/**
 * `housing_alerts` — one row per (watch, rule, transition), and the ONE place
 * that row is written.
 *
 * ## Claiming, not inserting
 *
 * {@link claimAlert} is the whole dedupe. It runs `ON CONFLICT DO NOTHING
 * RETURNING *`: a first claim comes back with a row, a duplicate comes back
 * EMPTY, and no statement ever fails. That last property is the one that matters
 * most in Postgres and has no counterpart in the store this project came from —
 * a failed statement aborts the WHOLE transaction (`25P02`), so the familiar
 * "let the insert fail, then read the existing row back for a friendly response"
 * shape works on an autocommit connection and breaks the moment somebody wraps
 * the caller in a transaction. Declining to raise the error at all means there
 * is nothing to recover from, at either nesting level.
 *
 * `onConflictDoNothing()` is called with NO TARGET on purpose. Two unique
 * indexes guard this table and they answer different questions (see
 * `db/schema/watches.ts`); an arbiter naming one of them would let the other
 * raise. It also sidesteps the `42P10` trap that a partial-index target carries —
 * there is no arbiter to infer, so there is no predicate to forget.
 *
 * The cost is that a suppressed claim does not say WHICH index refused it. The
 * caller does not need to know: both answers mean "this person has already been
 * told about this, recently enough", which is one outcome with two reasons. The
 * distinction is recoverable from the returned prior row when anybody wants it.
 */

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import {
  findUnsafeAlertFields,
  type AlertChannel,
  type AlertExplanation,
  type AlertSuppressionReason,
  type HousingAlertRuleType,
} from '@homiio/shared-types';
import type { DatabaseOrTransaction } from '../postgres';
import { housingAlerts } from '../schema';
import type { HousingEventSubjectType } from './domainEventRepository';

export type HousingAlertRow = typeof housingAlerts.$inferSelect;

/**
 * An explanation carrying something a notification must not publish.
 *
 * A THROW rather than a redaction, because reaching this point means a producer
 * built a payload with a coordinate in it and quietly trimming the field would
 * leave the defect in place and the next variant unprotected. It carries FIELD
 * PATHS and never values — a violation is itself logged, and "rejected:
 * title=41.3851, 2.1734" logs exactly what the rejection prevented.
 */
export class UnsafeAlertExplanationError extends Error {
  constructor(readonly fields: readonly string[]) {
    super(`Alert explanation carries fields that must not be published: ${fields.join('; ')}`);
    this.name = 'UnsafeAlertExplanationError';
  }
}

export interface ClaimAlertInput {
  readonly watchId: string;
  readonly oxyUserId: string;
  readonly eventId: string | null;
  readonly ruleType: HousingAlertRuleType;
  readonly ruleVersion: number;
  readonly idempotencyKey: string;
  readonly subjectType: HousingEventSubjectType;
  readonly subjectId: string;
  /** The claimed cooldown window, or `null` for a rule with no cooldown. */
  readonly cooldownBucket: Date | null;
  readonly explanation: AlertExplanation;
}

export interface ClaimAlertResult {
  /** The row this claim produced, or the row that already held the ground. */
  readonly alert: HousingAlertRow | undefined;
  /** `false` when a unique index refused the claim — see the module header. */
  readonly created: boolean;
}

/**
 * The start of the cooldown window an alert falls in.
 *
 * `null` for a rule whose window is zero, which is NOT the same as a bucket of
 * zero length: the column is nullable and the unique index is `NULLS DISTINCT`,
 * so a NULL bucket means the cooldown index stops constraining the row at all.
 * A sentinel value would instead make every no-cooldown rule fire once per
 * subject and then never again.
 *
 * Buckets are aligned to the epoch rather than to the first alert, so two
 * workers computing a bucket for the same instant always agree — a window
 * measured from "the last alert I found" is a read-then-write and two matchers
 * would compute two different windows for one moment.
 */
export function cooldownBucketFor(cooldownHours: number, at: Date): Date | null {
  if (cooldownHours <= 0) return null;
  const windowMs = cooldownHours * 3_600_000;
  return new Date(Math.floor(at.getTime() / windowMs) * windowMs);
}

/**
 * Claim the right to tell somebody about one transition.
 *
 * @throws {UnsafeAlertExplanationError} When the explanation carries a
 *   coordinate-shaped field or value. Checked BEFORE the insert, so an unsafe
 *   payload never reaches storage — a stored one would be published by the next
 *   reader whatever this function decided.
 */
export async function claimAlert(
  db: DatabaseOrTransaction,
  input: ClaimAlertInput,
): Promise<ClaimAlertResult> {
  const unsafe = findUnsafeAlertFields(input.explanation);
  if (unsafe.length > 0) throw new UnsafeAlertExplanationError(unsafe);

  const [row] = await db
    .insert(housingAlerts)
    .values({
      watchId: input.watchId,
      oxyUserId: input.oxyUserId,
      eventId: input.eventId,
      ruleType: input.ruleType,
      ruleVersion: input.ruleVersion,
      idempotencyKey: input.idempotencyKey,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      cooldownBucket: input.cooldownBucket,
      explanation: input.explanation as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing()
    .returning();

  if (row) return { alert: row, created: true };

  // Empty RETURNING means a unique index refused the claim. Reading the prior
  // row is safe here precisely BECAUSE nothing failed: no statement raised, so
  // the transaction — if there is one — is still usable.
  const prior = await findAlertByIdempotencyKey(db, input.idempotencyKey);
  return { alert: prior, created: false };
}

export async function findAlertByIdempotencyKey(
  db: DatabaseOrTransaction,
  idempotencyKey: string,
): Promise<HousingAlertRow | undefined> {
  const [row] = await db
    .select()
    .from(housingAlerts)
    .where(eq(housingAlerts.idempotencyKey, idempotencyKey))
    .limit(1);
  return row;
}

/** Record that an alert reached the channels named. */
export async function markAlertDelivered(
  db: DatabaseOrTransaction,
  id: string,
  channels: readonly AlertChannel[],
  notificationId: string | null,
): Promise<HousingAlertRow | undefined> {
  const [row] = await db
    .update(housingAlerts)
    .set({
      deliveryState: 'delivered',
      deliveredChannels: [...channels],
      deliveredAt: new Date(),
      notificationId,
      suppressionReason: null,
    })
    .where(eq(housingAlerts.id, id))
    .returning();
  return row;
}

/** Record that an alert was matched and deliberately not delivered. */
export async function markAlertSuppressed(
  db: DatabaseOrTransaction,
  id: string,
  reason: AlertSuppressionReason,
): Promise<HousingAlertRow | undefined> {
  const [row] = await db
    .update(housingAlerts)
    .set({ deliveryState: 'suppressed', suppressionReason: reason })
    .where(eq(housingAlerts.id, id))
    .returning();
  return row;
}

/** Record that delivery was attempted and failed. Retried by the next sweep. */
export async function markAlertFailed(
  db: DatabaseOrTransaction,
  id: string,
): Promise<HousingAlertRow | undefined> {
  const [row] = await db
    .update(housingAlerts)
    .set({ deliveryState: 'failed', suppressionReason: null })
    .where(eq(housingAlerts.id, id))
    .returning();
  return row;
}

/**
 * How many alerts this watch has DELIVERED inside the window.
 *
 * The cap is on deliveries rather than on rows, and the distinction is the whole
 * design of the limit: a row is the audit trail, a delivery is a person's
 * attention, and only the second is a scarce resource worth rationing. A limit
 * on rows would additionally have to decide what to do with a matched event it
 * refused to record, which is how a rate limit turns into silent data loss.
 */
export async function countDeliveredSince(
  db: DatabaseOrTransaction,
  filter: { readonly watchId?: string; readonly oxyUserId?: string },
  since: Date,
): Promise<number> {
  const clauses = [
    eq(housingAlerts.deliveryState, 'delivered'),
    gte(housingAlerts.deliveredAt, since),
  ];
  if (filter.watchId !== undefined) clauses.push(eq(housingAlerts.watchId, filter.watchId));
  if (filter.oxyUserId !== undefined) clauses.push(eq(housingAlerts.oxyUserId, filter.oxyUserId));
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(housingAlerts)
    .where(and(...clauses));
  return row?.value ?? 0;
}

export interface ListAlertsFilter {
  readonly oxyUserId: string;
  readonly watchId?: string;
}

/**
 * One page of a person's alert history, newest first.
 *
 * Scoped by `oxy_user_id` in the PREDICATE, never checked afterwards — the same
 * rule the notification repository states, for the same reason: an authorisation
 * performed in a second statement is an IDOR the first time somebody forgets it.
 */
export async function listAlerts(
  db: DatabaseOrTransaction,
  filter: ListAlertsFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<{ readonly rows: readonly HousingAlertRow[]; readonly total: number }> {
  const clauses = [eq(housingAlerts.oxyUserId, filter.oxyUserId)];
  if (filter.watchId !== undefined) clauses.push(eq(housingAlerts.watchId, filter.watchId));
  const where = and(...clauses);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(housingAlerts)
      .where(where)
      .orderBy(desc(housingAlerts.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: sql<number>`count(*)::int` }).from(housingAlerts).where(where),
  ]);
  return { rows, total: totalRow?.value ?? 0 };
}

/** One alert, scoped to its owner — the "why did I get this?" read. */
export async function findAlertForOwner(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<HousingAlertRow | undefined> {
  const [row] = await db
    .select()
    .from(housingAlerts)
    .where(and(eq(housingAlerts.id, id), eq(housingAlerts.oxyUserId, oxyUserId)))
    .limit(1);
  return row;
}

/**
 * Alerts waiting to be sent, oldest first — the digest's work list.
 *
 * Ordered oldest-first so a digest reads as a narrative rather than as a stack,
 * and bounded so one very active watch cannot starve the rest of a run.
 */
export async function listPendingAlerts(
  db: DatabaseOrTransaction,
  limit: number,
): Promise<readonly HousingAlertRow[]> {
  return db
    .select()
    .from(housingAlerts)
    .where(eq(housingAlerts.deliveryState, 'pending'))
    .orderBy(housingAlerts.createdAt)
    .limit(limit);
}

/** The wire shape the alert-history screen reads. */
export function toHousingAlertDTO(row: HousingAlertRow): Record<string, unknown> {
  return {
    id: row.id,
    watchId: row.watchId,
    eventId: row.eventId,
    ruleType: row.ruleType,
    ruleVersion: row.ruleVersion,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    /** The safe explanation, as published. Never re-derived from current rules. */
    explanation: row.explanation,
    deliveryState: row.deliveryState,
    suppressionReason: row.suppressionReason,
    deliveredChannels: row.deliveredChannels,
    deliveredAt: row.deliveredAt,
    notificationId: row.notificationId,
    createdAt: row.createdAt,
  };
}
