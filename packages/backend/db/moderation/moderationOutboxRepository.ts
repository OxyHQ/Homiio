/**
 * `moderation_outbox` — the durable promise that moderation work will happen.
 *
 * The at-least-once contract is unchanged from the Mongo original: an expired
 * lease is reclaimable and a worker can die mid-delivery, so every handler MUST
 * make its downstream effect idempotent using the event id.
 *
 * ## The claim is `FOR UPDATE SKIP LOCKED`, not a `findOneAndUpdate`
 *
 * Mongo claimed with an atomic `findOneAndUpdate` over a disjunctive filter.
 * Postgres has a better primitive for exactly this shape: the `SELECT … ORDER BY
 * created_at LIMIT 1 FOR UPDATE SKIP LOCKED` lives INSIDE the `UPDATE`, so N
 * dispatchers draining the queue never hand each other the same row and never
 * block on one another either — `SKIP LOCKED` steps over a row another task is
 * already claiming instead of waiting for it. Homiio runs an API task and a
 * worker task against one database and every one of them starts a dispatcher, so
 * that is the normal case rather than an edge one.
 *
 * `lease_until` is nullable and `NULL <= now` is NULL, so a row that has never
 * been leased is excluded from the reclaim branch by the comparison itself —
 * matching Mongo, where a missing field did not match `{$lte: now}` either.
 *
 * ## The Mongo `timestamps: false` hazard has no counterpart here, and that is the point
 *
 * The Mongo enqueue carried a long comment about writing `createdAt`/`updatedAt`
 * explicitly under `timestamps: false`, because Mongoose otherwise named
 * `updatedAt` in two operators of one update document and the server rejected
 * the WHOLE write — which, inside the intake transaction, took the report with
 * it. The fix it settled on was not interchangeable with the obvious one:
 * letting Mongoose own the timestamps also cleared the server error but left a
 * `$set: { updatedAt }` on the upsert, turning a repeated enqueue into a real
 * write that contends with the dispatcher's live lease on that same row.
 *
 * `ON CONFLICT (id) DO NOTHING` writes nothing at all — no tuple version, no
 * timestamp, no lock — so a repeat is a genuine no-op for a STRUCTURAL reason
 * rather than by matching a spelling. `DO UPDATE` would reintroduce precisely
 * the bug the Mongo flag existed to fix, and measurably so: drizzle applies a
 * column's `$onUpdate` to a conflict branch's `set`, so "write the same data
 * back" is not even a quiet write. `__tests__/db/moderationWrites.test.ts`
 * asserts both `updated_at` and the row's `xmin`; the `xmin` assertion is what
 * would still catch a `DO UPDATE` careful enough to leave every column alone.
 *
 * ## The payload is FLATTENED, except the half that is genuinely opaque
 *
 * Mongo stored one `payload` sub-document. `db/schema/moderation.ts` splits it
 * into `report_id`, `event_id`, `case_id` and a `decision` jsonb, because the
 * first three have a closed shape and the decision does not. {@link toEvent}
 * reassembles the `ModerationOutboxPayload` the workers already read, so the
 * column split stays inside this module.
 */

import { and, asc, eq, gt, lte, or, sql } from 'drizzle-orm';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { MODERATION_OUTBOX_KINDS, moderationOutbox } from '../schema/moderation';
import { requireTransaction } from './transactionGuard';

/** What kind of work an event represents. */
export type ModerationOutboxKind = (typeof MODERATION_OUTBOX_KINDS)[number];

/**
 * Retention ceiling, so a stalled dispatcher cannot turn the outbox into an
 * unbounded table. Ninety days because a moderation case can legitimately sit
 * open for weeks and a `dead_letter` row is evidence somebody still has to look
 * at. Any operational alert must fire long before this deadline.
 *
 * The sweep that enforces it is registered in `db/expiry.ts`.
 */
export const MODERATION_OUTBOX_RETENTION_SECONDS = 90 * 24 * 60 * 60;

/**
 * The job payload, keyed by `kind`.
 *
 * A flat optional shape rather than a discriminated union, matching what the
 * workers read: each already knows its own `kind` from the row it claimed, and a
 * union would force a narrowing step at every call site that adds nothing.
 */
export interface ModerationOutboxPayload {
  /** `report.submit` — the local `moderation_reports.id`. */
  reportId?: string;
  /** `decision.apply` — the inbound webhook event id. */
  eventId?: string;
  /** `decision.apply` — the CrowdSource case a decision belongs to. */
  caseId?: string;
  /**
   * The decision exactly as CrowdSource published it.
   *
   * Opaque on purpose: the decision document is deliberately loose so a newer
   * server does not break an older client, and a projection into columns would
   * silently drop whatever a newer CrowdSource added — including a finding the
   * enforcement mapping may later need. Validated against the published contract
   * when it is READ, not when it is stored.
   */
  decision?: unknown;
}

/** One claimed event, in the shape the dispatcher and the workers consume. */
export interface ModerationOutboxEvent {
  id: string;
  kind: ModerationOutboxKind;
  payload: ModerationOutboxPayload;
  attempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseUntil?: Date;
  expiresAt: Date;
  createdAt: Date;
}

type OutboxRow = typeof moderationOutbox.$inferSelect;

/**
 * Reassemble the payload, and normalise absent optionals to `undefined`.
 *
 * A field Mongo left ABSENT is `NULL` in Postgres, and every caller here was
 * written against `undefined` — so the normalization happens once, at the edge
 * of the repository, rather than at each `if (event.leaseOwner)`.
 */
function toEvent(row: OutboxRow): ModerationOutboxEvent {
  return {
    id: row.id,
    kind: row.kind,
    payload: {
      ...(row.reportId === null ? {} : { reportId: row.reportId }),
      ...(row.eventId === null ? {} : { eventId: row.eventId }),
      ...(row.caseId === null ? {} : { caseId: row.caseId }),
      ...(row.decision === null ? {} : { decision: row.decision }),
    },
    attempts: row.attempts,
    availableAt: row.availableAt,
    ...(row.leaseOwner === null ? {} : { leaseOwner: row.leaseOwner }),
    ...(row.leaseUntil === null ? {} : { leaseUntil: row.leaseUntil }),
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Write the event with the CALLER's transaction.
 *
 * The transaction is required, not optional — this is the whole point of the
 * table: the domain write and this row commit together or not at all. See
 * `transactionGuard.ts` for why the TYPE alone cannot express that, and what a
 * caller passing `getDb()` would otherwise get away with. This function
 * deliberately does NOT default its `db` parameter, unlike every other
 * repository here, because the default is the mistake.
 *
 * It is also the ONLY writer of this table — the dispatcher claims existing rows
 * and never creates one — so no second queue can drift out of sync with the
 * outbox: the row IS the job.
 *
 * @returns The event id, so a caller can record what it queued.
 */
export async function enqueueModerationOutboxEvent(
  input: {
    eventId: string;
    kind: ModerationOutboxKind;
    payload: ModerationOutboxPayload;
  },
  db: DatabaseOrTransaction,
): Promise<string> {
  // The event id rides in the operation label so the refusal names WHICH enqueue
  // was misrouted. It is a programming error rather than a runtime condition, and
  // a message that only says "some enqueue" sends whoever hits it hunting.
  const tx = requireTransaction(db, `enqueueModerationOutboxEvent(${input.eventId})`);
  const now = new Date();

  await tx
    .insert(moderationOutbox)
    .values({
      id: input.eventId,
      kind: input.kind,
      reportId: input.payload.reportId ?? null,
      eventId: input.payload.eventId ?? null,
      caseId: input.payload.caseId ?? null,
      decision: input.payload.decision ?? null,
      status: 'pending',
      attempts: 0,
      availableAt: now,
      expiresAt: new Date(now.getTime() + MODERATION_OUTBOX_RETENTION_SECONDS * 1_000),
    })
    // NEVER `onConflictDoUpdate`. See the module docblock: a repeat has to be a
    // genuine no-op, and a repeat is ordinary — a transaction retry, two
    // concurrent duplicate submissions, a reconciliation sweep re-deriving this
    // deterministic id — running while the dispatcher holds a lease on this row.
    .onConflictDoNothing({ target: moderationOutbox.id });

  return input.eventId;
}

/**
 * Atomically claim one due event.
 *
 * An expired `processing` lease is reclaimable, so a dead task cannot strand
 * moderation work forever. `SKIP LOCKED` is what lets several dispatchers drain
 * the queue concurrently without handing each other the same row.
 */
export async function claimModerationOutboxEvent(
  options: {
    leaseOwner: string;
    eventId?: string;
    now?: Date;
    leaseMs?: number;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationOutboxEvent | null> {
  const now = options.now ?? new Date();
  const leaseMs = Math.max(1_000, options.leaseMs ?? 60_000);

  const due = and(
    options.eventId ? eq(moderationOutbox.id, options.eventId) : undefined,
    or(
      and(eq(moderationOutbox.status, 'pending'), lte(moderationOutbox.availableAt, now)),
      and(eq(moderationOutbox.status, 'processing'), lte(moderationOutbox.leaseUntil, now)),
    ),
  );

  const claimed = await db
    .update(moderationOutbox)
    .set({
      status: 'processing',
      leaseOwner: options.leaseOwner,
      leaseUntil: new Date(now.getTime() + leaseMs),
      attempts: sql`${moderationOutbox.attempts} + 1`,
      lastError: null,
    })
    // Both references name the SAME table, so the subquery's own range entry
    // shadows the outer one inside it — which is exactly what is wanted here.
    .where(
      sql`${moderationOutbox.id} = (
        select ${moderationOutbox.id} from ${moderationOutbox}
        where ${due}
        order by ${asc(moderationOutbox.createdAt)}
        limit 1
        for update skip locked
      )`,
    )
    .returning();

  return claimed[0] ? toEvent(claimed[0]) : null;
}

/**
 * Only the lease this dispatcher currently owns matches.
 *
 * Every terminal transition carries it, so a dispatcher whose lease expired and
 * was reclaimed by another task cannot complete, renew or fail work that is no
 * longer its own — which is what stops two tasks writing contradictory outcomes
 * for one row.
 */
function ownedLease(eventId: string, leaseOwner: string, now: Date) {
  return and(
    eq(moderationOutbox.id, eventId),
    eq(moderationOutbox.status, 'processing'),
    eq(moderationOutbox.leaseOwner, leaseOwner),
    gt(moderationOutbox.leaseUntil, now),
  );
}

/** Complete only the lease this dispatcher currently owns. */
export async function completeModerationOutboxEvent(
  eventId: string,
  leaseOwner: string,
  now: Date = new Date(),
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const completed = await db
    .update(moderationOutbox)
    .set({
      status: 'processed',
      processedAt: now,
      leaseOwner: null,
      leaseUntil: null,
      lastError: null,
    })
    .where(ownedLease(eventId, leaseOwner, now))
    .returning({ id: moderationOutbox.id });
  return completed.length === 1;
}

/** Extend only a live lease still owned by this dispatcher. */
export async function renewModerationOutboxEvent(
  eventId: string,
  leaseOwner: string,
  leaseMs: number,
  now: Date = new Date(),
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const renewed = await db
    .update(moderationOutbox)
    .set({ leaseUntil: new Date(now.getTime() + Math.max(1_000, leaseMs)) })
    .where(ownedLease(eventId, leaseOwner, now))
    .returning({ id: moderationOutbox.id });
  return renewed.length === 1;
}

/** Bound on a stored dispatch error. Never carries reported material. */
const MAX_LAST_ERROR_LENGTH = 2_000;

/**
 * Release a failed claim, with backoff — or stop.
 *
 * `deadLettered` is the CALLER's decision: only the service knows whether the
 * error was retryable and how many attempts have been spent. This writes it.
 */
export async function releaseModerationOutboxEvent(
  options: {
    eventId: string;
    leaseOwner: string;
    deadLettered: boolean;
    availableAt: Date;
    error: string;
    now?: Date;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const now = options.now ?? new Date();
  const released = await db
    .update(moderationOutbox)
    .set({
      status: options.deadLettered ? 'dead_letter' : 'pending',
      availableAt: options.availableAt,
      lastError: options.error.slice(0, MAX_LAST_ERROR_LENGTH),
      leaseOwner: null,
      leaseUntil: null,
    })
    .where(ownedLease(options.eventId, options.leaseOwner, now))
    .returning({ id: moderationOutbox.id });
  return released.length === 1;
}

/** One event by id, whatever its state. */
export async function findModerationOutboxEvent(
  eventId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationOutboxEvent | undefined> {
  const [row] = await db
    .select()
    .from(moderationOutbox)
    .where(eq(moderationOutbox.id, eventId))
    .limit(1);
  return row ? toEvent(row) : undefined;
}

/**
 * The delivery status of one event, for the reconciliation sweep.
 *
 * A narrow projection rather than {@link findModerationOutboxEvent}: the sweep
 * asks only "is there an event, and is it dead" once per report in a batch, and
 * a full read would pull every stored decision document along with it.
 */
export async function findModerationOutboxStatus(
  eventId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<OutboxRow['status'] | undefined> {
  const [row] = await db
    .select({ status: moderationOutbox.status })
    .from(moderationOutbox)
    .where(eq(moderationOutbox.id, eventId))
    .limit(1);
  return row?.status;
}
