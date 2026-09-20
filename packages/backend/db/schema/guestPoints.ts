/**
 * `guest_point_movements` — the guest-points LEDGER (#518 §7.5, #519 §7.5).
 *
 * The same shape as `lease_payment_movements`, applied to a different unit: a
 * row is a MOVEMENT, the balance is derived from the rows, and nothing stores a
 * total. The reasoning for the unit itself — one point per night, both
 * directions, guests do not multiply it — is in
 * `shared-types/src/guestPoints.ts` and is deliberately stated exactly once.
 *
 * ## The NOT NULL foreign key is the product rule
 *
 * `exchange_request_id` is `NOT NULL`, so **a movement that did not come from a
 * stay somebody requested cannot be written**. That is not a data-modelling
 * preference; it is #518 §7.5's list of forbidden shortcuts made
 * unrepresentable. A purchase, a gift, a promotional grant, a transfer between
 * accounts, a conversion from money and a marketplace trade all have the same
 * thing in common: none of them has an exchange request behind it. The
 * constraint refuses every one of them without naming any of them.
 *
 * RESTRICT rather than CASCADE, following `CONVENTIONS.md`'s rule for the
 * `properties` group: this is a record of a human transaction, not a copy of an
 * advertisement. Nothing deletes an exchange request today — `declined` and
 * `cancelled` are statuses — and if anything ever does, refusing is the right
 * answer: deleting a request must not silently delete the points somebody
 * earned by honouring it.
 *
 * ## Why there is no `guest_point_accounts` table
 *
 * A balance row would be a second answer to "how many points does this person
 * have?", and the whole design is that there is only one. A new member has no
 * row here and that IS their zero: absence and zero are the same fact for a
 * ledger, which is what lets a surface say "you need to host before you can
 * stay" without anything having to be provisioned first.
 *
 * ## Why there is no expiry entry
 *
 * `db/expiry.ts` exists because a table whose rows expire and is not registered
 * grows forever. No row here expires. A reservation that runs out of time is
 * RELEASED — a state change that gives the points back — and the row survives,
 * because "you asked, nobody answered, you got your points back" is a fact the
 * person is owed. Stated here so the absence reads as a decision rather than
 * the omission `CONVENTIONS.md` warns about.
 */

import { check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import {
  GUEST_POINT_DIRECTIONS,
  GUEST_POINT_RELEASE_REASONS,
  GUEST_POINT_STATES,
} from '@homiio/shared-types';

import { exchangeRequests } from './exchanges';

export const GUEST_POINT_MOVEMENT_DIRECTIONS = GUEST_POINT_DIRECTIONS;
export const GUEST_POINT_MOVEMENT_STATES = GUEST_POINT_STATES;
export const GUEST_POINT_MOVEMENT_RELEASE_REASONS = GUEST_POINT_RELEASE_REASONS;

export const guestPointMovements = pgTable(
  'guest_point_movements',
  {
    id: generatedId(),

    /**
     * Whose ledger this row belongs to.
     *
     * One row per SIDE, not one row per exchange: the guest's spend and the
     * host's earn are two movements on two ledgers. A single row carrying both
     * would make "list my movements" a query with two joins and an OR, and
     * would make the balance of one account depend on a column belonging to
     * another.
     */
    accountOxyUserId: text().notNull(),
    /** The other person. Carried so a movement reads as a sentence on its own. */
    counterpartyOxyUserId: text().notNull(),

    /** The stay this movement exists because of. See the header. */
    exchangeRequestId: text()
      .notNull()
      .references(() => exchangeRequests.id, { onDelete: 'restrict' }),

    direction: text({ enum: GUEST_POINT_DIRECTIONS }).notNull(),
    state: text({ enum: GUEST_POINT_STATES }).notNull(),

    /**
     * Always positive, and always the NIGHT COUNT.
     *
     * `integer`, not `doublePrecision` like the rent ledger's `amount`: a point
     * is a night and there is no half a night. A float would admit 0.5 points
     * through the `> 0` CHECK and make a balance that never quite reaches zero.
     *
     * The night count is not stored a second time beside it. Points equal
     * nights by construction (`guestPointsForWindow`), and two columns holding
     * one fact is the shape `CONVENTIONS.md` rejects for `Region.imageIds[]`:
     * they can disagree, and then something has to decide which is right.
     */
    points: integer().notNull(),

    settledAt: timestamptz(),
    releasedAt: timestamptz(),
    releaseReason: text({ enum: GUEST_POINT_RELEASE_REASONS }),

    /**
     * The caller's own key, unique per ACCOUNT.
     *
     * Per account rather than per exchange request, because the account is what
     * a balance is computed over and therefore what a duplicate would corrupt.
     * The same dedupe the rent ledger relies on, arbitrated by the INDEX rather
     * than by a lookup-then-insert — see `db/guestPoints/guestPointsLedger.ts`.
     */
    idempotencyKey: text().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * One person's ledger, newest first.
     *
     * The ONE index this table gets. The balance aggregate reads the same
     * account's rows through the same leading column; a person has a handful of
     * movements, so narrowing further would be the speculative index
     * `CONVENTIONS.md` forbids.
     */
    index('guest_point_movements_account_created_idx').on(
      table.accountOxyUserId,
      sql`${table.createdAt} desc`,
    ),
    /** One movement per key per account. The whole of the idempotency guarantee. */
    uniqueIndex('guest_point_movements_idempotency_key').on(
      table.accountOxyUserId,
      table.idempotencyKey,
    ),
    /**
     * One spend and one earn per stay — at most, and never two of either.
     *
     * Total rather than partial, because both columns are `NOT NULL` and the
     * rule really is total: a stay charges its guest once and credits its host
     * once. This is the structural half of the double-spend defence — the row
     * lock in the repository stops two DIFFERENT stays from spending the same
     * point, and this stops the SAME stay from being charged or credited twice
     * however many times an accept is replayed.
     *
     * It also serves every `exchange_request_id` lookup as a leading prefix,
     * which is why the table declares no separate index for one.
     */
    uniqueIndex('guest_point_movements_request_direction_key').on(
      table.exchangeRequestId,
      table.direction,
    ),
    check(
      'guest_point_movements_direction_check',
      sql`${table.direction} in (${sql.raw(inList(GUEST_POINT_DIRECTIONS))})`,
    ),
    check(
      'guest_point_movements_state_check',
      sql`${table.state} in (${sql.raw(inList(GUEST_POINT_STATES))})`,
    ),
    check(
      'guest_point_movements_release_reason_check',
      sql`${table.releaseReason} is null or ${table.releaseReason} in (${sql.raw(
        inList(GUEST_POINT_RELEASE_REASONS),
      )})`,
    ),
    /** A night is a night. Zero points is not a stay, and a negative is a direction. */
    check('guest_point_movements_points_check', sql`${table.points} > 0`),
    /**
     * Nobody hosts themselves.
     *
     * A self-exchange would be a person minting points out of nothing: earn one,
     * spend one, repeat. `exchangeController` already refuses a request against
     * your own property, but that is a controller check and this is the ledger —
     * and the ledger is the thing whose total must mean something.
     */
    check(
      'guest_point_movements_distinct_parties_check',
      sql`${table.accountOxyUserId} <> ${table.counterpartyOxyUserId}`,
    ),
    /**
     * An EARN is never reserved and never released.
     *
     * A host is credited at the moment they accept, so there is no window in
     * which their points are promised-but-not-theirs. A reserved earn would be
     * a balance the host could see and not use, for no reason anybody chose.
     */
    check(
      'guest_point_movements_earn_settles_check',
      sql`${table.direction} <> 'earn' or ${table.state} = 'settled'`,
    ),
    /**
     * A settled movement says WHEN it settled, and an unsettled one does not.
     *
     * Two-way, for the reason `lease_payment_movements_confirmed_check` is
     * two-way: a date beside something that did not happen is a date a screen
     * will render.
     */
    check(
      'guest_point_movements_settled_check',
      sql`(${table.state} = 'settled') = (${table.settledAt} is not null)`,
    ),
    /**
     * A released movement says when, AND why.
     *
     * Both two-way. "They declined", "I cancelled" and "nobody answered" are
     * three different things to be told, and a release with no reason is a
     * person watching points come back with no explanation of what happened to
     * their trip. The reverse — a reason on a movement that was not
     * released — would render the same way and mean nothing.
     */
    check(
      'guest_point_movements_released_check',
      sql`(${table.state} = 'released') = (${table.releasedAt} is not null)`,
    ),
    check(
      'guest_point_movements_release_reason_presence_check',
      sql`(${table.state} = 'released') = (${table.releaseReason} is not null)`,
    ),
  ],
);
