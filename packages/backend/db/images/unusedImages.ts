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

/** How many ids one keyset window looks at. */
const SWEEP_WINDOW = 5000;

/**
 * Delete the unused rows among the next `window` ids after `afterId`, and say
 * how far the scan got (`scannedThrough`, null once it reached the end).
 *
 * A KEYSET walk, not "the oldest N unused rows": that query had to find every
 * unused row in the table to sort them, so each batch of 1,000 rescanned all
 * two million rows — the 171k-row backlog took about 2.5 minutes a batch and
 * held a shared RDS instance at 75% CPU for what would have been nine hours.
 * A window is one `images_pkey` range probed through the four pointer indexes
 * (tens of milliseconds), and the sweep is one pass over the table.
 *
 * "Shown by nothing" is decided again in the DELETE, under the row lock, so a
 * row attached since the window was read is never deleted.
 */
export async function deleteUnusedImages(
  db: DatabaseOrTransaction,
  options: { afterId?: string | null; window?: number; graceHours?: number } = {},
): Promise<{ deleted: string[]; scannedThrough: string | null }> {
  const graceHours = options.graceHours ?? UNUSED_IMAGE_GRACE_HOURS;
  const window = options.window ?? SWEEP_WINDOW;
  const rows = await db.execute<{ through: string | null; ids: string[] | null }>(sql`
    with scanned as (
      select id, created_at from images
      where id > ${options.afterId ?? ''}
      order by id
      limit ${window}
    ),
    doomed as (
      select i.id from images i
      join scanned s on s.id = i.id
      where s.created_at < now() - make_interval(hours => ${graceHours})
        and ${UNSHOWN}
      for update of i skip locked
    ),
    deleted as (
      delete from images
      where id in (select id from doomed)
        and not exists (select 1 from property_images pi where pi.image_id = images.id)
        and not exists (select 1 from cities c where c.cover_image_id = images.id)
        and not exists (select 1 from regions r where r.cover_image_id = images.id)
        and not exists (select 1 from eviction_cases e where e.cover_image_id = images.id)
      returning id
    )
    select (select max(id) from scanned) as through,
           (select array_agg(id order by id) from deleted) as ids
  `);
  const [row] = rows;
  return { deleted: row?.ids ?? [], scannedThrough: row?.through ?? null };
}

/**
 * One pass over the table, deleting every unused row, until the end or until
 * at least `maxRows` went (checked per window, so it may overshoot by less
 * than one window). Returns how many went.
 */
export async function sweepUnusedImages(
  db: DatabaseOrTransaction,
  options: {
    maxRows?: number;
    graceHours?: number;
    window?: number;
    onWindow?: (deleted: readonly string[]) => void;
  } = {},
): Promise<number> {
  const maxRows = options.maxRows ?? Number.MAX_SAFE_INTEGER;
  let deleted = 0;
  let afterId: string | null = null;
  while (deleted < maxRows) {
    const result = await deleteUnusedImages(db, {
      afterId,
      window: options.window,
      graceHours: options.graceHours,
    });
    deleted += result.deleted.length;
    options.onWindow?.(result.deleted);
    if (result.scannedThrough === null) break;
    afterId = result.scannedThrough;
  }
  return deleted;
}
