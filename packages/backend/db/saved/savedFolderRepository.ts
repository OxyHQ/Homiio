/**
 * `saved_property_folders` — a person's collections of saved listings, on
 * Postgres.
 *
 * Ported from `models/schemas/SavedPropertyFolderSchema.ts`. The collection held
 * **0 documents in production** (measured, not assumed), so this port has no
 * backfill and no consistency window.
 *
 * ## `saved_property_folder_items` is NOT written, and that is the point
 *
 * The schema carries that table because the Mongo document carried a
 * `properties[]` array and a schema port may not silently drop a field. But
 * folder MEMBERSHIP has one representation and it is `saved_items.folder_id`:
 * that is what `saveProperty` wrote, what the folder counts aggregated, and what
 * every read in this package consults. The `properties[]` array was a second
 * copy of the same fact, and the four Mongoose methods that maintained it
 * (`addProperty`, `removeProperty`, `hasProperty`, `updatePropertyNotes`) have
 * **zero call sites** — the only code that ever touched the array was a
 * best-effort `try {} catch {}` mirror in `updateSavedPropertyNotes`, which
 * swallowed its own failures and could therefore drift from `Saved` unobserved.
 *
 * Writing both would mean two representations of one fact, which is the failure
 * this codebase names repeatedly. So the mirror is dropped rather than ported,
 * and `saved_property_folder_items` is left with no writer — a fact recorded
 * here, and in the PR, because a table with no producer is a trap for the next
 * reader. Removing it is a `post`-phase migration and a separate, deliberate
 * change; it is not smuggled in here.
 *
 * ## The case-insensitive name rule is the INDEX now
 *
 * Both handlers checked for a duplicate name with
 * `{ $regex: new RegExp('^' + name + '$', 'i') }` and then wrote — a
 * read-then-write with a window, and an unescaped regex built from user input
 * besides (a folder named `.*` matched every existing name and made the folder
 * unnameable). `saved_property_folders_owner_name_key` is a functional unique on
 * `lower(name)`, so the port INSERTs and handles `23505`, which
 * `db/MIGRATION-CONTRACT.md` names as the required shape for exactly this class
 * of change. {@link SavedFolderNameTakenError} is what the controller turns back
 * into the 409 the Mongo handler returned.
 */

import { and, asc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import type { DatabaseOrTransaction } from '../postgres';
import { savedPropertyFolders } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';

export type SavedFolderRow = typeof savedPropertyFolders.$inferSelect;

/**
 * The name of the folder `saveProperty` creates when a person saves their first
 * listing without naming a folder. Mongo's literals, kept verbatim.
 */
const DEFAULT_FOLDER = {
  name: 'Favorites',
  description: 'Default folder for saved properties',
  icon: '❤️',
} as const;

/** This person already has a folder by that name, ignoring case. */
export class SavedFolderNameTakenError extends Error {
  constructor(readonly folderName: string) {
    super(`A saved-property folder named '${folderName}' already exists for this owner.`);
    this.name = 'SavedFolderNameTakenError';
  }
}

export interface CreateSavedFolderInput {
  readonly oxyUserId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly color?: string;
  readonly icon?: string;
  readonly isDefault?: boolean;
}

/**
 * Store an absent description as NULL rather than as `''`.
 *
 * `db/schema/CONVENTIONS.md` refuses a `default: ''` on the ground that an empty
 * string is a VALUE and NULL is the absence; the column is nullable with no
 * default, and this is the one place that decision is applied.
 */
function normalizeDescription(description: string | null | undefined): string | null {
  if (typeof description !== 'string') return null;
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Create a folder.
 *
 * `color` and `icon` are passed through as `undefined` when absent so the COLUMN
 * defaults apply. Passing an explicit `null` would fail `NOT NULL`, which is the
 * same trap `notificationRepository` documents: mongoose applies a default at
 * document construction, drizzle omits an `undefined` key and lets the server
 * decide.
 *
 * @throws {SavedFolderNameTakenError} Raised from the index's own `23505` rather
 *   than from a preceding read, so two concurrent requests cannot both succeed.
 */
export async function createSavedFolder(
  db: DatabaseOrTransaction,
  input: CreateSavedFolderInput,
): Promise<SavedFolderRow> {
  try {
    const [row] = await db
      .insert(savedPropertyFolders)
      .values({
        oxyUserId: input.oxyUserId,
        name: input.name,
        description: normalizeDescription(input.description),
        color: input.color,
        icon: input.icon,
        isDefault: input.isDefault ?? false,
      })
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'saved_property_folders_owner_name_key')) {
      throw new SavedFolderNameTakenError(input.name);
    }
    throw error;
  }
}

/** Every folder this person owns: the default one first, then oldest first. */
export async function listSavedFolders(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<readonly SavedFolderRow[]> {
  return db
    .select()
    .from(savedPropertyFolders)
    .where(eq(savedPropertyFolders.oxyUserId, oxyUserId))
    // `{ isDefault: -1, createdAt: 1 }`, unchanged. `desc` on a boolean puts
    // `true` first in Postgres, which is the same order Mongo produced.
    .orderBy(sql`${savedPropertyFolders.isDefault} desc`, asc(savedPropertyFolders.createdAt));
}

/** One folder, scoped to its owner. */
export async function findSavedFolder(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<SavedFolderRow | undefined> {
  const [row] = await db
    .select()
    .from(savedPropertyFolders)
    .where(and(eq(savedPropertyFolders.id, id), eq(savedPropertyFolders.oxyUserId, oxyUserId)))
    .limit(1);
  return row;
}

export interface UpdateSavedFolderInput {
  readonly name?: string;
  readonly description?: string | null;
  readonly color?: string;
  readonly icon?: string;
}

/**
 * Apply a partial update, scoped to the owner. `undefined` when the folder does
 * not exist or belongs to somebody else.
 *
 * @throws {SavedFolderNameTakenError} When a rename collides with another of the
 *   owner's folders, ignoring case.
 */
export async function updateSavedFolder(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
  input: UpdateSavedFolderInput,
): Promise<SavedFolderRow | undefined> {
  const values: Partial<typeof savedPropertyFolders.$inferInsert> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = normalizeDescription(input.description);
  if (input.color !== undefined) values.color = input.color;
  if (input.icon !== undefined) values.icon = input.icon;

  // An empty `set` would still restamp `updated_at` through drizzle's
  // `$onUpdate` — the row is read back instead, as `notificationRepository` does.
  if (Object.keys(values).length === 0) return findSavedFolder(db, id, oxyUserId);

  try {
    const [row] = await db
      .update(savedPropertyFolders)
      .set(values)
      .where(and(eq(savedPropertyFolders.id, id), eq(savedPropertyFolders.oxyUserId, oxyUserId)))
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'saved_property_folders_owner_name_key')) {
      throw new SavedFolderNameTakenError(input.name ?? '');
    }
    throw error;
  }
}

/**
 * Delete one folder, scoped to its owner. `false` when it was not theirs.
 *
 * The saves filed in it are NOT deleted: `saved_items.folder_id` is
 * `ON DELETE SET NULL`, so they return to "not in a folder" in the same
 * statement. See the header of `savedPropertyRepository.ts`.
 */
export async function deleteSavedFolder(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<boolean> {
  const rows = await db
    .delete(savedPropertyFolders)
    .where(and(eq(savedPropertyFolders.id, id), eq(savedPropertyFolders.oxyUserId, oxyUserId)))
    .returning({ id: savedPropertyFolders.id });
  return rows.length > 0;
}

/**
 * The folder a save goes into when the caller named none — found, or created.
 *
 * Two races, both real, both closed by the index rather than by a lock:
 *
 *  - two concurrent first-saves each find no default folder and each insert one.
 *    The second gets `23505` from `saved_property_folders_owner_name_key`, and
 *    the re-read below returns the row the first one committed.
 *  - a person already has a non-default folder literally named "Favorites". The
 *    insert collides on the same index, and the re-read finds THAT folder, which
 *    is the only sane answer — the alternative is a 500 on a save.
 *
 * `is_default` carries no unique index (Mongo had none either), so two default
 * folders remain representable. The lookup is therefore ORDERED, so which one is
 * chosen is stable rather than whatever the heap returns first.
 */
export async function ensureDefaultFolder(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<SavedFolderRow> {
  const [existing] = await db
    .select()
    .from(savedPropertyFolders)
    .where(
      and(
        eq(savedPropertyFolders.oxyUserId, oxyUserId),
        eq(savedPropertyFolders.isDefault, true),
      ),
    )
    .orderBy(asc(savedPropertyFolders.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(savedPropertyFolders)
    .values({
      oxyUserId,
      name: DEFAULT_FOLDER.name,
      description: DEFAULT_FOLDER.description,
      icon: DEFAULT_FOLDER.icon,
      isDefault: true,
    })
    // No `catch` on `23505` here: `DO NOTHING` returns an empty set for both
    // races above, and the re-read that follows distinguishes neither — it just
    // returns the row that won.
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(savedPropertyFolders)
    .where(
      and(
        eq(savedPropertyFolders.oxyUserId, oxyUserId),
        sql`lower(${savedPropertyFolders.name}) = lower(${DEFAULT_FOLDER.name})`,
      ),
    )
    .limit(1);
  if (raced) return raced;

  // Unreachable unless the conflicting row was deleted between the insert and
  // the re-read. Thrown rather than returned as `undefined`, so a caller cannot
  // file a save against a folder that does not exist.
  throw new Error(
    `Could not find or create the default saved-property folder for owner ${oxyUserId}.`,
  );
}

/**
 * The wire shape the saved screen reads.
 *
 * `id`, never `_id`. `propertyCount` is the Mongoose virtual, now computed from
 * `saved_items` by {@link countSavedPropertiesByFolder} and passed in — the
 * folder row itself stores no count, so there is nothing that can go stale.
 */
export function toSavedFolderDTO(
  row: SavedFolderRow,
  propertyCount: number,
): Record<string, unknown> {
  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    name: row.name,
    description: row.description,
    color: row.color,
    icon: row.icon,
    isDefault: row.isDefault,
    propertyCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
