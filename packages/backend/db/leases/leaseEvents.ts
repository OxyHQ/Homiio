/**
 * The tenancy timeline's write and read path (#518 §7.4, #519 §7.4).
 *
 * One function appends, one reads a lease's entries in order. Everything that
 * makes an event trustworthy is in the schema (`db/schema/leases.ts`): the
 * position is computed in SQL, a concurrent append collides on a unique index
 * rather than duplicating, and an `UPDATE` is refused by a trigger.
 *
 * ## Appending is best-effort at the CALL SITE, never here
 *
 * A timeline entry is a record OF a domain action, so it must not be able to
 * undo one. Every caller that can append inside the action's own transaction
 * does — a signature and its `signed` entry commit together or not at all —
 * and the callers that cannot (a document upload, whose object is already in
 * the bucket) swallow a failure the way `notificationDispatchService` does, and
 * for the same reason: the tenancy action has to succeed even if the record of
 * it does not.
 *
 * Which is why this module does NOT swallow. A helper that hid its own failures
 * would take that decision away from the one place that can make it correctly.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';
import { LEASE_EVENT_TYPES, leaseEvents } from '../schema/leases';

/** An event type the CHECK accepts. */
export type LeaseEventType = (typeof LEASE_EVENT_TYPES)[number];

export type LeaseEventRow = typeof leaseEvents.$inferSelect;

export interface AppendLeaseEventInput {
  readonly leaseId: string;
  readonly eventType: LeaseEventType;
  /** NULL for a system event. `activated` is the one that has no actor. */
  readonly actorOxyUserId?: string | null;
  /** The document's name, the termination's reason. Never a translated phrase. */
  readonly detail?: string | null;
}

/**
 * Append one entry to a lease's timeline.
 *
 * `position` is `coalesce(max(position), 0) + 1` evaluated by POSTGRES inside
 * this statement. Reading the maximum into JavaScript and adding one there is
 * the `bigint`-decodes-as-string trap `db/schema/leases.ts` records: postgres.js
 * hands `int8` back as a STRING, `max + 1` type-checks clean, and the second
 * entry lands at position `11`. A test that appends once cannot see it, which is
 * why `leaseSignatureBinding.test.ts` appends several and reads the positions
 * back as numbers.
 *
 * Two concurrent appends can both read the same maximum; the unique index on
 * `(lease_id, position)` turns the loser into a `23505` rather than a second
 * entry at the same place. That is deliberate: the callers that matter append
 * inside a transaction that is already serialized on the lease row.
 */
export async function appendLeaseEvent(
  db: DatabaseOrTransaction,
  input: AppendLeaseEventInput,
): Promise<LeaseEventRow> {
  const [row] = await db
    .insert(leaseEvents)
    .values({
      leaseId: input.leaseId,
      eventType: input.eventType,
      actorOxyUserId: input.actorOxyUserId ?? null,
      detail: input.detail ?? null,
      position: sql<number>`(
        select coalesce(max(${leaseEvents.position}), 0) + 1
        from ${leaseEvents}
        where ${leaseEvents.leaseId} = ${input.leaseId}
      )`,
    })
    .returning();
  return row;
}

/** A lease's timeline, oldest first — the order it is drawn in. */
export async function listLeaseEvents(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<readonly LeaseEventRow[]> {
  return db
    .select()
    .from(leaseEvents)
    .where(eq(leaseEvents.leaseId, leaseId))
    .orderBy(asc(leaseEvents.position));
}

/**
 * The timelines of several leases at once, keyed by lease.
 *
 * Used by the hydration path so a page of leases costs one query rather than
 * one per lease.
 */
export async function listLeaseEventsByLease(
  db: DatabaseOrTransaction,
  leaseIds: readonly string[],
): Promise<Map<string, LeaseEventRow[]>> {
  const grouped = new Map<string, LeaseEventRow[]>();
  if (leaseIds.length === 0) return grouped;
  const rows = await db
    .select()
    .from(leaseEvents)
    .where(inArray(leaseEvents.leaseId, [...leaseIds]))
    .orderBy(asc(leaseEvents.leaseId), asc(leaseEvents.position));
  for (const row of rows) {
    const existing = grouped.get(row.leaseId);
    if (existing) existing.push(row);
    else grouped.set(row.leaseId, [row]);
  }
  return grouped;
}

/**
 * Whether a lease already carries an entry of this type.
 *
 * The idempotence `renewLease` and the document path need: a timeline is read
 * by a human, and the same thing recorded twice reads as it having happened
 * twice.
 */
export async function hasLeaseEvent(
  db: DatabaseOrTransaction,
  leaseId: string,
  eventType: LeaseEventType,
): Promise<boolean> {
  const [row] = await db
    .select({ id: leaseEvents.id })
    .from(leaseEvents)
    .where(and(eq(leaseEvents.leaseId, leaseId), eq(leaseEvents.eventType, eventType)))
    .limit(1);
  return row !== undefined;
}
