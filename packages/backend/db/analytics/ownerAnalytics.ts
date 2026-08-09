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

import { and, count, countDistinct, eq, gte, inArray, ne } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { properties, recentlyViewed, savedItems } from '../schema';

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
