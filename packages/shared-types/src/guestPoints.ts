/**
 * Guest points as a LEDGER (#518 §7.5, #519 §7.5).
 *
 * ## The product decision, stated once, here
 *
 * **One point per night, in both directions.** Hosting somebody for one night
 * earns exactly 1 point; staying one night costs exactly 1 point. The rate is
 * not a column, not a setting and not a per-home valuation — it is 1, and it is
 * the same 1 on the way in and on the way out.
 *
 * That symmetry is the whole design, and it is chosen rather than inherited:
 *
 *  - **It cannot inflate or deflate.** Every point in existence was earned by
 *    somebody hosting a night, and every point spent removes one. The total
 *    outstanding is exactly the number of nights hosted and not yet stayed.
 *    A rate that differed by direction would mint or burn points, and a system
 *    that mints its own currency has to decide how much of it to mint — which is
 *    a question nothing in Homiio could answer honestly.
 *  - **It avoids inventing a valuation.** Bloom's template charges "120 per
 *    night"; #518 §7.5 forbids copying that number, and the reason is that a
 *    number per night implies a price per home. Homiio has no basis for saying a
 *    room in Terrassa is worth a third of a flat in Barcelona, and ADR 0004
 *    forbids the kind of universal score that would be needed to say it. One
 *    night for one night needs no such judgement.
 *  - **Guests do not multiply it.** A night is a night. Two people staying one
 *    night is one night of hosting, so it is one point. Counting heads would
 *    re-introduce the valuation the flat rate exists to avoid, and would make a
 *    family stay unaffordable for a reason nobody chose.
 *
 * ## The only source and the only sink
 *
 * **Earned by hosting, spent by staying. There is nothing else.** No purchase,
 * no gift, no transfer between accounts, no conversion to or from money, no
 * crossover with reputation or product credits, no marketplace. Every one of
 * those is named and forbidden by #518 §7.5, and the schema enforces it
 * structurally rather than by discipline: every movement carries a NOT NULL
 * `exchange_request_id`, so a point that did not come from a stay somebody
 * requested cannot be represented at all.
 *
 * ## A new member starts at zero
 *
 * No welcome grant. #518 §7.5 calls that the "saldo ficticio" — a balance that
 * says you have something you were never given. So the honest sentence a
 * surface must be able to say is *"you need to host before you can stay"*, and
 * {@link guestPointStanding} returns everything needed to say it.
 *
 * ## Reserve, then settle or release
 *
 * A reserved point is NOT spendable. The lifecycle is:
 *
 *  - the guest asks for a stay → the cost is `reserved` against their ledger;
 *  - the host accepts → the guest's reservation `settles`, and the SAME number
 *    of points is credited to the host as a settled `earn`;
 *  - the host declines, the guest cancels, or the stay window passes unanswered
 *    → the reservation is `released` and the points are spendable again.
 *
 * Reserving rather than deducting is what makes "you have 3 points but 2 are
 * committed" expressible. Deducting on request and refunding on decline would
 * produce the same numbers most of the time and the wrong ones exactly when a
 * person is looking at a pending request.
 *
 * ## The balance is DERIVED, never stored
 *
 * Exactly as `leaseObligationSettlement` derives a lease's standing. A stored
 * balance is a second answer that can disagree with the movements it was
 * computed from, and the disagreement is discovered by the person who is told
 * they cannot afford a stay they can afford.
 */

/**
 * Which way a movement points.
 *
 * `earn` is hosting; `spend` is staying. There is no third direction, because a
 * third direction is exactly where a purchase, a gift or a promotional grant
 * would have to live.
 */
export const GUEST_POINT_DIRECTIONS = ['earn', 'spend'] as const;
export type GuestPointDirection = (typeof GUEST_POINT_DIRECTIONS)[number];

/**
 * How far a movement got.
 *
 *  - `reserved` — committed to a stay nobody has answered yet. **Not spendable,
 *    and not spent.** Only a `spend` is ever reserved.
 *  - `settled` — it happened. The only state that moves the balance.
 *  - `released` — the stay did not happen, so the points came back. The row
 *    stays, with its reason, because a ledger that deletes its own history is a
 *    ledger nobody can reconcile.
 */
export const GUEST_POINT_STATES = ['reserved', 'settled', 'released'] as const;
export type GuestPointState = (typeof GUEST_POINT_STATES)[number];

/**
 * Why a reservation came back.
 *
 * Three values because three different things happened, and a person reading
 * their own ledger is owed the difference between "they said no", "I changed my
 * mind" and "nobody ever answered".
 */
export const GUEST_POINT_RELEASE_REASONS = ['declined', 'cancelled', 'expired'] as const;
export type GuestPointReleaseReason = (typeof GUEST_POINT_RELEASE_REASONS)[number];

/** A single movement on one account's ledger. */
export interface GuestPointMovement {
  readonly id: string;
  /** Whose ledger this row belongs to. */
  readonly accountOxyUserId: string;
  /** The other person: the host on a spend, the guest on an earn. */
  readonly counterpartyOxyUserId: string;
  /** The stay this movement exists because of. There is no other source. */
  readonly exchangeRequestId: string;
  readonly direction: GuestPointDirection;
  readonly state: GuestPointState;
  /**
   * Always positive, and always equal to the number of nights — see the module
   * header. The DIRECTION is what makes a spend subtract.
   */
  readonly points: number;
  readonly settledAt?: string;
  readonly releasedAt?: string;
  readonly releaseReason?: GuestPointReleaseReason;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * What an account's ledger stands at.
 *
 * Every field is derived from the movements. `available` is the only one a
 * spend is ever checked against, and it is `earned - spent - reserved` — a
 * reserved point is committed to a stay somebody may yet accept, so treating it
 * as spendable is precisely the double-spend this domain exists to prevent.
 */
export interface GuestPointBalance {
  /** Nights hosted and settled. */
  readonly earned: number;
  /** Nights stayed and settled. */
  readonly spent: number;
  /** Committed to a stay awaiting an answer. Not spendable, not spent. */
  readonly reserved: number;
  /** `earned - spent`. What the account has, ignoring commitments. */
  readonly balance: number;
  /** `earned - spent - reserved`. What a new stay may be booked against. */
  readonly available: number;
  /**
   * True when this account has never hosted and never stayed.
   *
   * Reported rather than inferred from `balance === 0`, because the two are
   * different sentences: a member who has hosted three nights and stayed three
   * has a zero balance and has *used* the system, while a new member has a zero
   * balance and needs to be told, honestly, that hosting comes first.
   */
  readonly neverMoved: boolean;
}

/**
 * How many points a stay costs, and how many hosting it earns.
 *
 * The same function for both, called from both sides, because the symmetry is
 * the product decision and two functions could drift apart.
 *
 * The window is half-open `[start, end)`, matching
 * `exchange_requests_requested_window_gist` and `AvailabilityWindow`: a stay
 * from the 1st to the 4th is three nights. Rounded UP, so a stay that crosses a
 * daylight-saving boundary or carries a stray few hours is never charged zero —
 * a free night is as wrong as an invented one, and a zero-point stay would be
 * refused by the ledger's own `points > 0` CHECK rather than silently granted.
 */
export function guestPointsForWindow(start: Date | string, end: Date | string): number {
  const from = start instanceof Date ? start.getTime() : new Date(start).getTime();
  const to = end instanceof Date ? end.getTime() : new Date(end).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  const MS_PER_NIGHT = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.ceil((to - from) / MS_PER_NIGHT));
}

/**
 * Compute an account's standing from its movements.
 *
 * Shared, and used by BOTH sides: the server serialises it and a screen can
 * recompute it without a second definition of what "available" means.
 *
 * Only `settled` moves the balance; `reserved` is counted separately; and
 * `released` is counted nowhere at all — it is history, and adding it back
 * would double-credit every declined request.
 */
export function guestPointStanding(
  movements: readonly GuestPointMovement[],
): GuestPointBalance {
  let earned = 0;
  let spent = 0;
  let reserved = 0;

  for (const movement of movements) {
    if (movement.state === 'settled') {
      if (movement.direction === 'earn') earned += movement.points;
      else spent += movement.points;
      continue;
    }
    if (movement.state === 'reserved' && movement.direction === 'spend') {
      reserved += movement.points;
    }
    // `released` deliberately falls through: it is a record of something that
    // did not happen, and counting it anywhere would make a declined request
    // change a balance.
  }

  const balance = earned - spent;
  return {
    earned,
    spent,
    reserved,
    balance,
    available: balance - reserved,
    neverMoved: movements.length === 0,
  };
}

/** An idempotency key's shape, checked on both sides. Same rule as the rent ledger. */
export const GUEST_POINT_IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
