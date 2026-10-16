/**
 * Saved properties — Express adapters over `domain/saved.ts`, which the
 * catalogue's saved-home tools call too.
 */

import type { NextFunction, Request, Response } from 'express';

import { listSavedHomes, saveHome, unsaveHome, updateSavedHomeNotes } from '../../domain/saved';
import { sendAuthenticationRequired, sendSavedError } from './savedErrors';
import { successResponse } from './shared';

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/** Get saved properties for the current user's profile */
export async function getSavedProperties(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    res.json(
      successResponse(await listSavedHomes(oxyUserId), 'Saved properties retrieved successfully'),
    );
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Save a property for the current user's profile */
export async function saveProperty(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const { propertyId, notes, folderId } = req.body;
    const saved = await saveHome(oxyUserId, { propertyId, notes, folderId });
    res.json(successResponse(saved, 'Property saved successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Unsave a property for the current user's profile */
export async function unsaveProperty(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    await unsaveHome(oxyUserId, req.params.propertyId);
    res.json(successResponse(null, 'Property unsaved successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Update saved property notes for the current user's profile */
export async function updateSavedPropertyNotes(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const updated = await updateSavedHomeNotes(oxyUserId, req.params.propertyId, req.body.notes);
    res.json(successResponse(updated, 'Property notes updated successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}
