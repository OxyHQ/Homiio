/**
 * `exchange_reviews` — what each side said after a completed exchange.
 *
 * Empty in production. Distinct from `reviews`, which rates an ADDRESS; this one
 * rates a PERSON and is scoped to one exchange.
 *
 * ## The "already reviewed" pre-check is GONE, and the index is the answer
 *
 * The Mongoose controller read for an existing review, then inserted, then ALSO
 * caught the duplicate-key error — a read-then-write with a window plus a
 * backstop. `exchange_reviews_request_reviewer_key` is a real UNIQUE, so the
 * insert IS the check: `db/MIGRATION-CONTRACT.md` says the ported code should
 * INSERT and handle `23505` rather than re-implement the read, and keeping the
 * read would leave a redundant round trip in front of a constraint that already
 * decides it.
 *
 * The 409 is unchanged; it is raised from the index's own violation now.
 *
 * ## The average is `avg()`, and it is rounded in ONE place
 *
 * Mongo used a `$group` pipeline and rounded in JS. Postgres does the same work
 * in the same query as the count, so the page, the total and the average cannot
 * come from three different snapshots of the table.
 */

import { desc, eq, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { exchangeReviews } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';

export type ExchangeReviewRow = typeof exchangeReviews.$inferSelect;

/** This reviewer has already reviewed this exchange. */
export class ExchangeAlreadyReviewedError extends Error {
  constructor() {
    super('This reviewer has already reviewed this exchange.');
    this.name = 'ExchangeAlreadyReviewedError';
  }
}

export interface CreateExchangeReviewInput {
  readonly exchangeRequestId: string;
  readonly reviewerOxyUserId: string;
  readonly subjectOxyUserId: string;
  readonly rating: number;
  readonly comment?: string;
  readonly categories?: {
    readonly communication?: number;
    readonly cleanliness?: number;
    readonly accuracy?: number;
    readonly hospitality?: number;
  };
}

/**
 * Insert one review.
 *
 * @throws {ExchangeAlreadyReviewedError} From
 *   `exchange_reviews_request_reviewer_key`'s own `23505`, so two concurrent
 *   submissions cannot both land.
 */
export async function createExchangeReview(
  db: DatabaseOrTransaction,
  input: CreateExchangeReviewInput,
): Promise<ExchangeReviewRow> {
  try {
    const [row] = await db
      .insert(exchangeReviews)
      .values({
        exchangeRequestId: input.exchangeRequestId,
        reviewerOxyUserId: input.reviewerOxyUserId,
        subjectOxyUserId: input.subjectOxyUserId,
        rating: input.rating,
        comment: input.comment,
        // The four `categories` are a closed subdocument flattened into named
        // columns; each is optional and CHECK-bounded to 1-5 when present.
        categoriesCommunication: input.categories?.communication,
        categoriesCleanliness: input.categories?.cleanliness,
        categoriesAccuracy: input.categories?.accuracy,
        categoriesHospitality: input.categories?.hospitality,
      })
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'exchange_reviews_request_reviewer_key')) {
      throw new ExchangeAlreadyReviewedError();
    }
    throw error;
  }
}

/** Both reviews tied to one exchange, newest first. */
export async function listReviewsForExchange(
  db: DatabaseOrTransaction,
  exchangeRequestId: string,
): Promise<readonly ExchangeReviewRow[]> {
  return db
    .select()
    .from(exchangeReviews)
    .where(eq(exchangeReviews.exchangeRequestId, exchangeRequestId))
    .orderBy(desc(exchangeReviews.createdAt));
}

export interface SubjectReviewsResult {
  readonly rows: readonly ExchangeReviewRow[];
  readonly total: number;
  /** `avg(rating)` over EVERY review of this subject, rounded to 2 places. */
  readonly averageRating: number;
}

/**
 * One page of the reviews written ABOUT a person, plus the aggregate.
 *
 * The count and the average come from ONE statement, so the header figures and
 * the page cannot disagree about which rows exist.
 */
export async function listReviewsForSubject(
  db: DatabaseOrTransaction,
  subjectOxyUserId: string,
  page: { readonly limit: number; readonly offset: number },
): Promise<SubjectReviewsResult> {
  const where = eq(exchangeReviews.subjectOxyUserId, subjectOxyUserId);
  const [rows, [aggregate]] = await Promise.all([
    db
      .select()
      .from(exchangeReviews)
      .where(where)
      .orderBy(desc(exchangeReviews.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({
        total: sql<number>`count(*)::int`,
        // `round(...)` needs a numeric; `rating` is double precision, hence the
        // cast. `coalesce` makes an empty set 0 rather than NULL, matching the
        // Mongo handler's `aggregate.length > 0 ? … : 0`.
        averageRating: sql<number>`coalesce(round(avg(${exchangeReviews.rating})::numeric, 2), 0)::float8`,
      })
      .from(exchangeReviews)
      .where(where),
  ]);
  return { rows, total: aggregate.total, averageRating: aggregate.averageRating };
}

/**
 * The wire shape the exchange-review screens read.
 *
 * `categories` is RE-NESTED from its four columns, and emitted only when at
 * least one is present — the sub-document never materialized in Mongo when the
 * client sent nothing, so an empty shell would be a new field rather than a
 * preserved one.
 */
export function serializeExchangeReview(row: ExchangeReviewRow): Record<string, unknown> {
  const categories = {
    communication: row.categoriesCommunication,
    cleanliness: row.categoriesCleanliness,
    accuracy: row.categoriesAccuracy,
    hospitality: row.categoriesHospitality,
  };
  const hasCategory = Object.values(categories).some((value) => value !== null);

  return {
    id: row.id,
    exchangeRequestId: row.exchangeRequestId,
    reviewerOxyUserId: row.reviewerOxyUserId,
    subjectOxyUserId: row.subjectOxyUserId,
    rating: row.rating,
    comment: row.comment,
    categories: hasCategory ? categories : undefined,
    isVerified: row.isVerified,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
