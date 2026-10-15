/**
 * `properties.has_images` — the ONE place it is written, and the check that
 * proves it stayed true.
 *
 * ## Why a denormalized flag exists at all in a schema that forbids them
 *
 * `CONVENTIONS.md` says a queryable relation is not copied onto its parent, and
 * a flag maintained beside the thing it summarises is the archetype of one.
 * This column is the deliberate exception, and the reason is that the honest
 * relational spelling is not merely slower here — it is unindexable.
 *
 * `has_images` is the PRIMARY SORT KEY of every discovery feed
 * (`properties_has_images_created_at_idx`). Written honestly, that sort is
 *
 *   ORDER BY EXISTS (SELECT 1 FROM property_images pi WHERE pi.property_id = p.id) DESC,
 *            p.created_at DESC
 *
 * — a CORRELATED SUBQUERY in an `ORDER BY`, which Postgres cannot serve from an
 * index. Every page of the main feed becomes a full
 * sort of the table. So the flag stays, and pays for itself by carrying an
 * obligation instead of a promise:
 *
 *  1. **One writer.** {@link syncHasImages} is it. No controller, service,
 *     or script assigns the column directly, and it is absent from
 *     `CREATABLE_PROPERTY_FIELDS` / `EDITABLE_PROPERTY_FIELDS` so no request
 *     body can reach it either.
 *  2. **Derived, never copied.** A stored flag can disagree with its own photo
 *     rows, so it is always recomputed from them rather than trusted.
 *  3. **Atomic with the photo write.** Every `property_images` write goes
 *     through `replacePropertyImages`, which runs the delete, the insert and
 *     {@link syncHasImages} in ONE transaction. A crash between them rolls all
 *     three back, so there is no window in which the photos changed and the
 *     flag did not.
 *  4. **Auditable.** {@link findHasImagesDisagreements} answers "has it
 *     drifted?" in one query, and the tests assert it.
 *
 * ## Why there is no periodic reconcile
 *
 * There was one: every API task re-derived the flag for the WHOLE table on boot,
 * a Mongo-era safety net. On production (156,912 listings, 1.9M photo rows) it
 * was a sequential scan with a correlated probe per row — ~771k buffer reads,
 * 0.8 s with a warm cache, and 40-80 s of mostly-IO load on the shared RDS per
 * deploy, because both tasks booted and ran it at once — and in thirty days of
 * logs it repaired ZERO rows. The guarantee belongs at write time (3 above),
 * where it costs one indexed row update, not on a schedule.
 *
 * ## Schema behaviour, so it lives beside the schema
 *
 * Maintaining the flag is a property of the table, which is why it lives here
 * rather than in a service — and why it is one function rather than one per
 * write path: logic that only runs when the caller mentions a field is logic
 * that silently does not run.
 *
 * ## The one path this cannot cover, stated rather than hidden
 *
 * `property_images.property_id` is `ON DELETE CASCADE`, so deleting a property
 * removes its photo rows without any application code running. That is
 * harmless — the row whose flag it would have updated is gone in the same
 * statement. The direction that WOULD be a problem, an `images` delete taking
 * `property_images` rows with it, cannot happen: `property_images.image_id` is
 * `ON DELETE RESTRICT` precisely so that deleting an image has to go through
 * code, and therefore through here.
 */

import { eq, ne, sql, type SQL } from 'drizzle-orm';
import { qualified } from './casing';
import type { DatabaseOrTransaction } from './postgres';
import { properties, propertyImages } from './schema';

/**
 * A listing whose stored `has_images` disagrees with its photo rows.
 */
export interface HasImagesDisagreement {
  readonly propertyId: string;
  /** What the column says. */
  readonly stored: boolean;
  /** What the child rows say. */
  readonly actual: boolean;
}

/**
 * The truth: does this listing have at least one photo row?
 *
 * Written once and reused by all three functions below, because the whole
 * point of a single chokepoint is defeated if the three of them can spell the
 * derivation differently.
 *
 * `qualified` on the correlated reference, never the bare column. A drizzle
 * column interpolated into a subquery renders BARE when its table is not in
 * that subquery's own `FROM`, so the obvious
 * `${propertyImages.propertyId} = ${properties.id}` emits
 * `where "property_id" = "id"` — both resolving against `property_images`,
 * comparing two of its own columns to each other, matching nothing, and
 * raising no error whatsoever. That exact shape shipped in the sibling oxy-api
 * port, where it read as "every profile has zero followers".
 */
function hasPhotoRow(): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from ${propertyImages}
    where ${propertyImages.propertyId} = ${qualified(properties.id)}
  )`;
}

/**
 * Re-derive `has_images` for one listing from its photo rows.
 *
 * Call after EVERY `property_images` insert or delete, in the same transaction
 * as the write. Idempotent, and safe to call when nothing changed.
 *
 * @param db A database handle or an open transaction. Takes
 *   {@link DatabaseOrTransaction} rather than `Database` on purpose: a helper
 *   typed only as `Database` forces its caller to run OUTSIDE the transaction
 *   the photo write is in, which is exactly how a derived value stops being
 *   atomic with what it derives from.
 * @returns The value the column now holds.
 */
export async function syncHasImages(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<boolean> {
  const [row] = await db
    .update(properties)
    .set({ hasImages: hasPhotoRow() })
    .where(eq(properties.id, propertyId))
    .returning({ hasImages: properties.hasImages });

  return row?.hasImages ?? false;
}

/**
 * Every listing whose `has_images` disagrees with its photo rows.
 *
 * The reconciliation half of the trade-off above. Returns an empty array for a
 * consistent database, which is what makes a single `toEqual([])` the whole
 * assertion.
 *
 * Deliberately UNBOUNDED: this is a correctness audit, not a page. A `LIMIT`
 * would make "no disagreements" and "no disagreements in the first N" the same
 * answer.
 */
export async function findHasImagesDisagreements(
  db: DatabaseOrTransaction,
): Promise<HasImagesDisagreement[]> {
  const rows = await db
    .select({
      propertyId: properties.id,
      stored: properties.hasImages,
      actual: hasPhotoRow(),
    })
    .from(properties)
    .where(ne(properties.hasImages, hasPhotoRow()));

  return rows.map((row) => ({
    propertyId: row.propertyId,
    stored: row.stored,
    actual: row.actual,
  }));
}
