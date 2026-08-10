/**
 * Saved searches, on Postgres.
 *
 * Ported from the Mongo `SavedSearch` model to
 * `db/saved/savedSearchRepository.ts`. The collection was empty in production,
 * so no user-visible behaviour depends on any row this port had to preserve.
 *
 * ## Two things the port changed, both deliberately
 *
 * **The duplicate-name check is the INDEX now.** `saveSearch` used to read for
 * the name and then insert, which two concurrent requests both pass. The 409 is
 * unchanged; it is now raised from `saved_searches_owner_name_key`'s own
 * `23505`. See the repository header.
 *
 * **The `Profile.findByOxyUserId` guard on delete / update / toggle is GONE.**
 * It was not an authorisation check — every one of those statements is already
 * scoped by `oxyUserId`, which is resolved from the session and never from the
 * client — so its only effect was to answer 404 to somebody who owned the row
 * but happened to have no profile document yet. Keeping it would have made this
 * controller depend on `profiles`, a table another batch owns, in order to
 * reproduce a check that protected nothing. It is dropped rather than ported,
 * and the ownership predicate that does the real work is untouched.
 */

import type { NextFunction, Request, Response } from 'express';

import { getDb } from '../../db/postgres';
import {
  createSavedSearch,
  deleteSavedSearch as deleteSavedSearchRow,
  listSavedSearches,
  SavedSearchNameTakenError,
  toSavedSearchDTO,
  updateSavedSearch as updateSavedSearchRow,
} from '../../db/saved/savedSearchRepository';
import { errorResponse, successResponse } from './shared';

/**
 * The selection kinds a saved row may carry (ADR 0002 §3).
 *
 * An allowlist rather than "any object": `location` is `jsonb`, so without one
 * the column would accept whatever a client posted and every reader downstream
 * would have to defend itself. Membership is TOTAL — a kind that is in neither
 * this list nor the union is refused, not stored and ignored.
 */
const LOCATION_KINDS: ReadonlySet<string> = new Set([
  'current_location',
  'place',
  'address_candidate',
  'map_bounds',
  'polygon',
  'multi_area',
]);

/** A jsonb payload big enough for any real selection and small enough to bound. */
const MAX_LOCATION_BYTES = 8_192;

/**
 * Narrow a posted `location` to something storable.
 *
 * Returns `undefined` for absent (a legitimate text-only search) and `null` for
 * PRESENT BUT INVALID, so the caller can refuse the second without treating it
 * as the first — the same "absence is not failure" distinction the whole
 * contract turns on, applied to a request body.
 */
function readLocation(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !LOCATION_KINDS.has(kind)) return null;
  if (JSON.stringify(value).length > MAX_LOCATION_BYTES) return null;
  return value as Record<string, unknown>;
}

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/**
 * Get saved searches for the current user
 */
export async function getSavedSearches(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const rows = await listSavedSearches(getDb(), oxyUserId);

    res.json(successResponse(rows.map(toSavedSearchDTO), "Saved searches retrieved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Save a search for the current user
 */
export async function saveSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { name, query, filters, notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const location = readLocation(req.body.location);
    if (location === null) {
      return res.status(400).json(
        errorResponse("The location is not a recognised selection", "INVALID_LOCATION")
      );
    }

    // A name, and SOMETHING to search — a location, free text, or both.
    //
    // This used to require a non-empty `query`, back when `query` held the
    // location's LABEL. Now that it is the free-text dimension and is normally
    // EMPTY for a place search, that check would have rejected every saved city
    // with a 400 the user could do nothing about.
    const text = typeof query === 'string' ? query.trim() : '';
    if (typeof name !== 'string' || !name.trim() || (!location && !text)) {
      return res.status(400).json(
        errorResponse("A search name and either a location or search text are required", "SEARCH_DATA_REQUIRED")
      );
    }

    let savedSearch;
    try {
      savedSearch = await createSavedSearch(getDb(), {
        oxyUserId,
        // Trimmed HERE: mongoose's `trim` has no Postgres counterpart, and the
        // unique index is on the stored bytes — an untrimmed name would make
        // `'Madrid '` a second row and quietly retire the duplicate-name rule.
        name: name.trim(),
        query: text,
        filters: filters ?? {},
        location,
        notificationsEnabled: Boolean(notificationsEnabled),
      });
    } catch (error) {
      if (error instanceof SavedSearchNameTakenError) {
        return res.status(409).json(
          errorResponse("A search with this name already exists", "SEARCH_NAME_EXISTS")
        );
      }
      throw error;
    }

    res.status(201).json(successResponse(toSavedSearchDTO(savedSearch), "Search saved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a saved search for the current user
 */
export async function deleteSavedSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { searchId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    const deleted = await deleteSavedSearchRow(getDb(), searchId, oxyUserId);

    if (!deleted) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(successResponse(null, "Search deleted successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Update a saved search for the current user
 */
export async function updateSavedSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { searchId } = req.params;
    const { name, query, filters, notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    let savedSearch;
    try {
      savedSearch = await updateSavedSearchRow(getDb(), searchId, oxyUserId, {
        name: name === undefined ? undefined : String(name).trim(),
        query: query === undefined ? undefined : String(query).trim(),
        filters,
        notificationsEnabled:
          notificationsEnabled === undefined ? undefined : Boolean(notificationsEnabled),
      });
    } catch (error) {
      if (error instanceof SavedSearchNameTakenError) {
        return res.status(409).json(
          errorResponse("A search with this name already exists", "SEARCH_NAME_EXISTS")
        );
      }
      throw error;
    }

    if (!savedSearch) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(successResponse(toSavedSearchDTO(savedSearch), "Search updated successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Toggle notifications for a saved search
 */
export async function toggleSearchNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { searchId } = req.params;
    const { notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    const savedSearch = await updateSavedSearchRow(getDb(), searchId, oxyUserId, {
      notificationsEnabled: Boolean(notificationsEnabled),
    });

    if (!savedSearch) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(
      successResponse(toSavedSearchDTO(savedSearch), "Search notifications updated successfully")
    );
  } catch (error) {
    next(error);
  }
}
