/**
 * `review_reports` — the third and last report intake surface.
 *
 * Like `listing_reports`, it lives under `db/moderation/` because the moderation
 * intake path is its only writer, and it is written in the SAME transaction as
 * the `moderation_reports` row that will be delivered.
 *
 * ## What the writer may hold, and what the database must
 *
 * Same split as `listingReportRepository.ts`, and here the database half is
 * sharper. The SHAPE of a row — the reason allowlist, the details ceiling, the
 * reporter coming from the session — is the writer's. But "one report per
 * reporter per review" is `review_reports_review_user_key`, and it must be,
 * because one code path still runs concurrently with itself on every task: the
 * schema's own docstring makes the stakes explicit, since the COUNT of these
 * rows crossing three is what flips a review into `under_review`. A duplicate
 * that slipped through a read-then-insert is a vote for removal cast twice by
 * one person.
 *
 * ## The escalation is counted and applied inside the caller's transaction
 *
 * Mongo pushed onto an embedded array and read `array.length` — the count and
 * the rows could not disagree, because they were the same object. Split into a
 * table, the count is a real query, so {@link insertReviewReportAndEscalate}
 * does the insert, the count and the status flip in ONE statement sequence
 * inside the caller's transaction. Counting outside it would let two concurrent
 * third reports both read two and neither escalate.
 */

import { and, count, eq } from 'drizzle-orm';
import { ReviewModerationStatus } from '@homiio/shared-types';
import { getDb, type DatabaseOrTransaction } from '../postgres';
import { reviewReports, reviews } from '../schema/reviews';
import { isUniqueViolation } from '../uniqueViolation';

export type ReviewReportRow = typeof reviewReports.$inferSelect;
export type ReviewReportInsert = typeof reviewReports.$inferInsert;

/**
 * How many DISTINCT reporters flip a review to `under_review`.
 *
 * Homiio's own community counter, and deliberately separate from anything a jury
 * later decides — `ModerationEnforcementService` checks whether MODERATION set
 * the flag before it will lift it, precisely so a jury answering a different
 * question cannot clear this signal.
 */
export const REPORTS_TO_UNDER_REVIEW = 3;

/** This reporter has already reported this review. */
export class DuplicateReviewReportError extends Error {
  constructor() {
    super('This review has already been reported by this reporter.');
    this.name = 'DuplicateReviewReportError';
  }
}

/** The moderation status of a review, or `undefined` if there is no such review. */
export async function findReviewForReport(
  reviewId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<{ id: string; moderationStatus: ReviewReportSubjectStatus } | undefined> {
  const [row] = await db
    .select({ id: reviews.id, moderationStatus: reviews.moderationStatus })
    .from(reviews)
    .where(eq(reviews.id, reviewId))
    .limit(1);
  return row;
}

export type ReviewReportSubjectStatus = (typeof reviews.$inferSelect)['moderationStatus'];

/** Whether this reporter already has a report on record for this review. */
export async function hasReportedReview(
  reviewId: string,
  oxyUserId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const [row] = await db
    .select({ id: reviewReports.id })
    .from(reviewReports)
    .where(and(eq(reviewReports.reviewId, reviewId), eq(reviewReports.oxyUserId, oxyUserId)))
    .limit(1);
  return row !== undefined;
}

export interface ReviewReportOutcome {
  readonly report: ReviewReportRow;
  /** The review's status AFTER any escalation this report triggered. */
  readonly moderationStatus: ReviewReportSubjectStatus;
}

/**
 * File a report against a review, and escalate the review if this report is the
 * one that crosses the threshold.
 *
 * @throws {DuplicateReviewReportError} From the unique index's own `23505`, so
 *   two concurrent reports from one person cannot both be counted.
 */
export async function insertReviewReportAndEscalate(
  db: DatabaseOrTransaction,
  values: ReviewReportInsert,
  currentStatus: ReviewReportSubjectStatus,
): Promise<ReviewReportOutcome> {
  let report: ReviewReportRow;
  try {
    const [row] = await db.insert(reviewReports).values(values).returning();
    report = row;
  } catch (error) {
    if (!isUniqueViolation(error, 'review_reports_review_user_key')) throw error;
    throw new DuplicateReviewReportError();
  }

  // Only an ACTIVE review escalates. A review already `under_review` or
  // `removed` is not moved by another report — and `removed` in particular must
  // never be walked back to `under_review` by the community counter, since only
  // a jury put it there.
  if (currentStatus !== ReviewModerationStatus.ACTIVE) {
    return { report, moderationStatus: currentStatus };
  }

  const [totals] = await db
    .select({ total: count() })
    .from(reviewReports)
    .where(eq(reviewReports.reviewId, values.reviewId));
  if ((totals?.total ?? 0) < REPORTS_TO_UNDER_REVIEW) {
    return { report, moderationStatus: currentStatus };
  }

  // The `active` predicate is in the UPDATE, so two concurrent reports both
  // reaching the threshold produce one transition rather than two writes.
  const [escalated] = await db
    .update(reviews)
    .set({ moderationStatus: ReviewModerationStatus.UNDER_REVIEW })
    .where(
      and(
        eq(reviews.id, values.reviewId),
        eq(reviews.moderationStatus, ReviewModerationStatus.ACTIVE),
      ),
    )
    .returning({ moderationStatus: reviews.moderationStatus });

  return {
    report,
    moderationStatus: escalated?.moderationStatus ?? ReviewModerationStatus.UNDER_REVIEW,
  };
}
