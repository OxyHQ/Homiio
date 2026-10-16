/**
 * Saved searches, which are also WATCHES (#356), and the alerts they produce —
 * Express adapters over `domain/saved.ts`, which the catalogue's saved-search
 * and alert tools call too. Validation of every alerting field, the
 * cadence/`notificationsEnabled` lockstep and the duplicate-name 409 all live
 * there.
 */

import type { NextFunction, Request, Response } from 'express';

import {
  createSavedSearch,
  deleteSavedSearch as deleteSavedSearchForOwner,
  getHousingAlert as getHousingAlertForOwner,
  listHousingAlerts,
  listSavedSearches,
  setSavedSearchNotifications,
  updateSavedSearch as updateSavedSearchForOwner,
} from '../../domain/saved';
import { sendAuthenticationRequired, sendSavedError } from './savedErrors';
import { successResponse } from './shared';

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/** Get saved searches for the current user */
export async function getSavedSearches(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    res.json(
      successResponse(await listSavedSearches(oxyUserId), 'Saved searches retrieved successfully'),
    );
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Save a search for the current user */
export async function saveSearch(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const savedSearch = await createSavedSearch(oxyUserId, req.body as Record<string, unknown>);
    res.status(201).json(successResponse(savedSearch, 'Search saved successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Delete a saved search for the current user */
export async function deleteSavedSearch(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    await deleteSavedSearchForOwner(oxyUserId, req.params.searchId);
    res.json(successResponse(null, 'Search deleted successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** Update a saved search for the current user */
export async function updateSavedSearch(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const savedSearch = await updateSavedSearchForOwner(
      oxyUserId,
      req.params.searchId,
      req.body as Record<string, unknown>,
    );
    res.json(successResponse(savedSearch, 'Search updated successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/**
 * Toggle notifications for a saved search — the legacy switch, kept because
 * several clients call it. It moves `cadence` too.
 */
export async function toggleSearchNotifications(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const savedSearch = await setSavedSearchNotifications(
      oxyUserId,
      req.params.searchId,
      req.body.notificationsEnabled,
    );
    res.json(successResponse(savedSearch, 'Search notifications updated successfully'));
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** The alert history — in-app, and the visible source of truth. */
export async function getHousingAlerts(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    const { alerts, total, limit, offset, hasMore } = await listHousingAlerts(oxyUserId, {
      limit: req.query.limit,
      offset: req.query.offset,
      watchId: req.query.watchId,
    });
    res.json(
      successResponse(alerts, 'Alerts retrieved successfully', {
        total,
        limit,
        offset,
        // Flat aliases beside the nested object, the convention every list
        // endpoint feeding an infinite grid here follows.
        hasMore,
        pagination: { total, limit, offset },
      }),
    );
  } catch (error) {
    sendSavedError(res, next, error);
  }
}

/** "Why did I get this?" — one alert, with the fact behind it. */
export async function getHousingAlert(req: Request, res: Response, next: NextFunction) {
  const oxyUserId = ownerOf(req);
  if (!oxyUserId) return sendAuthenticationRequired(res);
  try {
    res.json(
      successResponse(
        await getHousingAlertForOwner(oxyUserId, req.params.alertId),
        'Alert retrieved successfully',
      ),
    );
  } catch (error) {
    sendSavedError(res, next, error);
  }
}
