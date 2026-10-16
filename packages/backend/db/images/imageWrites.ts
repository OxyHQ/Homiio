/**
 * The image repository — the one place an `images` row is written or removed.
 *
 * Reached from `services/files/publicImages.insertOxyImage` (every photo since
 * the move to Oxy Files), the publish path of `db/properties/propertyWrites`,
 * and the migration and orphan scripts.
 *
 * ## The variants are written together or not at all
 *
 * `urls_*` are all `NOT NULL`, and `images_storage_check` makes the bytes'
 * home one fact: an Oxy file with its owner, status and visibility, or all
 * four legacy `keys_*`. A half-described image cannot be stored.
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
import type { ImageAttribution, ImageEntityType } from '@homiio/shared-types';

export type ImageRow = typeof images.$inferSelect;

/**
 * One photo, plus where the caller wants it.
 *
 * Exactly one home for the bytes: `oxyFile` (every photo written since the move
 * to Oxy Files) or `keys` (a legacy bucket object — only the publish of a
 * photo uploaded before the deploy still produces one). `images_storage_check`
 * refuses a row with neither.
 */
export interface ImageInsert {
  entityType: ImageEntityType;
  entityId: string;
  oxyFile?: { id: string; owner: 'application' | 'account' };
  keys?: { original: string; small: string; medium: string; large: string };
  urls: { original: string; small: string; medium: string; large: string };
  /** Pixel dimensions, when known. */
  width?: number;
  height?: number;
  /**
   * Source format and byte count — REQUIRED, matching their `NOT NULL`
   * columns, so a caller cannot defer a `23502` to runtime.
   */
  format: string;
  bytes: number;
  caption?: string;
  isPrimary?: boolean;
  order?: number;
  /** The credit a licensed photo carries (a Wikimedia cover). */
  attribution?: ImageAttribution;
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
    keysOriginal: input.keys?.original ?? null,
    keysSmall: input.keys?.small ?? null,
    keysMedium: input.keys?.medium ?? null,
    keysLarge: input.keys?.large ?? null,
    oxyFileId: input.oxyFile?.id ?? null,
    oxyFileOwner: input.oxyFile?.owner ?? null,
    oxyFileStatus: input.oxyFile ? 'active' : null,
    oxyFileVisibility: input.oxyFile ? 'public' : null,
    attributionSourceUrl: input.attribution?.sourceUrl ?? null,
    attributionLicense: input.attribution?.license ?? null,
    attributionLicenseUrl: input.attribution?.licenseUrl ?? null,
    attributionAuthor: input.attribution?.author ?? null,
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

/** Several images by id, in no particular order. Missing ids simply do not appear. */
export async function findImagesByIds(
  ids: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<ImageRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(images)
    .where(inArray(images.id, [...ids]));
}

/**
 * An entity's images indexed by their ORIGINAL variant key.
 *
 * The original key is a server-minted `<folder>/<uuid>-original.<ext>`, so it
 * identifies one processed upload exactly. That is what makes re-saving a
 * listing idempotent: a photo uploaded during an edit session and saved twice
 * matches the row the first save minted instead of minting a second one for the
 * same bytes.
 */
export async function findEntityImagesByOriginalKey(
  entityType: ImageEntityType,
  entityId: string,
  originalKeys: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<Map<string, ImageRow>> {
  if (originalKeys.length === 0) return new Map();
  const rows = await db
    .select()
    .from(images)
    .where(
      and(
        eq(images.entityType, entityType),
        eq(images.entityId, entityId),
        inArray(images.keysOriginal, [...originalKeys]),
      ),
    );
  const found = new Map<string, ImageRow>();
  for (const row of rows) if (row.keysOriginal) found.set(row.keysOriginal, row);
  return found;
}

/**
 * The rows of one entity that show these Oxy files, keyed by file id — so a
 * photo saved twice in one edit session reuses the row the first save minted.
 */
export async function findEntityImagesByOxyFileId(
  entityType: ImageEntityType,
  entityId: string,
  fileIds: readonly string[],
  db: DatabaseOrTransaction = getDb(),
): Promise<Map<string, ImageRow>> {
  if (fileIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(images)
    .where(
      and(
        eq(images.entityType, entityType),
        eq(images.entityId, entityId),
        inArray(images.oxyFileId, [...fileIds]),
      ),
    );
  const found = new Map<string, ImageRow>();
  for (const row of rows) if (row.oxyFileId) found.set(row.oxyFileId, row);
  return found;
}

/** The credit stored on a row, or undefined when it carries none. */
export function attributionOf(row: ImageRow): ImageAttribution | undefined {
  if (!row.attributionSourceUrl || !row.attributionLicense) return undefined;
  return {
    sourceUrl: row.attributionSourceUrl,
    license: row.attributionLicense,
    ...(row.attributionLicenseUrl ? { licenseUrl: row.attributionLicenseUrl } : {}),
    ...(row.attributionAuthor ? { author: row.attributionAuthor } : {}),
  };
}

/** Every image belonging to one entity, in the order the entity lists them. */
export async function findImagesForEntity(
  entityType: ImageEntityType,
  entityId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ImageRow[]> {
  return (
    db
      .select()
      .from(images)
      // `(entity_type, entity_id, order)` is the index, so this ordering is free.
      .where(and(eq(images.entityType, entityType), eq(images.entityId, entityId)))
      .orderBy(images.order)
  );
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
