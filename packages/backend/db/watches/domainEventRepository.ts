/**
 * `housing_domain_events` — the FACTS, kept apart from the alerts about them.
 *
 * The issue asks for four separable stages, and this module owns the first. The
 * separation is not architectural taste: without a durable fact with a stable
 * id, the only way to answer "has anything changed?" is to re-run every user's
 * saved query and diff the responses in memory — which the issue rules out by
 * name, and which cannot be made idempotent because a response is not a
 * transition.
 *
 * ## This is the SEAM other domains produce through
 *
 * {@link recordHousingDomainEvent} is the whole public surface of the producer
 * side. Anything that changes the housing world calls it and knows nothing about
 * watches, matching, cooldowns or notifications. The eviction domain (#358) is
 * the intended second caller: it records an `eviction_nearby` event at the
 * APPROXIMATE point it already publishes and nothing else changes here.
 *
 * ## The transition must be OBSERVATION-INDEPENDENT
 *
 * `transition` is hashed into the alert's idempotency key, so it must hold
 * everything that distinguishes one change from another and NOTHING that varies
 * between two observations of the SAME change. A timestamp, a job id or a run
 * counter in there would make every re-ingest a fresh transition and would
 * retire the dedupe silently — a bug whose only symptom is that people are told
 * the same thing repeatedly, which reads as a product decision rather than a
 * defect. {@link canonicalTransitionKey} is what pins that down.
 */

import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { HousingAlertRuleType } from '@homiio/shared-types';
import type { DatabaseOrTransaction } from '../postgres';
import { housingDomainEvents } from '../schema';
import type { HOUSING_EVENT_SUBJECT_TYPES } from '../schema/watches';

export type HousingDomainEventRow = typeof housingDomainEvents.$inferSelect;
export type HousingEventSubjectType = (typeof HOUSING_EVENT_SUBJECT_TYPES)[number];

/**
 * How long a fact is kept after it happened.
 *
 * Long enough to answer "why did I get this?" against the event as well as
 * against the alert's own stored explanation, and short enough that the table is
 * bounded by time rather than by the size of the catalogue. The alert survives
 * the sweep — `housing_alerts.event_id` is `SET NULL` — so this is a retention
 * decision about EVIDENCE, not about history.
 */
export const DOMAIN_EVENT_RETENTION_DAYS = 90;

export interface RecordDomainEventInput {
  readonly type: HousingAlertRuleType;
  readonly subjectType: HousingEventSubjectType;
  readonly subjectId: string;
  /** Before/after values only. See the module header. */
  readonly transition: Record<string, unknown>;
  /** The subject's own coordinates, or absent for a fact with no place. */
  readonly longitude?: number | null;
  readonly latitude?: number | null;
  /** True for a bulk indexing run. The matcher refuses these outright. */
  readonly isBackfill?: boolean;
  readonly occurredAt?: Date;
}

/**
 * Record one domain fact.
 *
 * Deliberately NOT idempotent, and that is the right call rather than an
 * omission. Two identical events are cheap (a row) and harmless (both produce
 * the same idempotency key, so the alert converges); a unique index here would
 * instead have to decide what "the same fact twice" means, and would be wrong in
 * the expensive direction the first time a listing genuinely returned to a price
 * it had held before. Idempotency belongs at the DELIVERY boundary, where the
 * consequence of getting it wrong is a person's attention.
 */
export async function recordHousingDomainEvent(
  db: DatabaseOrTransaction,
  input: RecordDomainEventInput,
): Promise<HousingDomainEventRow> {
  const occurredAt = input.occurredAt ?? new Date();
  const [row] = await db
    .insert(housingDomainEvents)
    .values({
      type: input.type,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      transition: input.transition,
      // A coordinate is a PAIR or it is absent — the CHECK says so, and
      // normalising here means a producer with only one of the two gets a stored
      // event with no place rather than a `23514` it cannot act on.
      longitude:
        input.longitude === undefined || input.longitude === null || input.latitude == null
          ? null
          : input.longitude,
      latitude:
        input.latitude === undefined || input.latitude === null || input.longitude == null
          ? null
          : input.latitude,
      isBackfill: input.isBackfill ?? false,
      occurredAt,
      expiresAt: new Date(occurredAt.getTime() + DOMAIN_EVENT_RETENTION_DAYS * 86_400_000),
    })
    .returning();
  return row;
}

/**
 * A stable string for a transition, independent of key order.
 *
 * `JSON.stringify` preserves INSERTION order, so two producers building the same
 * `{ from, to }` in different orders would hash differently and the same change
 * would be announced twice. Sorting the keys is what makes the hash a property
 * of the VALUES. Nested objects are sorted too, because a transition may carry a
 * `terms` object.
 */
export function canonicalTransitionKey(transition: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, canonical(child)]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(transition));
}

/**
 * The idempotency key for one (watch, rule, subject, transition).
 *
 * A hash rather than a concatenation, because the parts are user- and
 * portal-supplied and a separator can appear inside any of them — two different
 * tuples that happen to concatenate to one string would then silently share a
 * key, and the second alert would never be delivered.
 *
 * `ruleVersion` is deliberately ABSENT. Bumping the rule version must NOT
 * re-notify a transition somebody has already been told about: the version
 * records how an alert was decided, not which transition it was about, and
 * folding it in would turn every rules change into a re-announcement of the
 * whole retention window.
 */
export function alertIdempotencyKey(parts: {
  readonly watchId: string;
  readonly ruleType: HousingAlertRuleType;
  readonly subjectType: HousingEventSubjectType;
  readonly subjectId: string;
  readonly transition: unknown;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        parts.watchId,
        parts.ruleType,
        parts.subjectType,
        parts.subjectId,
        canonicalTransitionKey(parts.transition),
      ]),
    )
    .digest('hex');
}

/**
 * Claim a batch of unprocessed events for this worker.
 *
 * `FOR UPDATE SKIP LOCKED` so two tasks running the sweep take DIFFERENT rows
 * rather than both taking the same ones and racing. The claim is a cost control
 * and not the dedupe — that is `housing_alerts`' unique index, which holds
 * whatever happens here — so a claim lost to a crash is harmless: the event is
 * picked up again and every alert it would have produced converges on the row
 * that already exists.
 */
export async function claimUnprocessedEvents(
  db: DatabaseOrTransaction,
  limit: number,
  now: Date = new Date(),
): Promise<readonly HousingDomainEventRow[]> {
  const claimed = await db
    .select({ id: housingDomainEvents.id })
    .from(housingDomainEvents)
    .where(
      and(isNull(housingDomainEvents.processedAt), lte(housingDomainEvents.occurredAt, now)),
    )
    .orderBy(asc(housingDomainEvents.occurredAt))
    .limit(limit)
    .for('update', { skipLocked: true });

  if (claimed.length === 0) return [];

  return db
    .update(housingDomainEvents)
    .set({ processedAt: now })
    .where(
      inArray(
        housingDomainEvents.id,
        claimed.map((row) => row.id),
      ),
    )
    .returning();
}

/** One event by id, for the "why did I get this?" answer. */
export async function findDomainEvent(
  db: DatabaseOrTransaction,
  id: string,
): Promise<HousingDomainEventRow | undefined> {
  const [row] = await db
    .select()
    .from(housingDomainEvents)
    .where(eq(housingDomainEvents.id, id))
    .limit(1);
  return row;
}

/**
 * How many events are still queued.
 *
 * Exposed for the sweep's log line, which reports on every run including the
 * empty ones — an unwired sweep and a quiet market are otherwise the same
 * silence, and only one of them is a problem.
 */
export async function countUnprocessedEvents(db: DatabaseOrTransaction): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(housingDomainEvents)
    .where(isNull(housingDomainEvents.processedAt));
  return row?.value ?? 0;
}
