/**
 * `images` rows that nothing shows — and the sweep that removes them.
 *
 * ## The defect this closes, at its root
 *
 * An `images` row is written when a photo is stored; what SHOWS it is a
 * `property_images` row or a `cover_image_id`. Those go away on their own —
 * a host replaces a photo, the expiry sweep deletes a listing and its photo
 * rows CASCADE — but `images.entity_id` cannot carry a foreign key (it is
 * polymorphic), so nothing ever removed the `images` row behind them. The
 * census found 948 such rows from listing expiry alone, each still holding
 * four objects in the bucket. Nothing in Homiio counted them, so nothing
 * would ever have stopped them.
 *
 * Now a row nothing shows is deleted 24 hours after it was written (the grace
 * covers an ingest that stores photos minutes before it attaches them, and a
 * publish in flight), nightly by `services/cron.ts` and on demand by
 * `scripts/cleanOrphanImages.ts` (preview by default, `--apply` to delete).
 *
 * Deleting the row is all Homiio does about the bytes. The use of the file was
 * already withdrawn from Oxy when the row stopped being shown (the triggers of
 * migration `0037_oxy_files`), so Oxy trashes a Homiio-owned file 24 hours
 * later and deletes it 30 days after that, and a person's own upload becomes
 * "not in use" in their file manager — theirs to keep or delete. A legacy row's
 * objects go with the bucket when it is retired (`docs/oxy-files.md`).
 *
 * "Shown" is the same set of pointers `services/files/referenceUsage.ts`
 * registers; a new pointer to `images` must be added to both.
 */

import { sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';

/** How long a row may exist unshown before it counts as unused. */
export const UNUSED_IMAGE_GRACE_HOURS = 24;

/** The condition "nothing shows this row", over the alias `i`. */
const UNSHOWN = sql`
  not exists (select 1 from property_images pi where pi.image_id = i.id)
  and not exists (select 1 from cities c where c.cover_image_id = i.id)
  and not exists (select 1 from regions r where r.cover_image_id = i.id)
  and not exists (select 1 from eviction_cases e where e.cover_image_id = i.id)
`;

export interface UnusedImageCount {
  entityType: string;
  /** `oxy` when the row names an Oxy file, `legacy` when only bucket keys. */
  storage: 'oxy' | 'legacy';
  rows: number;
}

/** How many unused rows there are, by entity type and storage — the preview. */
export async function countUnusedImages(
  db: DatabaseOrTransaction,
  graceHours = UNUSED_IMAGE_GRACE_HOURS,
): Promise<UnusedImageCount[]> {
  const rows = await db.execute<{
    entity_type: string;
    storage: 'oxy' | 'legacy';
    rows: string;
  }>(sql`
    select i.entity_type,
           case when i.oxy_file_id is null then 'legacy' else 'oxy' end as storage,
           count(*)::text as rows
    from images i
    where i.created_at < now() - make_interval(hours => ${graceHours})
      and ${UNSHOWN}
    group by 1, 2
    order by 1, 2
  `);
  return rows.map((row) => ({
    entityType: row.entity_type,
    storage: row.storage,
    rows: Number(row.rows),
  }));
}

/**
 * Delete up to `limit` unused rows, returning their ids. The "unshown"
 * condition is re-checked by the DELETE itself, so a row that a listing
 * started showing since it was counted is kept; one that a publish is
 * attaching at this instant is serialized by the foreign key's lock, and
 * either the publish or the delete waits for the other.
 */
export async function deleteUnusedImages(
  db: DatabaseOrTransaction,
  options: { limit: number; graceHours?: number },
): Promise<string[]> {
  const graceHours = options.graceHours ?? UNUSED_IMAGE_GRACE_HOURS;
  const rows = await db.execute<{ id: string }>(sql`
    delete from images
    where id in (
      select i.id from images i
      where i.created_at < now() - make_interval(hours => ${graceHours})
        and ${UNSHOWN}
      order by i.created_at
      limit ${options.limit}
      for update of i skip locked
    )
    and not exists (select 1 from property_images pi where pi.image_id = images.id)
    and not exists (select 1 from cities c where c.cover_image_id = images.id)
    and not exists (select 1 from regions r where r.cover_image_id = images.id)
    and not exists (select 1 from eviction_cases e where e.cover_image_id = images.id)
    returning id
  `);
  return rows.map((row) => row.id);
}

/** Sweep in batches until nothing is left or `maxRows` went. Returns how many went. */
export async function sweepUnusedImages(
  db: DatabaseOrTransaction,
  options: { batchSize?: number; maxRows?: number; graceHours?: number } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 1000;
  const maxRows = options.maxRows ?? 100_000;
  let deleted = 0;
  while (deleted < maxRows) {
    const ids = await deleteUnusedImages(db, {
      limit: Math.min(batchSize, maxRows - deleted),
      graceHours: options.graceHours,
    });
    deleted += ids.length;
    if (ids.length === 0) break;
  }
  return deleted;
}
