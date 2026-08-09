/**
 * `saved_items` — a person's saved listings, on Postgres.
 *
 * Ported from `models/schemas/SavedSchema.ts`. The collection held **0 documents
 * in production** (measured against `homiio-production`, not assumed), so this
 * port has no backfill and no consistency window.
 *
 * ## Three read-then-write races became one `ON CONFLICT`
 *
 * `saveProperty` was an `updateOne(..., { upsert: true })`, which Mongo makes
 * atomic only because the compound index existed. `saved_items_owner_target_key`
 * is the same rule as a real UNIQUE, so the port is a single
 * `INSERT ... ON CONFLICT DO UPDATE` and the "already saved?" question is never
 * asked in a separate statement.
 *
 * ## `notes` is NULL when absent — both writers now agree
 *
 * The Mongo handlers disagreed with each other: `saveProperty` stored
 * `notes || null` and `updateSavedPropertyNotes` stored `notes || ''`, so "no
 * note" was `null` or `''` depending on which endpoint last touched the row.
 * `db/schema/CONVENTIONS.md` refuses a `''` default precisely because an empty
 * string is a VALUE and NULL is the absence, and `saved_items.notes` is nullable
 * with no default. {@link normalizeNotes} is the ONE place that decision is
 * applied, so both writers store the same thing.
 *
 * The WIRE is unchanged: {@link toSavedPropertyFields} emits `''` for a null
 * note, exactly as the Mongo handler's `row.notes || ''` did.
 *
 * ## Deleting a folder is the FOREIGN KEY's job now
 *
 * `deleteSavedPropertyFolder` used to run
 * `Saved.updateMany({ folderId }, { $set: { folderId: null } })` before removing
 * the folder. `saved_items.folder_id` is declared `ON DELETE SET NULL`, so the
 * server does exactly that in the same statement that drops the folder — and it
 * cannot be forgotten by a second call site. There is deliberately no
 * `clearFolderAssignment` here: adding one would re-create, in application code,
 * a rule the schema already carries.
 */

import { and, count, desc, eq, inArray } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';
import { savedItems } from '../schema';
import { isForeignKeyViolation } from '../uniqueViolation';

export type SavedItemRow = typeof savedItems.$inferSelect;

/**
 * The listing being saved does not exist.
 *
 * Mongo stored `target_id` as a bare string with nothing behind it, so saving a
 * listing that had just been reaped succeeded and left a pointer to nothing.
 * `saved_items_target_id_properties_id_fk` refuses that row, and this is the
 * 404 the caller earned rather than the 500 the raw `23503` would be.
 */
export class SavedPropertyNotFoundError extends Error {
  constructor(readonly propertyId: string) {
    super(`Property ${propertyId} does not exist, so it cannot be saved.`);
    this.name = 'SavedPropertyNotFoundError';
  }
}

/**
 * Store "no note" as NULL rather than as an empty string.
 *
 * Trimmed as well as emptied: mongoose's `trim` has no Postgres counterpart and
 * `CONVENTIONS.md` says it is re-applied where the value enters. A note of
 * `'   '` is not a note.
 */
function normalizeNotes(notes: string | null | undefined): string | null {
  if (typeof notes !== 'string') return null;
  const trimmed = notes.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface SavePropertyInput {
  readonly oxyUserId: string;
  readonly propertyId: string;
  readonly notes?: string | null;
  /** `null` files the save outside any folder. */
  readonly folderId?: string | null;
}

/**
 * Save a listing, or update the save that is already there.
 *
 * `created_at` is rewritten on a repeat, which is what the Mongo upsert did
 * (`$set: { ..., createdAt: new Date() }`). It is the "saved at" the list is
 * ordered by, so re-saving — including moving a listing to another folder —
 * moves it back to the top, and that is the behaviour the saved screen has
 * always had.
 */
export async function saveProperty(
  db: DatabaseOrTransaction,
  input: SavePropertyInput,
): Promise<SavedItemRow> {
  const notes = normalizeNotes(input.notes);
  const folderId = input.folderId ?? null;
  const savedAt = new Date();

  try {
    const [row] = await db
      .insert(savedItems)
      .values({
        oxyUserId: input.oxyUserId,
        targetType: 'property',
        targetId: input.propertyId,
        notes,
        folderId,
        createdAt: savedAt,
      })
      .onConflictDoUpdate({
        target: [savedItems.oxyUserId, savedItems.targetType, savedItems.targetId],
        set: { notes, folderId, createdAt: savedAt },
      })
      .returning();
    return row;
  } catch (error) {
    if (isForeignKeyViolation(error, 'saved_items_target_id_properties_id_fk')) {
      throw new SavedPropertyNotFoundError(input.propertyId);
    }
    throw error;
  }
}

/** Every listing this person has saved, most recently saved first. */
export async function listSavedProperties(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<readonly SavedItemRow[]> {
  return db
    .select()
    .from(savedItems)
    .where(and(eq(savedItems.oxyUserId, oxyUserId), eq(savedItems.targetType, 'property')))
    .orderBy(desc(savedItems.createdAt));
}

/**
 * How many people have saved each of these listings.
 *
 * A POPULARITY signal across all users, so it is deliberately NOT scoped to one
 * `oxy_user_id` the way every other read in this module is — the feed uses it to
 * rank, not to show anybody their own saves.
 *
 * @returns A count per listing id. A listing nobody has saved is ABSENT from the
 *   map rather than present as `0`, matching `countSavedPropertiesByFolder`; the
 *   caller's `?? 0` supplies the empty case.
 */
export async function countSavesByPropertyIds(
  db: DatabaseOrTransaction,
  propertyIds: readonly string[],
): Promise<Map<string, number>> {
  if (propertyIds.length === 0) return new Map();

  const rows = await db
    .select({ propertyId: savedItems.targetId, total: count() })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.targetType, 'property'),
        inArray(savedItems.targetId, [...propertyIds]),
      ),
    )
    .groupBy(savedItems.targetId);

  return new Map(rows.map((row) => [row.propertyId, Number(row.total)]));
}

/**
 * Remove one save. `false` when this person had not saved that listing.
 *
 * Scoped by owner inside the `DELETE` rather than checked before it — an
 * authorisation performed in a second statement is an IDOR the first time
 * somebody forgets it.
 */
export async function unsaveProperty(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  propertyId: string,
): Promise<boolean> {
  const rows = await db
    .delete(savedItems)
    .where(
      and(
        eq(savedItems.oxyUserId, oxyUserId),
        eq(savedItems.targetType, 'property'),
        eq(savedItems.targetId, propertyId),
      ),
    )
    .returning({ id: savedItems.id });
  return rows.length > 0;
}

/**
 * Replace the note on a save. `undefined` when this person had not saved that
 * listing.
 */
export async function updateSavedPropertyNotes(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  propertyId: string,
  notes: string | null | undefined,
): Promise<SavedItemRow | undefined> {
  const [row] = await db
    .update(savedItems)
    .set({ notes: normalizeNotes(notes) })
    .where(
      and(
        eq(savedItems.oxyUserId, oxyUserId),
        eq(savedItems.targetType, 'property'),
        eq(savedItems.targetId, propertyId),
      ),
    )
    .returning();
  return row;
}

/**
 * How many saves sit in each of `folderIds`, for this owner.
 *
 * This is `SavedPropertyFolder.propertyCount` — the Mongoose virtual
 * `db/MIGRATION-CONTRACT.md` lists as one a DTO now has to compute. It counts
 * `saved_items`, which is where folder MEMBERSHIP actually lives; the folder's
 * own `properties[]` array was a second copy of the same fact and is not read.
 * See the header on `saved_property_folder_items` in
 * {@link file://./savedFolderRepository.ts}.
 *
 * @returns A count per folder id. A folder with no saves is ABSENT from the map
 *   rather than present as `0`, so the caller's `?? 0` is what supplies the
 *   empty case.
 */
export async function countSavedPropertiesByFolder(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  folderIds: readonly string[],
): Promise<Map<string, number>> {
  if (folderIds.length === 0) return new Map();

  const rows = await db
    .select({ folderId: savedItems.folderId, total: count() })
    .from(savedItems)
    .where(
      and(
        eq(savedItems.oxyUserId, oxyUserId),
        eq(savedItems.targetType, 'property'),
        inArray(savedItems.folderId, [...folderIds]),
      ),
    )
    .groupBy(savedItems.folderId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    // `folder_id` is nullable, but `inArray` over a list of real ids can never
    // match a NULL — the guard states that rather than asserting it away.
    if (row.folderId !== null) counts.set(row.folderId, row.total);
  }
  return counts;
}

/**
 * The three fields a saved listing carries ON TOP of the property itself.
 *
 * The saved screen receives a property object with these merged in, which is the
 * shape the Mongo handler built by spreading the lean property document. `notes`
 * is emitted as `''` rather than `null` for the reason in the header.
 */
export function toSavedPropertyFields(row: SavedItemRow): Record<string, unknown> {
  return {
    savedAt: row.createdAt,
    notes: row.notes ?? '',
    folderId: row.folderId,
  };
}
