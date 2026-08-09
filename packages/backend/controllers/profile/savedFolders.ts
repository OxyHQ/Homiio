/**
 * Saved-property folders, on Postgres.
 *
 * Ported from the Mongo `SavedPropertyFolder` collection to
 * `db/saved/savedFolderRepository.ts`. The collection held 0 documents in
 * production, so no user-visible behaviour depends on a preserved row.
 *
 * ## Three things the port changed, all deliberate
 *
 * **The duplicate-name check is the INDEX.** Both handlers built a case-insensitive
 * `RegExp` from the submitted name and searched with it before writing. That was
 * a read-then-write two concurrent requests both pass, and the regex was
 * unescaped user input besides — a folder named `.*` matched every existing name,
 * so the 409 fired against a folder the caller had never seen. The 409 is
 * unchanged and now comes from `saved_property_folders_owner_name_key`'s own
 * `23505`.
 *
 * **Deleting a folder no longer re-files its saves in application code.**
 * `saved_items.folder_id` is `ON DELETE SET NULL`, so the saves return to "not in
 * a folder" in the same statement that drops the folder.
 *
 * **`propertyCount` is computed from `saved_items`**, which is where folder
 * membership lives. It was a Mongoose virtual over the folder's own
 * `properties[]` array on the WRITE side and a `Saved` aggregation on the READ
 * side — two answers to one question. Only the second was ever correct, and it
 * is the one that survives.
 */

import type { NextFunction, Request, Response } from 'express';

import { getDb } from '../../db/postgres';
import { countSavedPropertiesByFolder } from '../../db/saved/savedPropertyRepository';
import {
  createSavedFolder,
  deleteSavedFolder as deleteSavedFolderRow,
  findSavedFolder,
  listSavedFolders,
  SavedFolderNameTakenError,
  toSavedFolderDTO,
  updateSavedFolder as updateSavedFolderRow,
} from '../../db/saved/savedFolderRepository';
import { errorResponse, successResponse } from './shared';

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/**
 * Get saved property folders for the current user's profile
 */
export async function getSavedPropertyFolders(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const folders = await listSavedFolders(getDb(), oxyUserId);
    const counts = await countSavedPropertiesByFolder(
      getDb(),
      oxyUserId,
      folders.map((folder) => folder.id),
    );

    res.json(successResponse(
      { folders: folders.map((folder) => toSavedFolderDTO(folder, counts.get(folder.id) ?? 0)) },
      "Saved property folders retrieved successfully",
    ));
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new saved property folder
 */
export async function createSavedPropertyFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { name, description, color, icon } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json(
        errorResponse("Folder name is required", "FOLDER_NAME_REQUIRED")
      );
    }

    let folder;
    try {
      folder = await createSavedFolder(getDb(), {
        oxyUserId,
        // Trimmed HERE: mongoose's `trim` has no Postgres counterpart, and the
        // unique index is on `lower(name)` over the stored bytes — an untrimmed
        // name would make `'Madrid '` a second folder and quietly retire the
        // duplicate-name rule.
        name: name.trim(),
        description,
        color: color === undefined ? undefined : String(color),
        icon: icon === undefined ? undefined : String(icon),
      });
    } catch (error) {
      if (error instanceof SavedFolderNameTakenError) {
        return res.status(409).json(
          errorResponse("Folder with this name already exists", "FOLDER_NAME_EXISTS")
        );
      }
      throw error;
    }

    res.status(201).json(successResponse(toSavedFolderDTO(folder, 0), "Folder created successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Update a saved property folder
 */
export async function updateSavedPropertyFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { folderId } = req.params;
    const { name, description, color, icon } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!folderId) {
      return res.status(400).json(
        errorResponse("Folder ID is required", "FOLDER_ID_REQUIRED")
      );
    }

    // Read first, because the default folder is refused BEFORE anything is
    // written and the two answers differ: a folder that is not the caller's is a
    // 404, the caller's own default folder is a 400.
    const existing = await findSavedFolder(getDb(), folderId, oxyUserId);
    if (!existing) {
      return res.status(404).json(
        errorResponse("Folder not found", "FOLDER_NOT_FOUND")
      );
    }
    if (existing.isDefault) {
      return res.status(400).json(
        errorResponse("Cannot update default folder", "CANNOT_UPDATE_DEFAULT_FOLDER")
      );
    }

    let folder;
    try {
      folder = await updateSavedFolderRow(getDb(), folderId, oxyUserId, {
        name: name === undefined ? undefined : String(name).trim(),
        description,
        color: color === undefined ? undefined : String(color),
        icon: icon === undefined ? undefined : String(icon),
      });
    } catch (error) {
      if (error instanceof SavedFolderNameTakenError) {
        return res.status(409).json(
          errorResponse("Folder with this name already exists", "FOLDER_NAME_EXISTS")
        );
      }
      throw error;
    }

    if (!folder) {
      return res.status(404).json(
        errorResponse("Folder not found", "FOLDER_NOT_FOUND")
      );
    }

    const counts = await countSavedPropertiesByFolder(getDb(), oxyUserId, [folder.id]);

    res.json(successResponse(
      toSavedFolderDTO(folder, counts.get(folder.id) ?? 0),
      "Folder updated successfully",
    ));
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a saved property folder
 */
export async function deleteSavedPropertyFolder(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { folderId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!folderId) {
      return res.status(400).json(
        errorResponse("Folder ID is required", "FOLDER_ID_REQUIRED")
      );
    }

    const existing = await findSavedFolder(getDb(), folderId, oxyUserId);
    if (!existing) {
      return res.status(404).json(
        errorResponse("Folder not found", "FOLDER_NOT_FOUND")
      );
    }
    if (existing.isDefault) {
      return res.status(400).json(
        errorResponse("Cannot delete default folder", "CANNOT_DELETE_DEFAULT_FOLDER")
      );
    }

    // The saves filed in it survive: `saved_items.folder_id` is
    // `ON DELETE SET NULL`, so they return to "not in a folder" here.
    const deleted = await deleteSavedFolderRow(getDb(), folderId, oxyUserId);
    if (!deleted) {
      return res.status(404).json(
        errorResponse("Folder not found", "FOLDER_NOT_FOUND")
      );
    }

    res.json(successResponse(null, "Folder deleted successfully"));
  } catch (error) {
    next(error);
  }
}
