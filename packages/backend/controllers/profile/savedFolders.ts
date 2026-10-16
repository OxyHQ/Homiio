/**
 * Saved-property folders — Express adapters over `domain/saved.ts`, which the
 * catalogue's folder tools call too.
 */

import type { NextFunction, Request, Response } from 'express';

import {
  createSavedFolder,
  deleteSavedFolder,
  listSavedFolders,
  updateSavedFolder,
} from '../../domain/saved';
import { sendAuthenticationRequired, sendSavedError } from './savedErrors';
import { successResponse } from './shared';

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/** Get saved property folders for the current user's profile */
export async function getSavedPropertyFolders(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    res.json(
      successResponse(
        await listSavedFolders(oxyUserId),
        'Saved property folders retrieved successfully',
      ),
    );
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Create a new saved property folder */
export async function createSavedPropertyFolder(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const { name, description, color, icon } = req.body;
    const folder = await createSavedFolder(oxyUserId, { name, description, color, icon });
    res.status(201).json(successResponse(folder, 'Folder created successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Update a saved property folder */
export async function updateSavedPropertyFolder(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const { name, description, color, icon } = req.body;
    const folder = await updateSavedFolder(oxyUserId, req.params.folderId, {
      name,
      description,
      color,
      icon,
    });
    res.json(successResponse(folder, 'Folder updated successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Delete a saved property folder */
export async function deleteSavedPropertyFolder(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    await deleteSavedFolder(oxyUserId, req.params.folderId);
    res.json(successResponse(null, 'Folder deleted successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}
