/**
 * Which (file, entity) pairs Homiio USES — the one definition, read by the
 * drain (`referenceSync.ts`) for a single pair and by the nightly
 * reconciliation (`referenceReconcile.ts`) for a whole entity type.
 *
 * A pair is in use while the entity shows a photo whose `images` row names the
 * file:
 *
 * | entity type     | shown through                         |
 * |-----------------|---------------------------------------|
 * | `property`      | a `property_images` row of the listing |
 * | `city`          | `cities.cover_image_id`               |
 * | `region`        | `regions.cover_image_id`              |
 * | `eviction_case` | `eviction_cases.cover_image_id`       |
 *
 * And it stops being in use at the moment that row goes: a photo removed from
 * the listing, a listing deleted (by its host or by the expiry sweep, through
 * the cascade), a cover replaced or cleared. Nothing else — an `images` row
 * with no entity showing it is not a use, which is how the orphaned rows of
 * deleted listings stop holding storage (`scripts/cleanOrphanImages.ts`).
 *
 * If this table gains a row, the trigger set in migration `0037_oxy_files`
 * gains the matching trigger in the same change, and
 * `FILE_REFERENCE_ENTITY_TYPES` its type.
 */

import { sql, type SQL } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../../db/postgres';
import type { FILE_REFERENCE_ENTITY_TYPES } from '../../db/schema/oxyFiles';

export type FileReferenceEntityType = (typeof FILE_REFERENCE_ENTITY_TYPES)[number];

/** The `(entity_id, oxy_file_id)` pairs of one type, as a subquery. */
function pairsOf(entityType: FileReferenceEntityType): SQL {
  switch (entityType) {
    case 'property':
      return sql`select pi.property_id as entity_id, i.oxy_file_id
        from property_images pi join images i on i.id = pi.image_id
        where i.oxy_file_id is not null`;
    case 'city':
      return sql`select c.id as entity_id, i.oxy_file_id
        from cities c join images i on i.id = c.cover_image_id
        where i.oxy_file_id is not null`;
    case 'region':
      return sql`select r.id as entity_id, i.oxy_file_id
        from regions r join images i on i.id = r.cover_image_id
        where i.oxy_file_id is not null`;
    case 'eviction_case':
      return sql`select e.id as entity_id, i.oxy_file_id
        from eviction_cases e join images i on i.id = e.cover_image_id
        where i.oxy_file_id is not null`;
  }
}

/** Whether one pair is in use right now. */
export async function isReferenceInUse(
  db: DatabaseOrTransaction,
  pair: { oxyFileId: string; entityType: FileReferenceEntityType; entityId: string },
): Promise<boolean> {
  const rows = await db.execute<{ used: boolean }>(sql`
    select exists (
      select 1 from (${pairsOf(pair.entityType)}) p
      where p.entity_id = ${pair.entityId} and p.oxy_file_id = ${pair.oxyFileId}
    ) as used
  `);
  return rows[0]?.used === true;
}

/** Page size of {@link referenceInventory}: one reconciliation page. */
const INVENTORY_PAGE = 1000;

/**
 * Every pair of one type, streamed in keyset order — the inventory a
 * reconciliation sends. Distinct: a listing showing one file twice is one use.
 */
export async function* referenceInventory(
  db: DatabaseOrTransaction,
  entityType: FileReferenceEntityType,
): AsyncGenerator<{ fileId: string; entityId: string }> {
  let after: { entityId: string; fileId: string } | null = null;
  for (;;) {
    const cursor: SQL = after
      ? sql`where (p.entity_id, p.oxy_file_id) > (${after.entityId}, ${after.fileId})`
      : sql``;
    const page = await db.execute<{ entity_id: string; oxy_file_id: string }>(sql`
      select distinct p.entity_id, p.oxy_file_id
      from (${pairsOf(entityType)}) p
      ${cursor}
      order by p.entity_id, p.oxy_file_id
      limit ${INVENTORY_PAGE}
    `);
    for (const row of page) yield { fileId: row.oxy_file_id, entityId: row.entity_id };
    if (page.length < INVENTORY_PAGE) return;
    const last = page[page.length - 1];
    after = { entityId: last.entity_id, fileId: last.oxy_file_id };
  }
}
