/**
 * `recently_viewed` — the listings a person has looked at, on Postgres.
 *
 * Ported from `models/schemas/RecentlyViewedSchema.ts`. The collection held **0
 * documents in production** (measured), and the reason is not that nobody uses
 * the feature — see "The write path was dead" below.
 *
 * ## This table is APPEND-HEAVY, and its bound is 90 days
 *
 * It is the only table in this domain that grows on READS rather than on
 * deliberate user action, so it is the one that leaks if nothing prunes it.
 * Mongo bounded it in exactly one way, and this port keeps that way and invents
 * no other:
 *
 *  - **A 90-day retention sweep**, `services/cleanupService.cleanupOldData()`,
 *    run from `services/cron.ts`. {@link pruneRecentlyViewedBefore} is its
 *    Postgres half; `RECENTLY_VIEWED_RETENTION_DAYS` stays in `cleanupService`,
 *    where the ViewingRequest window it sits beside also lives.
 *  - **There is NO per-user row cap**, and none is invented here. Mongo had
 *    none: the cap a reader might remember is the `?limit=` on the READ
 *    (default 10), which bounds the response and not the table. Adding one
 *    would be a new product rule wearing a migration's clothes.
 *
 * The unique key does most of the work regardless: one row per person per
 * listing, so a user's row count is bounded by the number of DISTINCT listings
 * they have opened in 90 days, not by how many times they opened them.
 * `ON DELETE CASCADE` on `property_id` removes the rest — a reaped external ad
 * takes its view rows with it.
 *
 * ## The write path was dead, which is why the table measured 0
 *
 * Two independent breaks, and each alone was enough:
 *
 *  - `trackPropertyView` was routed ONLY at
 *    `POST /api/properties/:propertyId/track-view`, which no client calls, while
 *    `packages/frontend/services/recentlyViewedService.ts` posted to
 *    `POST /api/profiles/me/recent-properties/:propertyId`, which no router
 *    served. The service caught the 404 and returned `{ success: false }`, so
 *    nothing surfaced. The FIX IS SERVER-SIDE — the second spelling is now
 *    mounted on the same handler — because a shipped mobile build cannot be
 *    recalled, and correcting only the client would leave every installed app
 *    still writing nothing.
 *  - `controllers/property/retrieve.ts` also upserts a view, keyed
 *    `{ profileId, propertyId }` — and `profileId` is not a field of
 *    `RecentlyViewedSchema`, so mongoose strict mode drops it while the required
 *    `oxyUserId` is never supplied. That write is left ALONE here: it is one of
 *    the two Mongo writes that file's header reserves for the write batch.
 *
 * The consequence is deliberate and worth stating plainly: this table starts
 * receiving rows for the first time, which is precisely what the 90-day sweep
 * above exists to bound.
 */

import { desc, eq, lt } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';
import { recentlyViewed } from '../schema';
import { isForeignKeyViolation } from '../uniqueViolation';

export type RecentlyViewedRow = typeof recentlyViewed.$inferSelect;

/**
 * The listing whose view is being recorded does not exist.
 *
 * `recently_viewed_property_id_properties_id_fk` refuses the row rather than
 * letting a view point at nothing, and the controller turns this into a 404.
 */
export class ViewedPropertyNotFoundError extends Error {
  constructor(readonly propertyId: string) {
    super(`Property ${propertyId} does not exist, so a view of it cannot be recorded.`);
    this.name = 'ViewedPropertyNotFoundError';
  }
}

/**
 * Record that this person opened this listing.
 *
 * The Mongo handler read for an existing row and then either `save()`d it or
 * constructed a new one — a read-then-write two concurrent opens of the same
 * listing both pass, which then fails on the unique index anyway.
 * `recently_viewed_owner_property_key` makes it one statement.
 *
 * `viewed_at` and `updated_at` both move, and `created_at` deliberately does
 * not: it is when the listing was FIRST opened, which is a different fact from
 * when it was last opened, and the read orders by the latter.
 */
export async function trackPropertyView(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  propertyId: string,
): Promise<RecentlyViewedRow> {
  const viewedAt = new Date();
  try {
    const [row] = await db
      .insert(recentlyViewed)
      .values({ oxyUserId, propertyId, viewedAt })
      .onConflictDoUpdate({
        target: [recentlyViewed.oxyUserId, recentlyViewed.propertyId],
        set: { viewedAt },
      })
      .returning();
    return row;
  } catch (error) {
    if (isForeignKeyViolation(error, 'recently_viewed_property_id_properties_id_fk')) {
      throw new ViewedPropertyNotFoundError(propertyId);
    }
    throw error;
  }
}

/**
 * The listings this person opened most recently, newest first.
 *
 * The Mongo handler de-duplicated the result into a `Map` keyed by property id
 * after reading. That is not ported: the unique key makes a second row for the
 * same `(owner, listing)` pair unrepresentable, so the de-duplication could only
 * ever have been a no-op — and re-implementing it would hide a broken index
 * rather than reveal one.
 *
 * @param limit How many rows to return. Bounds the RESPONSE only; see the header
 *   on why the table's own bound is the retention sweep.
 */
export async function listRecentlyViewed(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  limit: number,
): Promise<readonly RecentlyViewedRow[]> {
  return db
    .select()
    .from(recentlyViewed)
    .where(eq(recentlyViewed.oxyUserId, oxyUserId))
    .orderBy(desc(recentlyViewed.viewedAt))
    .limit(limit);
}

/** Forget one person's whole history. Returns how many rows went. */
export async function clearRecentlyViewed(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<number> {
  const rows = await db
    .delete(recentlyViewed)
    .where(eq(recentlyViewed.oxyUserId, oxyUserId))
    .returning({ id: recentlyViewed.id });
  return rows.length;
}

/**
 * The retention sweep: drop every view older than `cutoff`, for every person.
 *
 * Deliberately NOT scoped to an owner — this is the table's only bound, and it
 * has to run across all of them. `recently_viewed_owner_viewed_at_idx` leads
 * with `oxy_user_id`, so this is a sequential scan; that is the right trade for
 * a job that runs from cron against a table whose live set is 90 days wide, and
 * it is what the Mongo `deleteMany` did too.
 *
 * @param cutoff Rows with `viewed_at` strictly before this are removed.
 * @returns How many rows went.
 */
export async function pruneRecentlyViewedBefore(
  db: DatabaseOrTransaction,
  cutoff: Date,
): Promise<number> {
  const rows = await db
    .delete(recentlyViewed)
    .where(lt(recentlyViewed.viewedAt, cutoff))
    .returning({ id: recentlyViewed.id });
  return rows.length;
}
