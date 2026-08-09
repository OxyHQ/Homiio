/**
 * The image repository — the one place an `images` row is written or removed.
 *
 * Ported from `models/schemas/ImageSchema.ts`'s single writer,
 * `imageUploadService.createImageForEntity`, which the census located as the
 * only `Image` INSERT in the product (reached from `imageController`,
 * `ExternalMediaIngest` and `scripts/seedImages`).
 *
 * ## The eight variant columns are written together or not at all
 *
 * `keys_*` and `urls_*` are all `NOT NULL`: the Sharp pipeline produces the four
 * variants as a set, and `imageUploadService.assertCompleteVariants` already
 * refuses a partial one before it reaches storage. Flattening the two Mongo
 * subdocuments into eight columns is what makes that a schema fact rather than
 * a convention — a half-processed image cannot be stored at all.
 *
 * ## `entity_id` carries no foreign key, permanently
 *
 * One column cannot reference five tables, so `images.entity_id` is the sole
 * permanent entry in `deferredForeignKeys.ts`'s
 * `ID_COLUMNS_WITHOUT_FOREIGN_KEY`. The consequence for THIS module is that
 * deleting an owner does not cascade here — `deleteImagesForEntity` is how a
 * caller cleans up, and `property_images.image_id` (which DOES carry a
 * RESTRICT reference) is what stops an image vanishing from under a listing
 * that still lists it.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { getDb } from '../postgres';
import { images } from '../schema';
import type { DatabaseOrTransaction } from '../postgres';
import type { ImageEntityType } from '@homiio/shared-types';

export type ImageRow = typeof images.$inferSelect;

/** Everything the Sharp pipeline produced, plus where the caller wants it. */
export interface ImageInsert {
  entityType: ImageEntityType;
  entityId: string;
  keys: { original: string; small: string; medium: string; large: string };
  urls: { original: string; small: string; medium: string; large: string };
  /** Pixel dimensions, when Sharp could read them off the source. */
  width?: number;
  height?: number;
  /**
   * Source format and byte count.
   *
   * REQUIRED, matching their `NOT NULL` columns: the Sharp pipeline derives
   * both on every path (`format` falls back to the declared mimetype, `bytes`
   * is the processed original's length), so an optional member here would only
   * let a caller defer a `23502` to runtime.
   */
  format: string;
  bytes: number;
  caption?: string;
  isPrimary?: boolean;
  order?: number;
}

/**
 * Persist one processed image.
 *
 * The defaults for `isPrimary` and `order` are applied here rather than left to
 * the column defaults, because `createImageForEntity` applied them and a caller
 * passing `undefined` means "the caller did not care", not "leave it unset".
 */
export async function insertImage(
  input: ImageInsert,
  db: DatabaseOrTransaction = getDb(),
): Promise<ImageRow> {
  // Bound to a typed const rather than passed as an object literal: `db` is a
  // UNION of the root connection and a transaction handle, and drizzle's
  // `.values()` has two overloads (one row, or many). Against a union receiver
  // TypeScript resolves the literal against the ARRAY overload and reports
  // every column as unknown; a value that already has the row type picks the
  // right one. Same reason `db/leases/leaseReads.ts` precomputes its columns.
  const values: typeof images.$inferInsert = {
    entityType: input.entityType,
    entityId: input.entityId,
    keysOriginal: input.keys.original,
    keysSmall: input.keys.small,
    keysMedium: input.keys.medium,
    keysLarge: input.keys.large,
    urlsOriginal: input.urls.original,
    urlsSmall: input.urls.small,
    urlsMedium: input.urls.medium,
    urlsLarge: input.urls.large,
    width: input.width,
    height: input.height,
    format: input.format,
    bytes: input.bytes,
    caption: input.caption,
    isPrimary: input.isPrimary ?? false,
    order: input.order ?? 0,
  };

  const [created] = await db.insert(images).values(values).returning();
  return created;
}

/** One image by id, or null. */
export async function findImageById(
  id: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ImageRow | null> {
  const rows = await db.select().from(images).where(eq(images.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Every image belonging to one entity, in the order the entity lists them. */
export async function findImagesForEntity(
  entityType: ImageEntityType,
  entityId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ImageRow[]> {
  return db
    .select()
    .from(images)
    // `(entity_type, entity_id, order)` is the index, so this ordering is free.
    .where(and(eq(images.entityType, entityType), eq(images.entityId, entityId)))
    .orderBy(images.order);
}

/**
 * Delete images by id, returning how many rows went.
 *
 * A caller deleting an image still referenced by `property_images` gets a
 * foreign-key violation rather than a listing pointing at nothing — that
 * RESTRICT is deliberate and this function does not work around it.
 */
export async function deleteImagesByIds(
  ids: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(images)
    .where(inArray(images.id, [...ids]))
    .returning({ id: images.id });
  return deleted.length;
}

/** Delete every image belonging to one entity. */
export async function deleteImagesForEntity(
  entityType: ImageEntityType,
  entityId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const deleted = await db
    .delete(images)
    .where(and(eq(images.entityType, entityType), eq(images.entityId, entityId)))
    .returning({ id: images.id });
  return deleted.length;
}
