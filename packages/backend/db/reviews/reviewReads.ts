/**
 * The review READ repository — every review list and every single-review read.
 *
 * One place issues the review SELECT, so the address join, the agency join and
 * the two helpful-vote derivations cannot be spelled differently by the six
 * handlers that need them.
 *
 * ## The moderation predicate is a LITERAL, and that is the whole point
 *
 * Seven of the ten indexes on `reviews` are PARTIAL on exactly
 * `moderation_status <> 'removed'`, because every public read and every
 * aggregation begins with that filter. A partial index can only serve a query
 * whose predicate the planner can PROVE implies the index's own, and the
 * measured behaviour is narrower than "a parameter never works":
 *
 *  - Under a CUSTOM plan the parameter's value is known, so
 *    `ne(reviews.moderationStatus, REMOVED)` keeps the index too.
 *  - Under a GENERIC plan — what the cache generalises a repeated statement into
 *    — the value is a `Param`, the implication is unprovable, and the query
 *    falls onto a different index with `moderation_status <> $1` demoted to a
 *    Filter and an explicit `Sort` on top.
 *
 * So writing the value inline emits a `Const` and keeps the seven indexes
 * reachable in BOTH plan modes. Spelled identically to `db/schema/reviews.ts`,
 * and asserted against real plans in `__tests__/db/reviewAggregates.test.ts` —
 * which had to force `plan_cache_mode` to see any difference at all.
 *
 * ## The helpful count is counted IN SQL, per review
 *
 * `helpfulVoters[]` was an embedded array whose LENGTH was the count and whose
 * MEMBERSHIP was `viewerHasVotedHelpful`. As a table, the honest equivalents are
 * a correlated `count(*)` and a correlated `exists` — not a join, which would
 * multiply the review row by its vote count and break both `LIMIT` and the
 * page's own count.
 *
 * `count(*)` and `count(distinct oxy_user_id)` are the same number here ONLY
 * because `review_helpful_votes_review_user_key` exists; the CORRELATION is what
 * makes either honest. An uncorrelated count is the mistake that reads as
 * plausible — every review reporting the same total — and
 * `__tests__/db/reviewWrites.test.ts` carries the fixture that tells the two
 * apart: one voter across two reviews plus a second voter on one of them.
 * "Two votes by two people" agrees with both and pins nothing.
 */

import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';

import { getDb, type DatabaseOrTransaction } from '../postgres';
import { qualified } from '../casing';
import {
  addresses,
  agencies,
  cities,
  countries,
  neighborhoods,
  regions,
  reviewHelpfulVotes,
  reviews,
} from '../schema';
import { ADDRESS_GEO_NAME_COLUMNS, toAddressWithGeoNames } from '../addresses/addressSerializer';
import type { HydratedReview, ReviewAgencySummary } from './reviewSerializer';

/**
 * A review that is not `removed`.
 *
 * A FUNCTION rather than a shared constant, matching `propertyFilters.ts`: a
 * `SQL` fragment carries its own state and must not be handed to two statements.
 */
export function visibleModeration(): SQL {
  return sql`${reviews.moderationStatus} <> 'removed'`;
}

/** Newest first — the ordering of every review list. */
export const NEWEST_REVIEWS_FIRST = desc(reviews.createdAt);

export interface ReviewReadOptions {
  where?: SQL;
  orderBy?: SQL[];
  limit?: number;
  offset?: number;
  /**
   * The requesting user, for `viewerHasVotedHelpful`.
   *
   * Absent means "nobody is asking" and the flag is a SQL `false` literal rather
   * than an `exists` against an impossible id — one selection shape either way,
   * so the row type does not depend on a runtime flag.
   */
  viewer?: string | null;
}

/**
 * Read reviews with their address, geo names, agency and helpful counters.
 *
 * `innerJoin` on `addresses` is safe and deliberate: `reviews.address_id` is
 * `NOT NULL` with an `ON DELETE RESTRICT` foreign key, so it can neither drop a
 * review nor multiply one. `leftJoin` on `agencies`, which is genuinely
 * optional.
 */
export async function findReviews(
  options: ReviewReadOptions,
  db: DatabaseOrTransaction = getDb(),
): Promise<HydratedReview[]> {
  const viewer = options.viewer;

  // `qualified` on both correlated references. Whether it is load-bearing
  // depends on the SURROUNDING statement, not on the subquery — measured against
  // this drizzle version by rendering both forms rather than reasoned about:
  //
  //   joins present:  "review_helpful_votes"."review_id" = "reviews"."id"   (both forms)
  //   single-table:   "review_id" = "id"    bare   vs   … = "reviews"."id"  qualified
  //
  // So with the six joins below a bare `${reviews.id}` happens to render
  // qualified, and this call is currently a no-op. It stays because the property
  // it buys is INDEPENDENCE from that: `review_helpful_votes` has an `id` too, so
  // the day somebody removes a join the bare form silently correlates a table to
  // ITSELF and every review reports the same count with no error at all.
  // `db/schema/CONVENTIONS.md` records that trap as one that already shipped in
  // the sibling oxy-api port; `db/properties/propertyWrites.ts` measured it here.
  //
  // Note what the suite can and cannot see: removing `qualified` from this
  // statement leaves `__tests__/db/reviewWrites.test.ts` GREEN, because the
  // joins mask it. What that file does pin is the CORRELATION — replacing this
  // with an uncorrelated `count(distinct oxy_user_id)` turns three of its cases
  // red on the "one voter across two reviews plus a second voter" fixture.
  const query = db
    .select({
      review: reviews,
      address: addresses,
      ...ADDRESS_GEO_NAME_COLUMNS,
      agencyId: agencies.id,
      agencyName: agencies.name,
      agencySlug: agencies.slug,
      helpfulCount: sql<number>`(
        select count(*)::int from ${reviewHelpfulVotes}
        where ${reviewHelpfulVotes.reviewId} = ${qualified(reviews.id)}
      )`,
      viewerHasVotedHelpful: viewer
        ? sql<boolean>`exists (
            select 1 from ${reviewHelpfulVotes}
            where ${reviewHelpfulVotes.reviewId} = ${qualified(reviews.id)}
              and ${reviewHelpfulVotes.oxyUserId} = ${viewer}
          )`
        : sql<boolean>`false`,
    })
    .from(reviews)
    .innerJoin(addresses, eq(reviews.addressId, addresses.id))
    .leftJoin(agencies, eq(reviews.agencyId, agencies.id))
    .leftJoin(cities, eq(addresses.cityId, cities.id))
    .leftJoin(regions, eq(addresses.regionId, regions.id))
    .leftJoin(countries, eq(addresses.countryId, countries.id))
    .leftJoin(neighborhoods, eq(addresses.neighborhoodId, neighborhoods.id))
    .where(options.where)
    .$dynamic();

  if (options.orderBy && options.orderBy.length > 0) query.orderBy(...options.orderBy);
  if (options.limit !== undefined) query.limit(options.limit);
  if (options.offset !== undefined) query.offset(options.offset);

  const rows = await query;

  return rows.map((row) => {
    const agency: ReviewAgencySummary | null =
      row.agencyId !== null && row.agencyName !== null && row.agencySlug !== null
        ? { id: row.agencyId, name: row.agencyName, slug: row.agencySlug }
        : null;
    return {
      review: row.review,
      address: toAddressWithGeoNames(row),
      agency,
      helpfulCount: row.helpfulCount,
      viewerHasVotedHelpful: row.viewerHasVotedHelpful,
    };
  });
}

/**
 * How many reviews satisfy `where`.
 *
 * No joins: nothing any caller filters on lives outside `reviews`, and joining
 * `addresses` here only to mirror the page query would make the count depend on
 * a row it never reads.
 */
export async function countReviews(
  where?: SQL,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const [row] = await db.select({ total: count() }).from(reviews).where(where);
  return row?.total ?? 0;
}

/**
 * One review by id, hydrated, with NO visibility filter.
 *
 * The caller decides: `getReviewById` shows a `removed` review to its author and
 * 404s it for everyone else, which is a decision about the VIEWER and not about
 * the row.
 */
export async function findReviewById(
  reviewId: string,
  viewer?: string | null,
  db: DatabaseOrTransaction = getDb(),
): Promise<HydratedReview | null> {
  const [found] = await findReviews({ where: eq(reviews.id, reviewId), limit: 1, viewer }, db);
  return found ?? null;
}

// ── Predicates ──

/** Reviews written by one person. */
export function byAuthor(oxyUserId: string): SQL {
  return eq(reviews.oxyUserId, oxyUserId);
}

/** Reviews attributed to one agency. */
export function ofAgency(agencyId: string): SQL {
  return eq(reviews.agencyId, agencyId);
}

/**
 * Reviews attached to one exact address.
 *
 * Distinct from {@link atUnitLevel} / {@link atBuildingLevel}, which are ROLLUP
 * keys: this is the column `reviews_author_address_key` is built on, so it is
 * the one the duplicate answer path asks about.
 */
export function atAddress(addressId: string): SQL {
  return eq(reviews.addressId, addressId);
}

/** Reviews of one unit — the port of `Review.findByUnitLevel`. */
export function atUnitLevel(unitLevelId: string): SQL {
  return eq(reviews.unitLevelId, unitLevelId);
}

/**
 * Reviews anywhere in one building — the port of `Review.findByBuildingLevel`.
 *
 * There is deliberately no street-level twin. `Review.findByStreetLevel` had
 * ZERO callers: the street view is an aggregate (`summarizeStreet` /
 * `countBuildingsOnStreet`) and never lists individual reviews, so porting the
 * finder would have created an exported predicate nothing asks for.
 */
export function atBuildingLevel(buildingLevelId: string): SQL {
  return eq(reviews.buildingLevelId, buildingLevelId);
}

/** BUILDING or UNIT — the two levels a review may be attached at. */
export type ReviewAddressLevel = (typeof reviews.$inferSelect)['addressLevel'];

/** Reviews attached at one level of the hierarchy. */
export function levelIs(addressLevel: ReviewAddressLevel): SQL {
  return eq(reviews.addressLevel, addressLevel);
}

/**
 * Combine predicates, ignoring the absent ones.
 *
 * Mirrors `propertyReads.allOf`: `undefined` for an empty list rather than an
 * always-true clause, so the result can go straight to `.where()`.
 */
export function allOfReviews(conditions: readonly (SQL | undefined)[]): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : and(...present);
}
