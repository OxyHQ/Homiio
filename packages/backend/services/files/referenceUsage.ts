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
 * And a person's private document stored in their own Oxy account
 * (`privateDocuments.ts`), whose row holds `oxy:<fileId>`:
 *
 * | entity type           | held by                                        |
 * |-----------------------|------------------------------------------------|
 * | `lease`               | a `lease_documents` row (`url`)                |
 * | `tenant_application`  | a `tenant_application_documents` row (`url`)   |
 * | `maintenance_request` | a `maintenance_request_attachments` row (`storage_key`) |
 *
 * And it stops being in use at the moment that row goes: a photo removed from
 * the listing, a listing deleted (by its host or by the expiry sweep, through
 * the cascade), a cover replaced or cleared. Nothing else — an `images` row
 * with no entity showing it is not a use, which is how the orphaned rows of
 * deleted listings stop holding storage (`scripts/cleanOrphanImages.ts`).
 *
 * If a table here gains a row, the trigger set in migration `0037_oxy_files`
 * (photos) or `0038_oxy_private_documents` (documents) gains the matching
 * trigger in the same change, and `FILE_REFERENCE_ENTITY_TYPES` its type.
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
    case 'lease':
      return sql`select d.lease_id as entity_id, substr(d.url, 5) as oxy_file_id
        from lease_documents d where d.url like 'oxy:%'`;
    case 'tenant_application':
      return sql`select d.application_id as entity_id, substr(d.url, 5) as oxy_file_id
        from tenant_application_documents d where d.url like 'oxy:%'`;
    case 'maintenance_request':
      return sql`select a.request_id as entity_id, substr(a.storage_key, 5) as oxy_file_id
        from maintenance_request_attachments a where a.storage_key like 'oxy:%'`;
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

/**
 * The indexed column each type's entity ids live in, as `entity_id`, with the
 * rows that can hold a pair. Every one leads an index (`property_images`'s
 * `property_order` index, a primary key, the documents' entity indexes), so
 * the next page of entity ids is an index walk.
 */
function entityKeysOf(entityType: FileReferenceEntityType): { from: SQL; key: SQL } {
  switch (entityType) {
    case 'property':
      return { from: sql`property_images`, key: sql`property_id` };
    case 'city':
      return { from: sql`cities`, key: sql`id` };
    case 'region':
      return { from: sql`regions`, key: sql`id` };
    case 'eviction_case':
      return { from: sql`eviction_cases`, key: sql`id` };
    case 'lease':
      return { from: sql`lease_documents`, key: sql`lease_id` };
    case 'tenant_application':
      return { from: sql`tenant_application_documents`, key: sql`application_id` };
    case 'maintenance_request':
      return { from: sql`maintenance_request_attachments`, key: sql`request_id` };
  }
}

/** Entities per page of {@link referenceInventory}. */
const INVENTORY_PAGE = 1000;

/**
 * Every pair of one type, streamed in `(entity, file)` order — the inventory a
 * reconciliation sends. Distinct: a listing showing one file twice is one use.
 *
 * Paged by ENTITY, on the source table's own index: the next
 * {@link INVENTORY_PAGE} entity ids after the cursor, then the pairs of
 * exactly that id range. A page touches its own rows and nothing else. Paging
 * the pairs themselves — `(entity_id, oxy_file_id) > cursor` over the join —
 * cannot use an index, so every page re-joined and re-sorted every photo
 * (~2M rows): the 2026-10-20 dry run ran two hours without finishing
 * `property` and was the heaviest statement on the shared database.
 */
export async function* referenceInventory(
  db: DatabaseOrTransaction,
  entityType: FileReferenceEntityType,
  pageSize = INVENTORY_PAGE,
): AsyncGenerator<{ fileId: string; entityId: string }> {
  const { from, key } = entityKeysOf(entityType);
  let after: string | null = null;
  for (;;) {
    const keys: { entity_id: string }[] = await db.execute<{ entity_id: string }>(sql`
      select distinct ${key} as entity_id
      from ${from}
      where ${key} is not null ${after === null ? sql`` : sql`and ${key} > ${after}`}
      order by 1
      limit ${pageSize}
    `);
    if (keys.length === 0) return;
    const last: string = keys[keys.length - 1].entity_id;
    const page = await db.execute<{ entity_id: string; oxy_file_id: string }>(sql`
      select distinct p.entity_id, p.oxy_file_id
      from (${pairsOf(entityType)}) p
      where p.entity_id <= ${last} ${after === null ? sql`` : sql`and p.entity_id > ${after}`}
      order by p.entity_id, p.oxy_file_id
    `);
    for (const row of page) yield { fileId: row.oxy_file_id, entityId: row.entity_id };
    if (keys.length < pageSize) return;
    after = last;
  }
}
