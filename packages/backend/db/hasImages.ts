/**
 * `properties.has_images` — the ONE place it is written, and the check that
 * proves it stayed true.
 *
 * ## Why a denormalized flag exists at all in a schema that forbids them
 *
 * `CONVENTIONS.md` says Mongo's join-less workarounds do not travel, and a
 * counter maintained beside the thing it counts is the archetype of one. This
 * column is the deliberate exception, and the reason is that the honest
 * relational spelling is not merely slower here — it is unindexable.
 *
 * `has_images` is the PRIMARY SORT KEY of every discovery feed
 * (`{ hasImages: -1, createdAt: -1 }` in Mongo, `properties_has_images_created_at_idx`
 * here). Written honestly, that sort is
 *
 *   ORDER BY EXISTS (SELECT 1 FROM property_images pi WHERE pi.property_id = p.id) DESC,
 *            p.created_at DESC
 *
 * — a CORRELATED SUBQUERY in an `ORDER BY`, which Postgres can no more serve
 * from an index than Mongo could. Every page of the main feed becomes a full
 * sort of the table. So the flag stays, and pays for itself by carrying an
 * obligation instead of a promise:
 *
 *  1. **One writer.** {@link syncHasImages} is it. No controller, service,
 *     backfill or script assigns the column directly, and it is absent from
 *     `CREATABLE_PROPERTY_FIELDS` / `EDITABLE_PROPERTY_FIELDS` so no request
 *     body can reach it either.
 *  2. **Derived, never copied** — including by the backfill. Production already
 *     holds a row where the stored flag disagrees with its own array
 *     (`6a515dd9c196de4ad2a8550e`, `fotocasa/190185722`: `hasImages: false`
 *     with twelve images), so copying the stored value would import a
 *     known-wrong answer. That id carries `expiresAt: 2026-08-09`, which makes
 *     it useful for VERIFYING the derivation ran and useless as a hand-written
 *     exception — if the cutover falls after that date the TTL will have swept
 *     it and a named rule would point at nothing.
 *  3. **Reconcilable.** {@link findHasImagesDisagreements} answers "has it
 *     drifted?" in one query. A denormalized value with no way to detect drift
 *     is a value that will drift, and nothing will say so.
 *
 * ## This replaces a HOOK, not a controller
 *
 * Mongoose maintained the flag in `propertySchema.pre('save')` and a second
 * `pre(['findOneAndUpdate','updateOne','updateMany'])` that re-derived it
 * whenever an update happened to mention `images`. Both are schema behaviour,
 * which is why their replacement lives beside the schema rather than in a
 * service — and why the replacement is one function rather than two: a hook
 * that only fires when the caller mentions a field is a hook that silently does
 * not fire, and the array it watched is now a table with its own writes.
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

/**
 * Re-derive `has_images` for EVERY listing, in one statement.
 *
 * For the backfill (which must derive the flag rather than copy it) and for
 * repairing a drift {@link findHasImagesDisagreements} reported. Not for a
 * request path: it writes every row.
 *
 * @returns How many listings the statement changed.
 */
export async function syncAllHasImages(db: DatabaseOrTransaction): Promise<number> {
  const rows = await db
    .update(properties)
    .set({ hasImages: hasPhotoRow() })
    // Touch only the rows that are actually wrong: `updated_at` carries
    // `$onUpdate`, so an unconditional rewrite would restamp every listing in
    // the table with the migration's own clock and destroy the ordering the
    // historical value carries.
    .where(ne(properties.hasImages, hasPhotoRow()))
    .returning({ id: properties.id });

  return rows.length;
}
