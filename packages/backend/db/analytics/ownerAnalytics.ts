/**
 * The owner analytics rollup — views, saves and viewing requests on a person's
 * own listings.
 *
 * A module of its own rather than functions bolted onto
 * `db/saved/*` or `db/properties/*`: these are CROSS-domain aggregates that
 * belong to no single table's repository, and adding them to somebody else's
 * would make three modules co-own one endpoint's shape.
 *
 * ## The endpoint has always returned zeros, and this is where that is fixed
 *
 * `analyticsController` selected the caller's listings with
 * `Property.distinct('_id', { profileId: activeProfile._id, … })` — and
 * **`PropertySchema` declares no `profileId`**. It has `oxyUserId` and nothing
 * else that names an owner. Mongo matches no document against an undeclared
 * field, so `propertyIds` was ALWAYS empty; the views and saves aggregates were
 * guarded by `propertyIds.length ? … : Promise.resolve([])` and therefore never
 * ran at all, and the viewing rollup matched `ownerOxyUserId` against a PROFILE
 * id, which is a different id space again.
 *
 * So every number this endpoint reports has been 0 since it was written. Fixing
 * the owner key is what makes the port meaningful — porting the reads while
 * leaving the selector broken would move three queries to Postgres and still
 * return zeros, which is worse than not porting them, because it looks done.
 *
 * **This is a user-visible behaviour change**, in the same class as the two
 * `db/MIGRATION-CONTRACT.md` already names — `properties.views` starting to
 * increment, and the saved-listing count starting to be non-zero once both
 * sides of the comparison are `text`. Real numbers appearing where zeros were is
 * correct behaviour arriving, not a defect to diagnose.
 */

import { and, count, countDistinct, desc, eq, gte, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { addresses, cities, properties, recentlyViewed, regions, savedItems } from '../schema';

/**
 * The ids of the listings this person owns, excluding archived ones.
 *
 * `oxy_user_id` is the owner column — see the header for why the Mongo original
 * matched nothing.
 */
export async function listOwnedPropertyIds(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: properties.id })
    .from(properties)
    .where(and(eq(properties.oxyUserId, oxyUserId), ne(properties.status, 'archived')));
  return rows.map((row) => row.id);
}

export interface ViewRollup {
  readonly total: number;
  readonly uniqueViewers: number;
}

/**
 * Views of `propertyIds` since `since`.
 *
 * `countDistinct` on the viewer, where Mongo used `$addToSet` then `$size` —
 * the same question, answered without materialising the set. Note the source
 * grouped `$addToSet: '$profileId'` on a collection whose column is
 * `oxy_user_id`; that path does not exist either, so the unique count was
 * `[null]`, i.e. 1, on any row it had ever seen. It counts the owner column now.
 */
export async function countViewsOfProperties(
  db: DatabaseOrTransaction,
  propertyIds: readonly string[],
  since: Date,
): Promise<ViewRollup> {
  if (propertyIds.length === 0) return { total: 0, uniqueViewers: 0 };
  const [row] = await db
    .select({
      total: count(),
      uniqueViewers: countDistinct(recentlyViewed.oxyUserId),
    })
    .from(recentlyViewed)
    .where(
      and(
        inArray(recentlyViewed.propertyId, [...propertyIds]),
        gte(recentlyViewed.viewedAt, since),
      ),
    );
  return { total: row.total, uniqueViewers: row.uniqueViewers };
}

/**
 * App-wide saved-listing totals: how many saves, and how many distinct people.
 *
 * `uniqueSavers` had the SAME defect as the owner selector above and for the
 * same reason: `Saved.distinct('profileId', …)` on a schema whose column is
 * `oxyUserId`, so it has always answered 0. `count_distinct` on the real owner
 * column is what it was trying to say.
 */
export async function countAppWideSaves(
  db: DatabaseOrTransaction,
): Promise<{ total: number; uniqueSavers: number }> {
  const [row] = await db
    .select({ total: count(), uniqueSavers: countDistinct(savedItems.oxyUserId) })
    .from(savedItems)
    .where(eq(savedItems.targetType, 'property'));
  return { total: row.total, uniqueSavers: row.uniqueSavers };
}

/** Saves of `propertyIds` since `since`. */
export async function countSavesOfProperties(
  db: DatabaseOrTransaction,
  propertyIds: readonly string[],
  since: Date,
): Promise<number> {
  if (propertyIds.length === 0) return 0;
  const [row] = await db
    .select({ total: count() })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.targetType, 'property'),
        inArray(savedItems.targetId, [...propertyIds]),
        gte(savedItems.createdAt, since),
      ),
    );
  return row.total;
}

/** The app-wide totals the public stats endpoint leads with. */
export async function countAppWideCatalogue(
  db: DatabaseOrTransaction,
): Promise<{ properties: number; cities: number }> {
  // Two independent counts, so two statements — there is no join between them
  // and a single query would need a cross product to produce both.
  const [propertyRow] = await db.select({ total: count() }).from(properties);
  const [cityRow] = await db.select({ total: count() }).from(cities);
  return { properties: propertyRow.total, cities: cityRow.total };
}

/**
 * Long-term rent min / max / average across the whole catalogue.
 *
 * `> 0` rather than "field exists": a listing with no long-term price has NULL
 * in that column, and including it would drag the average toward zero. This is
 * the same predicate the Mongo `$match` used, said against a column.
 */
export async function summarizeCatalogueRent(
  db: DatabaseOrTransaction,
): Promise<{ averageRent: number; minRent: number; maxRent: number }> {
  const [row] = await db
    .select({
      averageRent: sql<number | null>`avg(${properties.longTermRentMonthlyAmount})`,
      minRent: sql<number | null>`min(${properties.longTermRentMonthlyAmount})`,
      maxRent: sql<number | null>`max(${properties.longTermRentMonthlyAmount})`,
    })
    .from(properties)
    .where(sql`${properties.longTermRentMonthlyAmount} > 0`);
  // postgres.js returns `numeric` aggregates as STRINGS — `min`/`max` over a
  // `double precision` come back numeric, and an un-coerced value would reach
  // `Math.round` as a string and read as `NaN`.
  return {
    averageRent: Number(row?.averageRent ?? 0),
    minRent: Number(row?.minRent ?? 0),
    maxRent: Number(row?.maxRent ?? 0),
  };
}

/** One row of the "most listed cities" table. */
export interface TopCity {
  cityId: string;
  city: string | null;
  state: string | null;
  properties: number;
  averageRent: number;
}

/**
 * The cities with the most listings, with each city's average long-term rent.
 *
 * ONE statement. The Mongo pipeline needed three `$lookup` + `$unwind` pairs —
 * into `addresses`, then `cities`, then `regions` — because it could not join;
 * grouping by the canonical `city_id` rather than a free-text city name was
 * already the intent and is now simply what the query does.
 */
export async function findTopCitiesByListings(
  db: DatabaseOrTransaction,
  limit: number,
): Promise<TopCity[]> {
  const rows = await db
    .select({
      cityId: addresses.cityId,
      city: cities.name,
      state: regions.name,
      properties: count(),
      averageRent: sql<number | null>`avg(${properties.longTermRentMonthlyAmount})`,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .leftJoin(cities, eq(addresses.cityId, cities.id))
    .leftJoin(regions, eq(addresses.regionId, regions.id))
    .where(isNotNull(addresses.cityId))
    .groupBy(addresses.cityId, cities.name, regions.name)
    .orderBy(desc(count()))
    .limit(limit);

  return rows.map((row) => ({
    cityId: String(row.cityId),
    city: row.city,
    state: row.state,
    properties: row.properties,
    averageRent: Number(row.averageRent ?? 0),
  }));
}

/**
 * How many listings fall in each preset monthly-rent band.
 *
 * `width_bucket` over the same boundaries the Mongo `$bucket` used. Bucket 0
 * (below the first boundary) cannot occur because the predicate excludes
 * negative rents, and `boundaries.length` is the overflow band — the
 * `default: '10000+'` the pipeline declared.
 *
 * Written as ONE raw statement rather than a `.select()` projection, and that is
 * load-bearing: inside a projection drizzle renders an interpolated column
 * UNQUALIFIED, so the same expression appeared as `"long_term_rent_monthly_amount"`
 * in the SELECT and `"properties"."long_term_rent_monthly_amount"` in the
 * GROUP BY, and Postgres rejected it as not grouped. A standalone `sql` renders
 * both sides qualified and identical.
 */
export async function countListingsByPriceBucket(
  db: DatabaseOrTransaction,
  boundaries: readonly number[],
): Promise<Map<number, number>> {
  const bounds = sql.join(
    boundaries.map((boundary) => sql`${boundary}`),
    sql`, `,
  );
  const rows = await db.execute<{ bucket: number; total: number }>(sql`
    select
      width_bucket(${properties.longTermRentMonthlyAmount}, array[${bounds}]::double precision[]) as bucket,
      count(*)::int as total
    from ${properties}
    where ${properties.longTermRentMonthlyAmount} >= 0
    group by bucket
  `);
  return new Map([...rows].map((row) => [Number(row.bucket), Number(row.total)]));
}
