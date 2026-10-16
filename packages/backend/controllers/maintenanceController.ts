/**
 * `GET|POST /api/maintenance` and its sub-resources — repair requests
 * (#518 §7.1, #519 §7.1).
 *
 * Thin HTTP adapters over `domain/maintenance.ts`, which the catalogue's
 * maintenance tools call too: authorization (in the repository query),
 * validation and notifications all live there. This file only reads the
 * session and the request, and shapes the envelope.
 */

import type { NextFunction, Request, Response } from 'express';

import {
  attachMaintenancePhoto,
  commentOnMaintenanceRequest,
  createMaintenanceRequest,
  getMaintenanceRequest,
  listMyMaintenanceRequests,
  readMaintenanceAttachment,
  transitionMaintenanceRequest,
} from '../domain/maintenance';
import { paginationResponse, successResponse } from '../middlewares/errorHandler';
import { parsePagination } from '../domain/evictions/shared';
import { requireSessionOxyUserId } from '../utils/sessionUser';

export { MAINTENANCE_ATTACHMENTS_MAX } from '../domain/maintenance';

/** `GET /api/maintenance` — the caller's repair requests, newest first. */
export async function listRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const { page, limit } = parsePagination(req.query);
    const result = await listMyMaintenanceRequests(oxyUserId, {
      ...(req.query.leaseId === undefined ? {} : { leaseId: String(req.query.leaseId) }),
      ...(req.query.propertyId === undefined ? {} : { propertyId: String(req.query.propertyId) }),
      openOnly: req.query.openOnly === 'true',
      page,
      limit,
    });
    res.json(
      paginationResponse(
        result.requests,
        page,
        limit,
        result.total,
        'Maintenance requests retrieved',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/** `GET /api/maintenance/:id` — one request, with its thread and history. */
export async function getRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const request = await getMaintenanceRequest(
      requireSessionOxyUserId(req),
      String(req.params.id),
    );
    res.json(successResponse(request, 'Maintenance request retrieved'));
  } catch (error) {
    next(error);
  }
}

/** `POST /api/maintenance/:id/attachments` — a photo of what is broken. */
export async function attachToRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const file = (req as unknown as { file?: { buffer: Buffer; mimetype: string } }).file;
    const attachment = await attachMaintenancePhoto(
      requireSessionOxyUserId(req),
      String(req.params.id),
      file,
    );
    res.status(201).json(successResponse(attachment, 'Photo attached'));
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/maintenance/:id/attachments/:attachmentId` — one photo's bytes,
 * base64 in the ordinary envelope (the Oxy linked client is JSON-only).
 */
export async function getRequestAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const attachment = await readMaintenanceAttachment(
      requireSessionOxyUserId(req),
      String(req.params.id),
      String(req.params.attachmentId),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(successResponse(attachment, 'Attachment retrieved'));
  } catch (error) {
    next(error);
  }
}

/** `POST /api/maintenance` — raise a request against a lease you are on. */
export async function createRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const request = await createMaintenanceRequest(requireSessionOxyUserId(req), {
      leaseId: req.body?.leaseId,
      category: req.body?.category,
      urgency: req.body?.urgency,
      title: req.body?.title,
      description: req.body?.description,
    });
    res.status(201).json(successResponse(request, 'Maintenance request created'));
  } catch (error) {
    next(error);
  }
}

/** `POST /api/maintenance/:id/status` — move a request along the state machine. */
export async function transitionRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const request = await transitionMaintenanceRequest(
      requireSessionOxyUserId(req),
      String(req.params.id),
      { status: req.body?.status, scheduledFor: req.body?.scheduledFor },
    );
    res.json(successResponse(request, 'Maintenance request updated'));
  } catch (error) {
    next(error);
  }
}

/** `POST /api/maintenance/:id/comments` — say something on the thread. */
export async function commentOnRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const comment = await commentOnMaintenanceRequest(
      requireSessionOxyUserId(req),
      String(req.params.id),
      { body: req.body?.body },
    );
    res.status(201).json(successResponse(comment, 'Comment added'));
  } catch (error) {
    next(error);
  }
}
