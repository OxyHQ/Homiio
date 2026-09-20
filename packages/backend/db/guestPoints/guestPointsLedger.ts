/**
 * The guest-points ledger's writes and reads (#518 §7.5, #519 §7.5).
 *
 * The rent ledger (`db/leases/paymentLedger.ts`) is the model this follows, and
 * the two share three properties on purpose: idempotency lives in an INDEX
 * rather than in a lookup, a state change is a conditional UPDATE rather than a
 * read-then-write, and the balance is derived from the rows rather than stored
 * anywhere. What is new here is the third guarantee — **you cannot spend a
 * point twice** — and it is the only one that needs a lock.
 *
 * ## Why a unique index is not enough, and a row lock is
 *
 * The two unique indexes on the table answer duplicates: the same request
 * arriving twice, or the same stay being accepted twice. They say nothing about
 * the case that actually matters, which is two DIFFERENT stays reserving the
 * same point at the same moment. Those are two legitimate rows with different
 * keys and different exchange requests; no index can refuse them. It is a lost
 * update, and it is prevented the way `applyMaintenanceTransition` prevents
 * its own: re-read under `FOR UPDATE` inside the transaction, and decide from
 * the re-read.
 *
 * ## The subtle half: the lock and the recount must be SEPARATE STATEMENTS
 *
 * This is the part that is easy to get wrong while looking right, so it is
 * written out rather than assumed.
 *
 * Under READ COMMITTED a `SELECT … FOR UPDATE` that blocks on a row locked by
 * another transaction does, after that transaction commits, re-fetch **that
 * row** and re-check it. It does **not** re-run its scan against a newer
 * snapshot — so a row the winner INSERTED while we were waiting is still
 * invisible to that statement. A single statement that both locked and summed
 * would therefore wait politely for the other spend and then not see it, which
 * is the double spend with extra steps.
 *
 * So {@link reserveStayPoints} does two things in order:
 *
 *   1. `SELECT id … FOR UPDATE` over the account's existing movements. This
 *      acquires nothing useful to read; its whole job is to make a concurrent
 *      reserve on the same account WAIT until we commit.
 *   2. A separate aggregate statement, which under READ COMMITTED takes a NEW
 *      snapshot — taken after the transaction we were blocked on committed —
 *      and therefore sees its insert.
 *
 * The lock in step 1 works because an account with any spendable points has at
 * least one settled `earn` row for both transactions to collide on. An account
 * with no rows at all locks nothing, and needs no lock: its available balance
 * is zero and every spend is refused.
 *
 * `__tests__/integration/guestPoints.test.ts` mutation-tests this: removing
 * `.for('update')` turns the interleaved case red, and the case is built so
 * that the losing transaction genuinely starts before the winner commits.
 *
 * ## Reserve, settle, release — and nothing else
 *
 * There is no `grant`, no `transfer`, no `purchase` and no `adjust`. Every
 * write in this module takes an exchange request, because `exchange_request_id`
 * is NOT NULL and there is no path that could supply one for a movement that
 * did not come from a stay. #518 §7.5's forbidden shapes are unrepresentable
 * rather than merely unimplemented.
 */

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  guestPointStanding,
  type GuestPointBalance,
  type GuestPointDirection,
  type GuestPointMovement,
  type GuestPointReleaseReason,
  type GuestPointState,
} from '@homiio/shared-types';

import type { DatabaseOrTransaction } from '../postgres';
import { exchangeRequests, guestPointMovements } from '../schema';

export type GuestPointMovementRow = typeof guestPointMovements.$inferSelect;

/** Every movement on one account's ledger, oldest first. */
export async function listMovements(
  db: DatabaseOrTransaction,
  accountOxyUserId: string,
): Promise<readonly GuestPointMovementRow[]> {
  return db
    .select()
    .from(guestPointMovements)
    .where(eq(guestPointMovements.accountOxyUserId, accountOxyUserId))
    .orderBy(asc(guestPointMovements.createdAt));
}

/**
 * What an account's ledger stands at.
 *
 * The SHARED function does the arithmetic, so the server and the client answer
 * "how many can I spend?" identically. This only fetches its inputs.
 */
export async function guestPointBalanceOf(
  db: DatabaseOrTransaction,
  accountOxyUserId: string,
): Promise<GuestPointBalance> {
  const movements = await listMovements(db, accountOxyUserId);
  return guestPointStanding(movements.map(toMovementDTO));
}

/**
 * The available balance, computed in SQL.
 *
 * In SQL rather than in JavaScript because this runs inside the transaction
 * that is about to insert, and the whole point is that it reads the database's
 * current committed state rather than a set of rows fetched earlier. It is the
 * same arithmetic {@link guestPointStanding} performs, and the integration
 * suite asserts the two agree on a ledger containing every state — a second
 * definition of "available" that nothing compares is exactly the drift this
 * domain cannot afford.
 */
export async function availablePointsOf(
  db: DatabaseOrTransaction,
  accountOxyUserId: string,
): Promise<number> {
  const [row] = await db
    .select({
      available: sql<number>`coalesce(sum(
        case
          when ${guestPointMovements.state} = 'settled'
            and ${guestPointMovements.direction} = 'earn'
            then ${guestPointMovements.points}
          when ${guestPointMovements.state} = 'settled'
            and ${guestPointMovements.direction} = 'spend'
            then -${guestPointMovements.points}
          when ${guestPointMovements.state} = 'reserved'
            and ${guestPointMovements.direction} = 'spend'
            then -${guestPointMovements.points}
          else 0
        end
      ), 0)`,
    })
    .from(guestPointMovements)
    .where(eq(guestPointMovements.accountOxyUserId, accountOxyUserId));
  return Number(row?.available ?? 0);
}

export interface ReserveInput {
  readonly exchangeRequestId: string;
  readonly guestOxyUserId: string;
  readonly hostOxyUserId: string;
  readonly points: number;
  readonly idempotencyKey: string;
}

export type ReserveOutcome =
  | {
      readonly ok: true;
      readonly movement: GuestPointMovementRow;
      /** The key already existed and this is the row it named. */
      readonly deduped: boolean;
    }
  | {
      readonly ok: false;
      readonly reason: 'insufficient_points';
      readonly available: number;
      readonly required: number;
    };

/**
 * Reserve a stay's cost against the guest's ledger.
 *
 * The transaction is the unit of correctness, and the order of the three steps
 * inside it is load-bearing — see the module header for why the lock and the
 * recount cannot be one statement.
 */
export async function reserveStayPoints(
  db: DatabaseOrTransaction,
  input: ReserveInput,
): Promise<ReserveOutcome> {
  return db.transaction(async (tx) => {
    // 1. LOCK. Nothing is read from this; its job is to make a concurrent
    //    reserve on the same account wait for our commit. Removing
    //    `.for('update')` leaves every assertion below green except the
    //    interleaved case in the integration suite, which is the point of that
    //    case existing.
    await tx
      .select({ id: guestPointMovements.id })
      .from(guestPointMovements)
      .where(eq(guestPointMovements.accountOxyUserId, input.guestOxyUserId))
      .for('update');

    // 2. RECOUNT, as a separate statement. Its snapshot is taken now — after
    //    whoever held the lock committed — so it sees their insert. A single
    //    locking aggregate would not.
    const available = await availablePointsOf(tx, input.guestOxyUserId);
    if (available < input.points) {
      // Reported rather than thrown, so the caller can answer 409 with both
      // numbers. "You need 3 and have 1" is a sentence somebody can act on;
      // "insufficient points" is not.
      return {
        ok: false as const,
        reason: 'insufficient_points' as const,
        available,
        required: input.points,
      };
    }

    // 3. INSERT, with the dedupe pushed into the index rather than decided
    //    above it — the rent ledger's reasoning, unchanged: a select followed
    //    by an insert has a window between them, and that window is exactly
    //    where a double tap lands.
    const [inserted] = await tx
      .insert(guestPointMovements)
      .values({
        accountOxyUserId: input.guestOxyUserId,
        counterpartyOxyUserId: input.hostOxyUserId,
        exchangeRequestId: input.exchangeRequestId,
        direction: 'spend',
        state: 'reserved',
        points: input.points,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [guestPointMovements.accountOxyUserId, guestPointMovements.idempotencyKey],
      })
      .returning();

    if (inserted) return { ok: true as const, movement: inserted, deduped: false };

    const [existing] = await tx
      .select()
      .from(guestPointMovements)
      .where(
        and(
          eq(guestPointMovements.accountOxyUserId, input.guestOxyUserId),
          eq(guestPointMovements.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    // Unreachable: the insert declines only on THIS conflict target, so the row
    // exists. Throwing rather than inventing a return keeps an impossible state
    // from becoming a confusing 200.
    if (!existing) {
      throw new Error('A guest-point reservation conflicted on its key but could not be re-read.');
    }
    return { ok: true as const, movement: existing, deduped: true };
  });
}

export type SettleOutcome =
  | {
      readonly ok: true;
      readonly spend: GuestPointMovementRow;
      readonly earn: GuestPointMovementRow;
      /** The stay was already settled and these are the rows that settled it. */
      readonly alreadySettled: boolean;
    }
  | { readonly ok: false; readonly reason: 'no_reservation' };

/**
 * Settle a stay: the guest's reservation becomes a spend, and the host is
 * credited the same number of points.
 *
 * ONE transaction, because the two halves are one fact. A version that settled
 * the spend and then credited the host would, on a failure between them, delete
 * points from the system — and nothing would ever notice, because there is no
 * total to reconcile against.
 *
 * The `reserved` requirement is in the UPDATE's own predicate, not checked
 * above it, so two accepts arriving at once produce one settlement rather than
 * both reading `reserved` and both writing. The host's credit is protected by
 * `guest_point_movements_request_direction_key` on the way in, which is the
 * second half of the same guarantee and the half that survives a caller with a
 * different idempotency key.
 */
export async function settleStayPoints(
  db: DatabaseOrTransaction,
  input: {
    readonly exchangeRequestId: string;
    readonly idempotencyKey: string;
  },
): Promise<SettleOutcome> {
  return db.transaction(async (tx) => {
    const settledAt = new Date();
    const [spend] = await tx
      .update(guestPointMovements)
      .set({ state: 'settled', settledAt })
      .where(
        and(
          eq(guestPointMovements.exchangeRequestId, input.exchangeRequestId),
          eq(guestPointMovements.direction, 'spend'),
          eq(guestPointMovements.state, 'reserved'),
        ),
      )
      .returning();

    if (!spend) {
      // Either there never was a reservation, or it has already settled or been
      // released. The first is an error; the second is the caller's intent
      // already satisfied. Telling them apart needs a read.
      const [existing] = await tx
        .select()
        .from(guestPointMovements)
        .where(
          and(
            eq(guestPointMovements.exchangeRequestId, input.exchangeRequestId),
            eq(guestPointMovements.direction, 'spend'),
          ),
        )
        .limit(1);
      if (!existing || existing.state !== 'settled') {
        return { ok: false as const, reason: 'no_reservation' as const };
      }
      const [earned] = await tx
        .select()
        .from(guestPointMovements)
        .where(
          and(
            eq(guestPointMovements.exchangeRequestId, input.exchangeRequestId),
            eq(guestPointMovements.direction, 'earn'),
          ),
        )
        .limit(1);
      if (!earned) {
        // A settled spend with no matching earn is points that left one ledger
        // and arrived nowhere. It cannot happen — both rows are written in this
        // one transaction — and if it ever does, failing loudly is the only
        // honest answer.
        throw new Error(
          `Exchange ${input.exchangeRequestId} has a settled guest-point spend with no matching credit.`,
        );
      }
      return { ok: true as const, spend: existing, earn: earned, alreadySettled: true };
    }

    // The host's credit. Same points, same stay, opposite direction and the
    // parties swapped — the symmetry stated in `shared-types/guestPoints.ts`,
    // written out here so nothing has to derive it twice.
    const [earn] = await tx
      .insert(guestPointMovements)
      .values({
        accountOxyUserId: spend.counterpartyOxyUserId,
        counterpartyOxyUserId: spend.accountOxyUserId,
        exchangeRequestId: spend.exchangeRequestId,
        direction: 'earn',
        state: 'settled',
        points: spend.points,
        settledAt,
        idempotencyKey: input.idempotencyKey,
      })
      .returning();

    return { ok: true as const, spend, earn, alreadySettled: false };
  });
}

export type ReleaseOutcome =
  | {
      readonly ok: true;
      readonly movement: GuestPointMovementRow;
      readonly alreadyReleased: boolean;
    }
  | { readonly ok: false; readonly reason: 'no_reservation' | 'already_settled' };

/**
 * Give a reservation's points back.
 *
 * The same conditional-update shape: `state = 'reserved'` is in the predicate,
 * so a decline racing a cancel produces one release rather than two. A
 * reservation that has already SETTLED is refused rather than reversed —
 * releasing a stay the host accepted would hand the guest their points back
 * while the host keeps the credit, which is the one way this ledger could mint.
 */
export async function releaseStayPoints(
  db: DatabaseOrTransaction,
  input: {
    readonly exchangeRequestId: string;
    readonly reason: GuestPointReleaseReason;
  },
): Promise<ReleaseOutcome> {
  const releasedAt = new Date();
  const [updated] = await db
    .update(guestPointMovements)
    .set({ state: 'released', releasedAt, releaseReason: input.reason })
    .where(
      and(
        eq(guestPointMovements.exchangeRequestId, input.exchangeRequestId),
        eq(guestPointMovements.direction, 'spend'),
        eq(guestPointMovements.state, 'reserved'),
      ),
    )
    .returning();
  if (updated) return { ok: true, movement: updated, alreadyReleased: false };

  const [existing] = await db
    .select()
    .from(guestPointMovements)
    .where(
      and(
        eq(guestPointMovements.exchangeRequestId, input.exchangeRequestId),
        eq(guestPointMovements.direction, 'spend'),
      ),
    )
    .limit(1);
  if (!existing) return { ok: false, reason: 'no_reservation' };
  if (existing.state === 'settled') return { ok: false, reason: 'already_settled' };
  return { ok: true, movement: existing, alreadyReleased: true };
}

/** The reservation attached to one stay, whatever state it is in. */
export async function findReservation(
  db: DatabaseOrTransaction,
  exchangeRequestId: string,
): Promise<GuestPointMovementRow | undefined> {
  const [row] = await db
    .select()
    .from(guestPointMovements)
    .where(
      and(
        eq(guestPointMovements.exchangeRequestId, exchangeRequestId),
        eq(guestPointMovements.direction, 'spend'),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Release every reservation whose stay came and went without an answer.
 *
 * The "expiring releases them" half of the lifecycle, and the reason it exists
 * is that nothing else would ever run: a host who simply never answers leaves
 * the guest's points committed to a trip that cannot happen any more, forever.
 * Postgres does not do this on a deadline — `db/expiry.ts` says so for
 * deletions and it is just as true for a state change — so it is a SWEEP, run
 * by `services/cron.ts`.
 *
 * The predicate reads the exchange request rather than a deadline column on the
 * movement: the stay's own window IS the deadline, and copying it onto the
 * movement would be a second value that can disagree with the first.
 *
 * Bounded by `limit`, and idempotent — a row it releases no longer matches, so
 * two sweeps running at once cost a duplicate scan and nothing else.
 */
export async function releaseExpiredReservations(
  db: DatabaseOrTransaction,
  options: { readonly now?: Date; readonly limit?: number } = {},
): Promise<{ readonly released: number }> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;

  const due = await db
    .select({ id: guestPointMovements.id })
    .from(guestPointMovements)
    .innerJoin(
      exchangeRequests,
      eq(exchangeRequests.id, guestPointMovements.exchangeRequestId),
    )
    .where(
      and(
        eq(guestPointMovements.direction, 'spend'),
        eq(guestPointMovements.state, 'reserved'),
        eq(exchangeRequests.status, 'pending'),
        // `lte`, never a `Date` interpolated into a raw `sql` template.
        // postgres.js infers a parameter's wire type from its position and
        // cannot do so inside one, so a bare Date there fails at SERIALISATION
        // with `The "string" argument must be of type string ... Received an
        // instance of Date` — before the server sees the statement.
        // `db/exchanges/exchangeReads.ts` documents the same trap.
        lte(exchangeRequests.requestedWindowEnd, now),
      ),
    )
    .limit(limit);

  if (due.length === 0) return { released: 0 };

  const released = await db
    .update(guestPointMovements)
    .set({ state: 'released', releasedAt: now, releaseReason: 'expired' })
    .where(
      and(
        inArray(
          guestPointMovements.id,
          due.map((row) => row.id),
        ),
        // Re-stated in the predicate rather than trusted from the read above:
        // a host can accept between the two statements, and settling then
        // releasing the same reservation would credit the host for a stay the
        // guest was refunded.
        eq(guestPointMovements.state, 'reserved'),
      ),
    )
    .returning({ id: guestPointMovements.id });

  return { released: released.length };
}

/** A ledger row on the wire. */
export function toMovementDTO(row: GuestPointMovementRow): GuestPointMovement {
  return {
    id: row.id,
    accountOxyUserId: row.accountOxyUserId,
    counterpartyOxyUserId: row.counterpartyOxyUserId,
    exchangeRequestId: row.exchangeRequestId,
    direction: row.direction as GuestPointDirection,
    state: row.state as GuestPointState,
    points: row.points,
    ...(row.settledAt ? { settledAt: row.settledAt.toISOString() } : {}),
    ...(row.releasedAt ? { releasedAt: row.releasedAt.toISOString() } : {}),
    ...(row.releaseReason
      ? { releaseReason: row.releaseReason as GuestPointReleaseReason }
      : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
