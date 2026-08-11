/**
 * The nearby-services cache, against a REAL Postgres.
 *
 * ## Why this suite exists
 *
 * `nearbyServicesService` had NO test coverage at all before this — the whole
 * Overpass-avoidance path, including its persistence, was unexercised. That is
 * the same gap that let a live 500 sit unreported on the dated availability
 * feed, so it is worth closing while the persistence is being replaced rather
 * than after.
 *
 * ## What is genuinely different about the Postgres shape
 *
 * Mongo embedded `categories[]` on the document, so a write was one assignment
 * and could not half-happen. `place_poi_categories` is a child table, which
 * makes two things newly possible and therefore worth pinning:
 *
 *  - a refresh that updates the cell but leaves the OLD categories behind — a
 *    cache that confidently serves the wrong answer, which is worse than a miss;
 *  - a category the new snapshot no longer reports LINGERING at its old count,
 *    because a diff was written instead of a replace.
 *
 * Both cases below seed a first snapshot and overwrite it with a different one,
 * so a repository that appended, or that skipped the child write, fails. A test
 * that only wrote once could not tell any of those apart.
 */

import type { NearbyServiceCategory } from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { placePoiCategories, placePois } from '../../db/schema';
import {
  deleteCachedCell,
  findCachedCell,
  upsertCachedCell,
} from '../../db/placePois/placePoiRepository';

const CELL_KEY = '41.387,2.169@1500';

function categories(overrides: Partial<NearbyServiceCategory>[] = []): NearbyServiceCategory[] {
  return overrides.map((override) => ({
    key: 'pharmacy',
    present: true,
    count: 1,
    nearestM: 100,
    ...override,
  })) as NearbyServiceCategory[];
}

async function write(
  cellCategories: NearbyServiceCategory[],
  expiresAt = new Date(Date.now() + 60_000),
): Promise<void> {
  await upsertCachedCell({
    cellKey: CELL_KEY,
    lat: 41.387,
    lng: 2.169,
    radiusM: 1500,
    categories: cellCategories,
    fetchedAt: new Date(),
    expiresAt,
  });
}

/** How many cells and category rows exist, for the duplication assertions. */
async function counts(): Promise<{ cells: number; categoryRows: number }> {
  const cells = await getDb().select({ id: placePois.id }).from(placePois);
  const rows = await getDb().select({ id: placePoiCategories.id }).from(placePoiCategories);
  return { cells: cells.length, categoryRows: rows.length };
}

beforeEach(async () => {
  // Categories first: the reference is CASCADE, so this is not strictly
  // required — but deleting the parent alone would silently rely on that, and
  // the point of the teardown is to leave nothing behind either way.
  await getDb().delete(placePoiCategories);
  await getDb().delete(placePois);
});

describe('place POI cache', () => {
  it('round-trips a cell and its categories', async () => {
    await write(
      categories([
        { key: 'pharmacy', present: true, count: 3, nearestM: 120.5 },
        { key: 'school', present: false, count: 0, nearestM: null },
      ]),
    );

    const cell = await findCachedCell(CELL_KEY);
    expect(cell).not.toBeNull();
    expect(cell?.categories).toHaveLength(2);
    expect(cell?.categories).toEqual(
      expect.arrayContaining([
        { key: 'pharmacy', present: true, count: 3, nearestM: 120.5 },
        // The absent case matters on its own: `present: false` with a NULL
        // distance is what the service serves when nothing is nearby, and a
        // repository that dropped nulls would report a pharmacy-shaped hole.
        { key: 'school', present: false, count: 0, nearestM: null },
      ]),
    );
  });

  it('REPLACES categories on refresh rather than appending or leaving them', async () => {
    await write(categories([{ key: 'pharmacy', count: 3 }, { key: 'school', count: 9 }]));
    await write(categories([{ key: 'pharmacy', count: 5 }]));

    const cell = await findCachedCell(CELL_KEY);
    // `school` is gone because the new snapshot did not report it — not left at
    // its old count, which is what a diff-style write would do.
    expect(cell?.categories).toEqual([
      { key: 'pharmacy', present: true, count: 5, nearestM: 100 },
    ]);

    // And one cell, one row: the upsert converges rather than duplicating.
    expect(await counts()).toEqual({ cells: 1, categoryRows: 1 });
  });

  it('converges on one cell when the same key is written twice', async () => {
    // `place_pois_cell_key_key` is what makes two concurrent refreshes of the
    // same cell safe. Written sequentially here because the guarantee under
    // test is the index, not the scheduling.
    await write(categories([{ key: 'pharmacy' }]));
    await write(categories([{ key: 'pharmacy' }]));

    expect(await counts()).toEqual({ cells: 1, categoryRows: 1 });
  });

  it('returns an expired cell rather than hiding it', async () => {
    // Freshness is the SERVICE's decision, not the repository's: a stale cell is
    // served as a degraded fallback when Overpass is unavailable. A repository
    // that filtered on `expires_at` would make that fallback unreachable and
    // turn an outage into an all-absent answer.
    await write(categories([{ key: 'pharmacy' }]), new Date(Date.now() - 60_000));

    const cell = await findCachedCell(CELL_KEY);
    expect(cell).not.toBeNull();
    expect(cell?.expiresAt.getTime()).toBeLessThan(Date.now());
    expect(cell?.categories).toHaveLength(1);
  });

  it('answers null for a key nobody has cached', async () => {
    expect(await findCachedCell('0.000,0.000@1')).toBeNull();
  });

  it('takes the categories with the cell when it is deleted', async () => {
    // The expiry sweep deletes the PARENT; the categories go with it because the
    // reference is ON DELETE CASCADE. If it were RESTRICT the sweep would abort
    // on its first batch and the cache would grow forever — which is the failure
    // the whole expiry registry exists to prevent, so it is asserted rather than
    // assumed from the schema.
    await write(categories([{ key: 'pharmacy' }, { key: 'school' }]));
    expect(await counts()).toEqual({ cells: 1, categoryRows: 2 });

    expect(await deleteCachedCell(CELL_KEY)).toBe(true);
    expect(await counts()).toEqual({ cells: 0, categoryRows: 0 });
  });

  it('reports false when deleting a cell that is not there', async () => {
    expect(await deleteCachedCell('0.000,0.000@1')).toBe(false);
  });
});
