/**
 * Saved properties, on Postgres.
 *
 * Ported from the Mongo `Saved` collection to `db/saved/savedPropertyRepository.ts`.
 * The collection held 0 documents in production, so no user-visible behaviour
 * depends on a row this port had to preserve.
 *
 * ## The listings themselves come from the catalogue repository
 *
 * `Property.find({ _id: { $in: ids } }).populate('addressId')` becomes
 * `findProperties` + `serializeProperty` — the same path every catalogue read
 * already takes, so a saved listing is serialized by the ONE module that knows
 * how to re-nest the flattened columns. Two orderings are in play and only one
 * of them is the catalogue's: the response is ordered by when each listing was
 * SAVED, so the ids are re-ordered here rather than in SQL.
 *
 * ## The dead-pointer filter is gone, because a dead pointer is unrepresentable
 *
 * The Mongo handler dropped any save whose property could not be found
 * (`if (!prop) return null`), which was necessary: `targetId` was a bare string
 * with nothing behind it. `saved_items.target_id` is a real foreign key with
 * `ON DELETE CASCADE`, so a save outlives its listing for exactly no time at
 * all. Keeping the filter would mean writing a branch no test could ever reach.
 *
 * ## `getProfileProperties` is DELETED
 *
 * It listed the caller's OWN listings, had no route and no caller, and
 * duplicated `getMyProperties` in `controllers/property/retrieve.ts`, which is
 * routed and already reads Postgres. It was reachable only through this
 * package's barrel export.
 */

import type { NextFunction, Request, Response } from 'express';
import { inArray } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { properties } from '../../db/schema';
import { findProperties } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import {
  listSavedProperties,
  saveProperty as savePropertyRow,
  SavedPropertyNotFoundError,
  toSavedPropertyFields,
  unsaveProperty as unsavePropertyRow,
  updateSavedPropertyNotes as updateSavedPropertyNotesRow,
} from '../../db/saved/savedPropertyRepository';
import {
  ensureDefaultFolder,
  findSavedFolder,
} from '../../db/saved/savedFolderRepository';
import { errorResponse, successResponse } from './shared';

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/**
 * Get saved properties for the current user's profile
 */
export async function getSavedProperties(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const saved = await listSavedProperties(getDb(), oxyUserId);
    if (saved.length === 0) {
      return res.json(successResponse([], "Saved properties retrieved successfully"));
    }

    const hydrated = await findProperties({
      where: inArray(properties.id, saved.map((row) => row.targetId)),
    });
    const byId = new Map(hydrated.map((entry) => [entry.property.id, entry]));

    // Ordered by `saved`, not by the catalogue read: the saved screen lists what
    // was saved most recently first, and `findProperties` knows nothing of that.
    const merged = saved.flatMap((row) => {
      const listing = byId.get(row.targetId);
      // Only reachable if a listing is deleted BETWEEN the two statements above;
      // the foreign key rules out every other case. See the header.
      if (!listing) return [];
      return [{ ...serializeProperty(listing), ...toSavedPropertyFields(row) }];
    });

    res.json(successResponse(merged, "Saved properties retrieved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Save a property for the current user's profile
 */
export async function saveProperty(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { propertyId, notes, folderId } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (typeof propertyId !== 'string' || !propertyId) {
      return res.status(400).json(
        errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
      );
    }

    // A named folder must be one of the CALLER's own. Scoped by owner in the
    // lookup itself, so somebody else's folder id is indistinguishable from one
    // that does not exist — it neither files a save into a stranger's folder nor
    // tells the caller their folder exists.
    let folder;
    if (folderId) {
      folder = await findSavedFolder(getDb(), String(folderId), oxyUserId);
      if (!folder) {
        return res.status(404).json(
          errorResponse("Folder not found", "FOLDER_NOT_FOUND")
        );
      }
    } else {
      folder = await ensureDefaultFolder(getDb(), oxyUserId);
    }

    try {
      await savePropertyRow(getDb(), {
        oxyUserId,
        propertyId,
        notes,
        folderId: folder.id,
      });
    } catch (error) {
      if (error instanceof SavedPropertyNotFoundError) {
        return res.status(404).json(
          errorResponse("Property not found", "PROPERTY_NOT_FOUND")
        );
      }
      throw error;
    }

    res.json(successResponse({ folderId: folder.id }, "Property saved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Unsave a property for the current user's profile
 */
export async function unsaveProperty(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { propertyId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!propertyId) {
      return res.status(400).json(
        errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
      );
    }

    const deleted = await unsavePropertyRow(getDb(), oxyUserId, propertyId);

    if (!deleted) {
      return res.status(404).json(
        errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND")
      );
    }

    res.json(successResponse(null, "Property unsaved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Update saved property notes for the current user's profile
 *
 * The Mongo handler followed this with a best-effort mirror of the note into
 * `SavedPropertyFolder.properties[].notes`, inside a `try {} catch {}` that
 * swallowed its own failures. That second copy is not written any more — see the
 * header of `db/saved/savedFolderRepository.ts` for why folder membership has
 * exactly one representation.
 */
export async function updateSavedPropertyNotes(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { propertyId } = req.params;
    const { notes } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!propertyId) {
      return res.status(400).json(
        errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
      );
    }

    const updated = await updateSavedPropertyNotesRow(getDb(), oxyUserId, propertyId, notes);

    if (!updated) {
      return res.status(404).json(
        errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND")
      );
    }

    res.json(successResponse(
      { propertyId: updated.targetId, ...toSavedPropertyFields(updated) },
      "Property notes updated successfully",
    ));
  } catch (error) {
    next(error);
  }
}
