/**
 * The review WRITE repository — create, edit, delete and the helpful-vote
 * toggle.
 *
 * Three Mongoose behaviours had to be re-expressed here rather than ported, and
 * each is the reason a piece of this module exists:
 *
 *  - **`pre('validate')`'s `livedForMonths`.** A required, `NOT NULL` column
 *    that is NEVER user-supplied — `CREATABLE_REVIEW_FIELDS` does not list it —
 *    and the hook recomputed it on every `save()`, so an EDIT that moved the
 *    dates moved the duration with them. {@link deriveLivedForMonths} is the one
 *    definition and both write paths call it; nothing else in this package may
 *    set the column. `reviews_lived_order_check` backs it from the database
 *    side, so a wrong pair fails loudly rather than storing a negative tenancy.
 *  - **The duplicate check.** `Review.findOne({ oxyUserId, addressId })` before
 *    an insert is a read-then-write two concurrent submissions both pass.
 *    `reviews_author_address_key` is the rule; this module INSERTS and answers
 *    the violation, which is the shape `db/MIGRATION-CONTRACT.md` prescribes.
 *  - **`$addToSet` / `$pull` on `helpfulVoters`.** The controller read the array,
 *    decided, and wrote — reintroducing the race `$addToSet` had closed. The
 *    toggle is now a DELETE whose `RETURNING` set IS the decision, so of two
 *    concurrent togglers exactly one deletes and the other inserts.
 *
 * ## Ownership is in the STATEMENT, never in a preceding read
 *
 * Every owner-scoped write carries `and(eq(id), eq(oxy_user_id))` and answers
 * `null` when it matches nothing, so a non-owner and a missing review are
 * indistinguishable from outside — the 404-not-a-leaky-400 invariant
 * `controllers/reviewController.ts` states, enforced where it cannot be
 * bypassed.
 */

import { and, count, eq, type SQL } from 'drizzle-orm';

import { getDb, inSavepoint, type DatabaseOrTransaction } from '../postgres';
import { reviewHelpfulVotes, reviews } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';
import type { ReviewRow } from './reviewSerializer';

export type ReviewInsert = typeof reviews.$inferInsert;

/**
 * Milliseconds in an AVERAGE month (30.44 days).
 *
 * Verbatim from `ReviewSchema.pre('validate')`. It is an average rather than a
 * calendar computation, so "1 January to 1 February" and "1 February to 1 March"
 * can round differently — that is the source's behaviour and the stored values
 * this migration preserves were produced by it.
 */
const MILLISECONDS_PER_AVERAGE_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/**
 * The tenancy length in whole months, rounded UP.
 *
 * The port of the only `pre('validate')` hook on `ReviewSchema`, `Math.abs`
 * included. The absolute value is now redundant — `reviews_lived_order_check`
 * refuses `lived_to <= lived_from` outright, so an inverted pair never reaches
 * storage either way — but it is carried across so an inverted pair is REFUSED
 * by the ordering constraint rather than by `lived_for_months`' own bound, which
 * would name the wrong column in the error a client sees.
 */
export function deriveLivedForMonths(livedFrom: Date, livedTo: Date): number {
  const elapsed = Math.abs(livedTo.getTime() - livedFrom.getTime());
  return Math.ceil(elapsed / MILLISECONDS_PER_AVERAGE_MONTH);
}

/** This person has already reviewed this address. */
export class DuplicateReviewError extends Error {
  constructor() {
    super('You have already reviewed this address.');
    this.name = 'DuplicateReviewError';
  }
}

/** Everything a create supplies except the derived duration. */
export type ReviewCreateValues = Omit<ReviewInsert, 'livedForMonths'>;

/**
 * Insert a review, deriving `livedForMonths` from the tenancy dates.
 *
 * ## The savepoint is required, not defensive
 *
 * `createReview` runs this INSIDE a transaction, because the agency it may have
 * created must roll back with a review that never landed. In Postgres a failed
 * statement aborts the whole transaction, so a bare `23505` here would leave the
 * caller's handle unusable: the friendly 400 would still be reachable, but any
 * statement the caller issues after it — including reading the review that
 * already exists in order to answer with it — would die with `25P02
 * current_transaction_is_aborted`. `inSavepoint` unwinds to the savepoint only,
 * so the refusal costs the caller nothing.
 *
 * That is the same regression `db/postgres.ts`'s own docblock describes for the
 * report intake, and it is a PORT regression in both cases: Mongo detected the
 * duplicate with a `findOne` before the insert, so nothing was ever aborted, and
 * moving that check into the index is exactly what introduced it.
 *
 * @throws {DuplicateReviewError} From `reviews_author_address_key`.
 */
export async function insertReview(
  db: DatabaseOrTransaction,
  values: ReviewCreateValues,
): Promise<ReviewRow> {
  try {
    const [row] = await inSavepoint(db, (tx) =>
      tx
        .insert(reviews)
        .values({
          ...values,
          livedForMonths: deriveLivedForMonths(values.livedFrom, values.livedTo),
        })
        .returning(),
    );
    return row;
  } catch (error) {
    if (!isUniqueViolation(error, 'reviews_author_address_key')) throw error;
    throw new DuplicateReviewError();
  }
}

/** The fields an author may change, already narrowed by `EDITABLE_REVIEW_FIELDS`. */
export type ReviewPatch = Partial<Omit<ReviewInsert, 'livedForMonths'>>;

/**
 * Apply an author's edit, recomputing the tenancy duration.
 *
 * Two statements in one transaction rather than one, because the recompute needs
 * the RESULTING dates and an edit may move only one of them: the `select`
 * supplies whichever side the patch does not. `FOR UPDATE` on that read is what
 * stops a concurrent edit landing between the two and leaving `lived_for_months`
 * describing a tenancy neither writer asked for.
 *
 * BOTH statements carry the ownership predicate. Carrying it only on the read
 * would make the update a bare `where id = …`, which is the shape that turns a
 * missing ownership check into an IDOR the day somebody refactors the read away.
 *
 * @returns The updated row, or `null` when no review with that id belongs to
 *   this author — the caller answers 404 for both.
 */
export async function updateOwnReview(
  input: { reviewId: string; oxyUserId: string; patch: ReviewPatch },
  db: DatabaseOrTransaction = getDb(),
): Promise<ReviewRow | null> {
  const owned = and(eq(reviews.id, input.reviewId), eq(reviews.oxyUserId, input.oxyUserId));

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ livedFrom: reviews.livedFrom, livedTo: reviews.livedTo })
      .from(reviews)
      .where(owned)
      .limit(1)
      .for('update');
    if (!current) return null;

    const livedFrom = input.patch.livedFrom ?? current.livedFrom;
    const livedTo = input.patch.livedTo ?? current.livedTo;

    const [row] = await tx
      .update(reviews)
      .set({ ...input.patch, livedForMonths: deriveLivedForMonths(livedFrom, livedTo) })
      .where(owned)
      .returning();
    return row ?? null;
  });
}

/**
 * Delete an author's own review.
 *
 * Its helpful votes and its reports go with it — both child tables CASCADE — so
 * there is no second statement to forget.
 *
 * @returns `true` when a row was deleted; `false` for a missing review AND for
 *   somebody else's.
 */
export async function deleteOwnReview(
  input: { reviewId: string; oxyUserId: string },
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const deleted = await db
    .delete(reviews)
    .where(and(eq(reviews.id, input.reviewId), eq(reviews.oxyUserId, input.oxyUserId)))
    .returning({ id: reviews.id });
  return deleted.length > 0;
}

/** The author and the moderation state of a review — what the vote and report paths gate on. */
export async function findReviewAuthor(
  reviewId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<{ id: string; oxyUserId: string } | null> {
  const [row] = await db
    .select({ id: reviews.id, oxyUserId: reviews.oxyUserId })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  return row ?? null;
}

export interface HelpfulToggleResult {
  readonly helpfulCount: number;
  readonly viewerHasVotedHelpful: boolean;
}

/**
 * Flip one person's helpful vote on one review.
 *
 * The DELETE goes first and its `RETURNING` set IS the decision, which is what
 * makes the toggle race-free without a read: two concurrent togglers both issue
 * it, exactly one deletes a row, and the other — seeing nothing deleted —
 * inserts. Mongo's `alreadyVoted` read chose the operation BEFORE the write, so
 * both could pick `$addToSet` and one of the two answers was simply wrong.
 *
 * The insert is `ON CONFLICT DO NOTHING` on the same key rather than a caught
 * `23505`: the row existing is the state this branch is trying to reach, so
 * there is nothing to recover from and nothing to tell the caller.
 */
export async function toggleHelpfulVote(
  input: { reviewId: string; oxyUserId: string },
  db: DatabaseOrTransaction = getDb(),
): Promise<HelpfulToggleResult> {
  const vote: SQL | undefined = and(
    eq(reviewHelpfulVotes.reviewId, input.reviewId),
    eq(reviewHelpfulVotes.oxyUserId, input.oxyUserId),
  );

  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(reviewHelpfulVotes)
      .where(vote)
      .returning({ id: reviewHelpfulVotes.id });

    if (removed.length === 0) {
      await tx
        .insert(reviewHelpfulVotes)
        .values({ reviewId: input.reviewId, oxyUserId: input.oxyUserId })
        .onConflictDoNothing({
          target: [reviewHelpfulVotes.reviewId, reviewHelpfulVotes.oxyUserId],
        });
    }

    const [totals] = await tx
      .select({ total: count() })
      .from(reviewHelpfulVotes)
      .where(eq(reviewHelpfulVotes.reviewId, input.reviewId));

    return {
      helpfulCount: totals?.total ?? 0,
      viewerHasVotedHelpful: removed.length === 0,
    };
  });
}
