/**
 * The nearby-services cache — one row per rounded coordinate cell, plus its
 * per-category counts.
 *
 * Ported from `models/schemas/PlacePoiSchema.ts`, whose whole job was to keep
 * Homiio off Overpass: a lookup is an equality on `cell_key`, which is why the
 * coordinates are rounded before they become one.
 *
 * ## The categories are a CHILD TABLE, not an array
 *
 * Mongo embedded `categories[]` on the document. `place_poi_categories`
 * normalizes it, with `UNIQUE(place_poi_id, key)` and CHECKs tying `present`,
 * `count` and `nearest_m` together — three views of one measurement that the
 * embedded array let disagree (`present: false` alongside `count: 5` was
 * representable). So a write REPLACES the child rows rather than assigning an
 * array, and it does both halves in one transaction: a cell whose parent
 * refreshed while its categories did not is a cache that confidently serves the
 * wrong answer, which is worse than a miss.
 *
 * ## The TTL index became a registry entry, and that is the load-bearing part
 *
 * `PlacePoiSchema` carried `{ expiresAt: 1 }, { expireAfterSeconds: 0 }` —
 * Mongo reaped the cache itself. Postgres has no TTL index, so `db/expiry.ts`
 * registers `place_pois.expires_at` and a sweep does it instead. Without that
 * registration this table grows forever, with no error and no failing test —
 * which is why the entry is checked in rather than left to whoever notices.
 * `place_poi_categories` needs no entry of its own: its reference is
 * `ON DELETE CASCADE`, so the sweep takes the categories with the cell.
 */

import { and, eq } from 'drizzle-orm';
import type { NearbyServiceCategory, NearbyServiceKey } from '@homiio/shared-types';

import { getDb } from '../postgres';
import { placePoiCategories, placePois } from '../schema';
import type { DatabaseOrTransaction } from '../postgres';

/** One cached cell, in the shape the service reads. */
export interface CachedCell {
  categories: NearbyServiceCategory[];
  expiresAt: Date;
}

/**
 * Read a cached cell by its key, fresh or stale.
 *
 * Freshness is deliberately NOT decided here. The service serves a stale cell
 * as a degraded fallback when Overpass is unavailable, so it needs the deadline
 * rather than a boolean — a repository that filtered on `expires_at` would make
 * that fallback unreachable and turn an outage into an all-absent answer.
 */
export async function findCachedCell(
  cellKey: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<CachedCell | null> {
  const [cell] = await db
    .select({ id: placePois.id, expiresAt: placePois.expiresAt })
    .from(placePois)
    .where(eq(placePois.cellKey, cellKey))
    .limit(1);
  if (!cell) return null;

  const rows = await db
    .select({
      key: placePoiCategories.key,
      present: placePoiCategories.present,
      count: placePoiCategories.count,
      nearestM: placePoiCategories.nearestM,
    })
    .from(placePoiCategories)
    .where(eq(placePoiCategories.placePoiId, cell.id));

  return {
    expiresAt: cell.expiresAt,
    categories: rows.map((row) => ({
      key: row.key as NearbyServiceKey,
      present: row.present,
      count: row.count,
      nearestM: row.nearestM,
    })) as NearbyServiceCategory[],
  };
}

/**
 * Upsert a freshly fetched cell and replace its categories.
 *
 * Idempotent on `place_pois_cell_key_key`, so two concurrent refreshes of the
 * same cell converge on one row rather than racing — the same guarantee the
 * Mongo `{ upsert: true }` on `cellKey` gave, now enforced by an index instead
 * of by the write being the only one in flight.
 *
 * ONE transaction, because the parent and its categories are one snapshot.
 */
export async function upsertCachedCell(input: {
  cellKey: string;
  lat: number;
  lng: number;
  radiusM: number;
  categories: readonly NearbyServiceCategory[];
  fetchedAt: Date;
  expiresAt: Date;
}): Promise<void> {
  await getDb().transaction(async (tx) => {
    const [cell] = await tx
      .insert(placePois)
      .values({
        cellKey: input.cellKey,
        lat: input.lat,
        lng: input.lng,
        radiusM: input.radiusM,
        fetchedAt: input.fetchedAt,
        expiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        target: placePois.cellKey,
        set: {
          lat: input.lat,
          lng: input.lng,
          radiusM: input.radiusM,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
        },
      })
      .returning({ id: placePois.id });

    // Replaced wholesale rather than diffed: a snapshot is what Overpass just
    // said about that cell, and a category it no longer reports has to
    // disappear rather than linger at its old count.
    await tx.delete(placePoiCategories).where(eq(placePoiCategories.placePoiId, cell.id));
    if (input.categories.length === 0) return;
    await tx.insert(placePoiCategories).values(
      input.categories.map((category) => ({
        placePoiId: cell.id,
        key: category.key,
        present: category.present,
        count: category.count,
        nearestM: category.nearestM,
      })),
    );
  });
}

/** Drop one cached cell. Its categories go with it (`ON DELETE CASCADE`). */
export async function deleteCachedCell(
  cellKey: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const deleted = await db
    .delete(placePois)
    .where(and(eq(placePois.cellKey, cellKey)))
    .returning({ id: placePois.id });
  return deleted.length > 0;
}
