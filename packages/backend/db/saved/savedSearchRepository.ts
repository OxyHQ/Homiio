/**
 * `saved_searches` — a person's stored search, on Postgres.
 *
 * Empty in production, so this port has no backfill and no consistency window.
 *
 * ## The duplicate-name check MOVED INTO THE INDEX, and is not re-implemented
 *
 * `saveSearch` read for an existing name and then inserted, which is a
 * read-then-write with a window between the two: two requests from the same
 * person with the same name both find nothing and both insert.
 * `saved_searches_owner_name_key` is a real UNIQUE, so the correct port INSERTS
 * and handles `23505` — `db/MIGRATION-CONTRACT.md` lists this class of change
 * explicitly, and re-implementing the read would keep the race in a new costume
 * while the index quietly made it impossible.
 *
 * {@link SavedSearchNameTakenError} is what the controller turns into the 409
 * the Mongo handler returned, so the wire behaviour is unchanged and only the
 * race is gone.
 *
 * ## `name` and `query` are trimmed at the CALL SITE
 *
 * `CONVENTIONS.md` says a mongoose `trim` becomes nothing in Postgres and is
 * re-applied where the value enters. Both are trimmed by the controller before
 * they reach here, which matters for more than tidiness: the unique index is on
 * the stored bytes, so `'Madrid'` and `'Madrid '` would be two rows and the
 * duplicate-name rule would silently stop holding.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { savedSearches } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';

export type SavedSearchRow = typeof savedSearches.$inferSelect;

/** This person already has a saved search under that name. */
export class SavedSearchNameTakenError extends Error {
  constructor(readonly name: string) {
    super(`A saved search named '${name}' already exists for this owner.`);
    this.name = 'SavedSearchNameTakenError';
  }
}

export interface CreateSavedSearchInput {
  readonly oxyUserId: string;
  readonly name: string;
  readonly query: string;
  readonly filters?: Record<string, unknown>;
  /**
   * The serialised `LocationSelection`, or absent for a text-only search.
   *
   * Absent is NOT the same as "no location was wanted" once a row is old
   * enough: a row written before this column existed also has NULL here, and
   * the read path resolves it lazily and asks for confirmation rather than
   * guessing. That is why nothing writes a placeholder into it.
   */
  readonly location?: Record<string, unknown>;
  readonly notificationsEnabled?: boolean;
}

/**
 * Insert a saved search.
 *
 * @throws {SavedSearchNameTakenError} When the owner already has one by that
 *   name — raised from the index's own `23505` rather than from a preceding
 *   read, so two concurrent requests cannot both succeed.
 */
export async function createSavedSearch(
  db: DatabaseOrTransaction,
  input: CreateSavedSearchInput,
): Promise<SavedSearchRow> {
  try {
    const [row] = await db
      .insert(savedSearches)
      .values({
        oxyUserId: input.oxyUserId,
        name: input.name,
        query: input.query,
        filters: input.filters ?? {},
        location: input.location ?? null,
        notificationsEnabled: input.notificationsEnabled ?? false,
      })
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'saved_searches_owner_name_key')) {
      throw new SavedSearchNameTakenError(input.name);
    }
    throw error;
  }
}

/** Every saved search this person owns, newest first. */
export async function listSavedSearches(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<readonly SavedSearchRow[]> {
  return db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.oxyUserId, oxyUserId))
    .orderBy(desc(savedSearches.createdAt));
}

export interface UpdateSavedSearchInput {
  readonly name?: string;
  readonly query?: string;
  readonly filters?: Record<string, unknown>;
  /** Set the stored selection. `null` clears it back to "not yet resolved". */
  readonly location?: Record<string, unknown> | null;
  readonly notificationsEnabled?: boolean;
}

/**
 * Apply a partial update, scoped to the owner. `undefined` when the row does not
 * exist or is somebody else's.
 *
 * The ownership predicate is part of the `UPDATE` rather than a check before it,
 * for the reason `notificationRepository` states: an authorisation performed in
 * a second statement is an IDOR the first time somebody forgets it.
 *
 * @throws {SavedSearchNameTakenError} When a rename collides with another of the
 *   owner's searches.
 */
export async function updateSavedSearch(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
  input: UpdateSavedSearchInput,
): Promise<SavedSearchRow | undefined> {
  const values: Partial<typeof savedSearches.$inferInsert> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.query !== undefined) values.query = input.query;
  if (input.filters !== undefined) values.filters = input.filters;
  if (input.location !== undefined) values.location = input.location;
  if (input.notificationsEnabled !== undefined) {
    values.notificationsEnabled = input.notificationsEnabled;
  }

  if (Object.keys(values).length === 0) {
    return findSavedSearch(db, id, oxyUserId);
  }

  try {
    const [row] = await db
      .update(savedSearches)
      .set(values)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.oxyUserId, oxyUserId)))
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'saved_searches_owner_name_key')) {
      throw new SavedSearchNameTakenError(input.name ?? '');
    }
    throw error;
  }
}

/** One saved search, scoped to its owner. */
export async function findSavedSearch(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<SavedSearchRow | undefined> {
  const [row] = await db
    .select()
    .from(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.oxyUserId, oxyUserId)))
    .limit(1);
  return row;
}

/** Delete one saved search, scoped to its owner. */
export async function deleteSavedSearch(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<boolean> {
  const rows = await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.oxyUserId, oxyUserId)))
    .returning({ id: savedSearches.id });
  return rows.length > 0;
}

/**
 * The wire shape the profile screen reads.
 *
 * `id`, never `_id` — the wire contract is the clean cut PR #287 made.
 */
export function toSavedSearchDTO(row: SavedSearchRow): Record<string, unknown> {
  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    name: row.name,
    query: row.query,
    filters: row.filters,
    location: row.location,
    /**
     * How the stored location should be READ (ADR 0002 §11).
     *
     * `resolved` — the row carries a selection; use it, resolving a `homiio`
     * source by id so a rename does not move the search.
     * `needs_confirmation` — the row predates the column, so all we have is a
     * label in `query`. The UI asks which place was meant. It is deliberately
     * NOT geocoded here: taking the first hit for a stored label is the homonym
     * bug, and doing it on read is the same mistake as doing it in a migration,
     * one row at a time. An unconfirmed search does not run and its alert does
     * not fire.
     */
    locationStatus: row.location ? 'resolved' : 'needs_confirmation',
    notificationsEnabled: row.notificationsEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
