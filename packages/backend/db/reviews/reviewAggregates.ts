/**
 * The seven review rollups — the street → building → unit hierarchy, the agency
 * profile, and the three explore levels.
 *
 * Every one of these was a Mongo aggregation pipeline on `ReviewSchema`, and
 * every one of them opened with `$match: { moderationStatus: { $ne: 'removed' } }`.
 * That is why the seven scoped indexes on `reviews` are PARTIAL on exactly that
 * predicate, and why {@link visibleModeration} spells it as a literal — see
 * `reviewReads.ts`, which records what a bound parameter costs.
 *
 * ## What the collapse removed
 *
 * Three of the pipelines ended in a `$lookup` + `$unwind` against `cities`,
 * `neighborhoods` or `addresses` — Mongo's join, executed per group, with an
 * `$unwind` that silently DROPPED a group whose parent document was missing.
 * Here they are ordinary joins on real foreign keys, so "the city row is
 * missing" is not a state the schema permits and the drop cannot happen.
 *
 * `getStreetViewData`'s `distinct('buildingLevelId')` materialised every
 * distinct building id in the application to take its `.length`;
 * `count(distinct …)` answers it in the server.
 *
 * ## Rounding is applied in the APPLICATION, on purpose
 *
 * `round1` and `roundPct` were JS in the Mongoose statics and are JS here, so
 * the published numbers are bit-identical to what the endpoint returned before.
 * Rounding in SQL with `round(x::numeric, 1)` uses half-away-from-zero on
 * `numeric` while `Math.round` is half-UP on a double — they disagree at exactly
 * the .x5 boundaries an average rating lands on.
 */

import { asc, count, countDistinct, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type {
  AgencyStats,
  ExploreBuildingSummary,
  ExploreCitySummary,
  ExploreNeighborhoodSummary,
} from '@homiio/shared-types';

import { getDb, type DatabaseOrTransaction } from '../postgres';
import { addresses, cities, neighborhoods, reviews } from '../schema';
import { allOfReviews, visibleModeration } from './reviewReads';

/** The three numbers every hierarchy view publishes about a set of reviews. */
export interface ReviewSummaryStats {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
}

/** Round a rating/average to one decimal place. Verbatim from the Mongoose static. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Round a percentage (0-100) to the nearest whole number. Verbatim. */
function roundPct(value: number): number {
  return Math.round(value);
}

function emptySummary(): ReviewSummaryStats {
  return { averageRating: 0, totalReviews: 0, recommendationPercentage: 0 };
}

/**
 * `avg(rating)`, `count(*)` and the recommendation percentage over a set of
 * reviews.
 *
 * `$avg` over `{ $cond: [recommendation, 100, 0] }` is `avg(case when … then 100
 * else 0 end)`, kept as an average rather than rewritten as
 * `count(*) filter (where recommendation) * 100.0 / count(*)`: the two agree on
 * every non-empty set, and keeping the source's shape means the ROUNDING agrees
 * too. Both cast to `double precision`, because Postgres' `avg` returns
 * `numeric` for an integer input and postgres.js hands a `numeric` back as a
 * STRING — which `Math.round` would silently coerce and `round1` would not.
 */
async function summarize(where: SQL | undefined, db: DatabaseOrTransaction): Promise<ReviewSummaryStats> {
  const [row] = await db
    .select({
      averageRating: sql<number | null>`avg(${reviews.rating})::double precision`,
      totalReviews: count(),
      recommendationPercentage: sql<number | null>`avg(case when ${reviews.recommendation} then 100 else 0 end)::double precision`,
    })
    .from(reviews)
    .where(where);

  if (!row || row.totalReviews === 0) return emptySummary();
  return {
    averageRating: row.averageRating ?? 0,
    totalReviews: row.totalReviews,
    recommendationPercentage: row.recommendationPercentage ?? 0,
  };
}

/**
 * The UNIT view: the reviews of this unit, plus a summary of the BUILDING it
 * sits in.
 *
 * The building summary counts only `addressLevel: 'BUILDING'` reviews — reviews
 * about the building itself rather than about its flats — which is the source's
 * behaviour and is what makes it a different number from
 * {@link getBuildingViewData}'s `aggregatedStats`.
 *
 * Mongo read a sample review to discover the building id and returned an empty
 * summary when there was none. The building id is on every one of this unit's
 * reviews and they are already in hand, so the sample read is gone; when the
 * unit has no visible reviews there is no building to summarise, exactly as
 * before.
 */
export async function summarizeBuildingOfUnit(
  buildingLevelId: string | undefined,
  db: DatabaseOrTransaction = getDb(),
): Promise<ReviewSummaryStats> {
  if (buildingLevelId === undefined) return emptySummary();
  return summarize(
    allOfReviews([
      eq(reviews.buildingLevelId, buildingLevelId),
      eq(reviews.addressLevel, 'BUILDING'),
      visibleModeration(),
    ]),
    db,
  );
}

/**
 * Every visible review of one unit — the UNIT view's own stats.
 *
 * `getAddressReviewStats` derived these three numbers in JavaScript, by
 * reducing over the array `getUnitViewData` had already fetched. Computing them
 * in SQL beside the other five summaries is what makes them the SAME numbers the
 * reviews endpoint's `totalReviews` reports: two reducers over two fetches of
 * one set is the shape that drifts.
 */
export async function summarizeUnit(
  unitLevelId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ReviewSummaryStats> {
  return summarize(allOfReviews([eq(reviews.unitLevelId, unitLevelId), visibleModeration()]), db);
}

/** Every visible review in a building, both levels — the BUILDING view's `aggregatedStats`. */
export async function summarizeBuilding(
  buildingLevelId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ReviewSummaryStats> {
  return summarize(
    allOfReviews([eq(reviews.buildingLevelId, buildingLevelId), visibleModeration()]),
    db,
  );
}

/** Every visible review on a street — the STREET view's `aggregatedStats`. */
export async function summarizeStreet(
  streetLevelId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ReviewSummaryStats> {
  return summarize(
    allOfReviews([eq(reviews.streetLevelId, streetLevelId), visibleModeration()]),
    db,
  );
}

/**
 * How many DISTINCT buildings on a street carry a visible review.
 *
 * `count(distinct …)`, where Mongo shipped every distinct id to the application
 * and took `.length`.
 */
export async function countBuildingsOnStreet(
  streetLevelId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const [row] = await db
    .select({ total: countDistinct(reviews.buildingLevelId) })
    .from(reviews)
    .where(allOfReviews([eq(reviews.streetLevelId, streetLevelId), visibleModeration()]));
  return row?.total ?? 0;
}

/**
 * The agency profile header: average rating, review count, recommendation
 * percentage and the share of tenancies whose deposit came back in full.
 *
 * `depositKnownCount` counts rows where `deposit_returned` is present. Mongo
 * spelled it `$in: Object.values(DepositReturn)`, which is the same set:
 * `reviews_deposit_returned_check` admits exactly those three values or NULL, so
 * "in the vocabulary" and "not null" cannot differ. `is not null` is written
 * because it is the one the index and the planner understand.
 */
export async function getAgencyStats(
  agencyId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<AgencyStats> {
  const [row] = await db
    .select({
      averageRating: sql<number | null>`avg(${reviews.rating})::double precision`,
      totalReviews: count(),
      recommendCount: sql<number>`count(*) filter (where ${reviews.recommendation})::int`,
      depositFullCount: sql<number>`count(*) filter (where ${reviews.depositReturned} = 'full')::int`,
      depositKnownCount: sql<number>`count(*) filter (where ${reviews.depositReturned} is not null)::int`,
    })
    .from(reviews)
    .where(allOfReviews([eq(reviews.agencyId, agencyId), visibleModeration()]));

  if (!row || row.totalReviews === 0) {
    return { averageRating: 0, totalReviews: 0, recommendationPercentage: 0, depositFullPct: 0 };
  }
  return {
    averageRating: round1(row.averageRating ?? 0),
    totalReviews: row.totalReviews,
    recommendationPercentage: roundPct((row.recommendCount / row.totalReviews) * 100),
    depositFullPct:
      row.depositKnownCount > 0 ? roundPct((row.depositFullCount / row.depositKnownCount) * 100) : 0,
  };
}

/** EXPLORE, level one: every city that carries a visible review, most-reviewed first. */
export async function getCitiesWithReviews(
  db: DatabaseOrTransaction = getDb(),
): Promise<ExploreCitySummary[]> {
  const rows = await db
    .select({
      cityId: cities.id,
      name: cities.name,
      reviewCount: count(),
      averageRating: sql<number | null>`avg(${reviews.rating})::double precision`,
    })
    .from(reviews)
    .innerJoin(cities, eq(reviews.cityId, cities.id))
    .where(allOfReviews([isNotNull(reviews.cityId), visibleModeration()]))
    .groupBy(cities.id, cities.name)
    // `city_id` second, so a tie between two cities is resolved the same way on
    // every request. Mongo sorted on `reviewCount` alone and its order between
    // equal counts was whatever the pipeline happened to emit — which reads as a
    // list that shuffles itself on refresh.
    .orderBy(desc(count()), asc(cities.id));

  return rows.map((row) => ({
    cityId: row.cityId,
    name: row.name,
    reviewCount: row.reviewCount,
    averageRating: round1(row.averageRating ?? 0),
  }));
}

/** EXPLORE, level two: the neighborhoods of one city that carry a visible review. */
export async function getNeighborhoodSummaries(
  cityId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ExploreNeighborhoodSummary[]> {
  const rows = await db
    .select({
      neighborhoodId: neighborhoods.id,
      name: neighborhoods.name,
      reviewCount: count(),
      averageRating: sql<number | null>`avg(${reviews.rating})::double precision`,
    })
    .from(reviews)
    .innerJoin(neighborhoods, eq(reviews.neighborhoodId, neighborhoods.id))
    .where(
      allOfReviews([
        eq(reviews.cityId, cityId),
        isNotNull(reviews.neighborhoodId),
        visibleModeration(),
      ]),
    )
    .groupBy(neighborhoods.id, neighborhoods.name)
    .orderBy(desc(count()), asc(neighborhoods.id));

  return rows.map((row) => ({
    neighborhoodId: row.neighborhoodId,
    name: row.name,
    reviewCount: row.reviewCount,
    averageRating: round1(row.averageRating ?? 0),
  }));
}

/** One page of {@link getBuildingSummaries}, plus how many buildings there are in total. */
export interface BuildingSummariesResult {
  buildings: ExploreBuildingSummary[];
  total: number;
}

/**
 * EXPLORE, level three: the buildings of one neighborhood, paginated.
 *
 * Mongo used a `$facet` to get the page and the total from one pipeline. Two
 * statements here rather than a window function: the count is over GROUPS, so
 * the window form (`count(*) over ()` beside the grouped rows) would have to
 * survive the `LIMIT`, and a `$facet`'s two branches were never one scan either.
 *
 * The address `leftJoin` is deliberate where the geo joins elsewhere in this
 * module are inner: `building_level_id` references `addresses` with `ON DELETE
 * RESTRICT`, so the row is always there — but a building whose street is somehow
 * unreadable must still appear with its rating rather than vanish from the list,
 * which is what an inner join would do and what Mongo's `preserveNullAndEmptyArrays`
 * was there to prevent.
 */
export async function getBuildingSummaries(
  input: { neighborhoodId: string; page: number; limit: number },
  db: DatabaseOrTransaction = getDb(),
): Promise<BuildingSummariesResult> {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, input.limit);
  const where = allOfReviews([
    eq(reviews.neighborhoodId, input.neighborhoodId),
    visibleModeration(),
  ]);

  const [totals] = await db
    .select({ total: countDistinct(reviews.buildingLevelId) })
    .from(reviews)
    .where(where);

  const rows = await db
    .select({
      buildingLevelId: reviews.buildingLevelId,
      street: addresses.street,
      number: addresses.number,
      reviewCount: count(),
      averageRating: sql<number | null>`avg(${reviews.rating})::double precision`,
      recommendCount: sql<number>`count(*) filter (where ${reviews.recommendation})::int`,
    })
    .from(reviews)
    .leftJoin(addresses, eq(reviews.buildingLevelId, addresses.id))
    .where(where)
    .groupBy(reviews.buildingLevelId, addresses.street, addresses.number)
    .orderBy(desc(count()), asc(reviews.buildingLevelId))
    .limit(limit)
    .offset((page - 1) * limit);

  return {
    total: totals?.total ?? 0,
    buildings: rows.map((row) => ({
      buildingLevelId: row.buildingLevelId,
      street: row.street ?? '',
      number: row.number ?? undefined,
      reviewCount: row.reviewCount,
      averageRating: round1(row.averageRating ?? 0),
      recommendationPercentage:
        row.reviewCount > 0 ? roundPct((row.recommendCount / row.reviewCount) * 100) : 0,
    })),
  };
}
