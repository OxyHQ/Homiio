/**
 * `GET|POST /api/maintenance` and its sub-resources — repair requests
 * (#518 §7.1, #519 §7.1).
 *
 * ## Authorization is not here
 *
 * Every read and write goes through `db/maintenance/maintenanceRepository.ts`,
 * whose predicates join through `leases`. `AGENTS.md`: "Ownership is enforced in
 * the REPOSITORY QUERY, so a non-owner gets a 404 rather than a 403." This
 * controller therefore has no membership check of its own to fall out of step
 * with one — it validates INPUT and maps refusals onto statuses.
 *
 * ## Notifications are dispatched AFTER the write, and swallow
 *
 * `notificationDispatchService.createForUser`, per the one-chokepoint rule. A
 * mailbox row failing must never roll back a repair somebody reported — the
 * dispatcher swallows by contract, and the `void` at each call site is the
 * deliberate expression of that, not an unhandled promise.
 *
 * ## What is NOT here
 *
 * Attachments. Both epics ask for photos, and both also forbid putting a
 * tenancy's evidence through the public image endpoint — which is the only
 * upload path Homiio has (`imageUploadService` writes
 * `Cache-Control: public, max-age=31536000` and serves via the CDN). A private
 * object path is its own change with its own access model. Recorded in
 * `docs/housing-parity.md` rather than shipped onto a guessable URL.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_COMMENT_MAX,
  MAINTENANCE_DESCRIPTION_MAX,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TITLE_MAX,
  MAINTENANCE_URGENCIES,
  type MaintenanceCategory,
  type MaintenanceStatus,
  type MaintenanceUrgency,
} from '@homiio/shared-types';

import { eq } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { leases } from '../db/schema';
import {
  addMaintenanceAttachment,
  addMaintenanceComment,
  applyMaintenanceTransition,
  createMaintenanceRequest,
  findMaintenanceAttachment,
  findMaintenanceRequest,
  listMaintenanceRequests,
  maintenanceRoleOnLease,
} from '../db/maintenance/maintenanceRepository';
import {
  toHydratedMaintenanceDTO,
  toMaintenanceAttachmentDTO,
  toMaintenanceCommentDTO,
  toMaintenanceRequestDTO,
} from '../db/maintenance/maintenanceSerializer';
import imageUploadService from '../services/imageUploadService';
import { AppError, paginationResponse, successResponse } from '../middlewares/errorHandler';
import { parsePagination } from './eviction/shared';
import notificationDispatchService from '../services/notificationDispatchService';
import { requireSessionOxyUserId } from '../utils/sessionUser';

/**
 * How many photos one request may hold.
 *
 * A ceiling rather than a guess: each is fetched whole, base64, through a JSON
 * envelope, so a request with fifty of them is a screen that takes a minute to
 * open. Six is enough to show a room from several angles, which is what the
 * cases these support actually look like.
 */
export const MAINTENANCE_ATTACHMENTS_MAX = 6;

const CATEGORIES = new Set<string>(MAINTENANCE_CATEGORIES);
const URGENCIES = new Set<string>(MAINTENANCE_URGENCIES);
const STATUSES = new Set<string>(MAINTENANCE_STATUSES);

/** A required, trimmed string within a length bound, or a 400. */
function requiredText(value: unknown, field: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) {
    throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
  }
  if (text.length > max) {
    throw new AppError(`${field} must be at most ${max} characters`, 400, 'VALIDATION_ERROR');
  }
  return text;
}

/**
 * Who to tell, and never the person who did it.
 *
 * A notification about your own action is noise, and worse than noise in a
 * thread two people are arguing in — it reads as though the other side replied.
 */
async function otherPartyOf(leaseId: string, actorOxyUserId: string): Promise<string | null> {
  const db = getDb();
  const actor = await maintenanceRoleOnLease(db, leaseId, actorOxyUserId);
  if (!actor) return null;
  const [row] = await db
    .select({
      landlordOxyUserId: leases.landlordOxyUserId,
      tenantOxyUserId: leases.tenantOxyUserId,
    })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  if (!row) return null;
  // The landlord hears from a tenant and vice versa. Co-tenants are not fanned
  // out to: a repair thread is between the household and the owner, and a
  // mailbox entry for every flatmate on every comment is how people turn
  // notifications off.
  return actor.role === 'tenant' ? row.landlordOxyUserId : row.tenantOxyUserId;
}

/** `GET /api/maintenance` — the caller's repair requests, newest first. */
export async function listRequests(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const { page, limit } = parsePagination(req.query);

    const result = await listMaintenanceRequests(getDb(), {
      oxyUserId,
      ...(req.query.leaseId === undefined ? {} : { leaseId: String(req.query.leaseId) }),
      ...(req.query.propertyId === undefined ? {} : { propertyId: String(req.query.propertyId) }),
      openOnly: req.query.openOnly === 'true',
      page,
      limit,
    });

    // The role is resolved per LEASE rather than once: a person can be the
    // landlord of one tenancy and the tenant of another, and one role applied
    // to the whole page would offer them the wrong buttons on half of it.
    const dtos = await Promise.all(
      result.requests.map(async (row) => {
        const access = await maintenanceRoleOnLease(getDb(), row.leaseId, oxyUserId);
        return toMaintenanceRequestDTO(row, access?.role ?? 'tenant');
      }),
    );

    res.json(paginationResponse(dtos, page, limit, result.total, 'Maintenance requests retrieved'));
  } catch (error) {
    next(error);
  }
}

/** `GET /api/maintenance/:id` — one request, with its thread and history. */
export async function getRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const hydrated = await findMaintenanceRequest(getDb(), String(req.params.id), oxyUserId);
    if (!hydrated) {
      throw new AppError('Maintenance request not found', 404, 'NOT_FOUND');
    }
    res.json(successResponse(toHydratedMaintenanceDTO(hydrated), 'Maintenance request retrieved'));
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/maintenance/:id/attachments` — a photo of what is broken.
 *
 * ## The bytes are re-encoded, and that is a privacy measure
 *
 * A phone writes GPS into the EXIF of a photo taken indoors. Storing the
 * upload verbatim would publish the home's exact coordinates to everyone who
 * can read the request — the precision leak ADR 0003 exists to stop, arriving
 * through a door nobody was watching. `uploadPrivateImage` decodes and
 * re-encodes, which drops it.
 *
 * ## Order: authorize, then store, then record
 *
 * The participation check runs against the request BEFORE any object is
 * written, so a stranger's upload never reaches the bucket. The row is written
 * last, and it is the row that can fail — which leaves an unreferenced object
 * rather than a row pointing at bytes that were never stored. That is the safe
 * side: an orphan costs storage, a dangling row is a photo that silently never
 * opens.
 */
export async function attachToRequest(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const requestId = String(req.params.id);

    const file = (req as unknown as { file?: { buffer: Buffer; mimetype: string } }).file;
    if (!file) {
      throw new AppError('A photo is required', 400, 'VALIDATION_ERROR');
    }

    // Authorize FIRST: nothing belonging to a stranger reaches the bucket.
    const hydrated = await findMaintenanceRequest(getDb(), requestId, oxyUserId);
    if (!hydrated) {
      throw new AppError('Maintenance request not found', 404, 'NOT_FOUND');
    }
    if (hydrated.attachments.length >= MAINTENANCE_ATTACHMENTS_MAX) {
      throw new AppError(
        `A request may hold at most ${MAINTENANCE_ATTACHMENTS_MAX} photos`,
        409,
        'ATTACHMENT_LIMIT',
      );
    }

    const stored = await imageUploadService.uploadPrivateImage(
      file.buffer,
      file.mimetype,
      `maintenance/${requestId}`,
    );

    const outcome = await addMaintenanceAttachment(getDb(), {
      requestId,
      oxyUserId,
      storageKey: stored.key,
      contentType: stored.contentType,
      bytes: stored.bytes,
    });
    if (!outcome.ok) {
      throw new AppError('Maintenance request not found', 404, 'NOT_FOUND');
    }

    res
      .status(201)
      .json(successResponse(toMaintenanceAttachmentDTO(outcome.attachment), 'Photo attached'));
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /api/maintenance/:id/attachments/:attachmentId` — one photo's bytes.
 *
 * Base64 in the ordinary envelope, for the reason
 * `applicationController.getApplicationDocument` gives at length: the Oxy
 * linked client owns auth and is JSON-only, and `AGENTS.md` forbids a second
 * manual token path, so there is no authenticated binary fetch to use. The
 * upload is capped, so the response is bounded.
 *
 * The repository resolves the attachment by BOTH its id and its request, under
 * the caller's participation — so an id from somebody else's repair resolves to
 * nothing and knowing one grants nothing.
 */
export async function getRequestAttachment(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const attachment = await findMaintenanceAttachment(getDb(), {
      requestId: String(req.params.id),
      attachmentId: String(req.params.attachmentId),
      oxyUserId,
    });
    if (!attachment) {
      throw new AppError('Attachment not found', 404, 'NOT_FOUND');
    }

    const file = await imageUploadService.readPrivateDocument(attachment.storageKey);
    if (!file) {
      // The row survives its object only if something deleted the bytes behind
      // it. "There is nothing to give you" is the honest answer, and it does
      // not say which of the two happened.
      throw new AppError('Attachment not found', 404, 'NOT_FOUND');
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.json(
      successResponse(
        {
          id: attachment.id,
          contentType: file.contentType,
          base64: file.buffer.toString('base64'),
        },
        'Attachment retrieved',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/** `POST /api/maintenance` — raise a request against a lease you are on. */
export async function createRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const oxyUserId = requireSessionOxyUserId(req);
    const leaseId = requiredText(req.body?.leaseId, 'leaseId', 64);

    // The lease is what grants access AND what supplies `propertyId`. Taking
    // the property from the body would let a caller file a repair against a
    // building they have nothing to do with — the client-supplied-owner-id
    // shape `AGENTS.md` forbids, wearing a different field name.
    const access = await maintenanceRoleOnLease(getDb(), leaseId, oxyUserId);
    if (!access) {
      throw new AppError('Maintenance request not found', 404, 'NOT_FOUND');
    }
    if (access.role !== 'tenant') {
      // A landlord recording their own repair is a different feature with a
      // different meaning, and it does not exist. Refusing is honest.
      throw new AppError(
        'Only a tenant or co-tenant can report a repair on this lease',
        403,
        'FORBIDDEN',
      );
    }

    const category = String(req.body?.category ?? '');
    if (!CATEGORIES.has(category)) {
      throw new AppError('category is not a known maintenance category', 400, 'VALIDATION_ERROR');
    }
    const urgencyRaw = req.body?.urgency === undefined ? 'normal' : String(req.body.urgency);
    if (!URGENCIES.has(urgencyRaw)) {
      throw new AppError('urgency is not a known urgency', 400, 'VALIDATION_ERROR');
    }

    const request = await createMaintenanceRequest(getDb(), {
      leaseId,
      propertyId: access.propertyId,
      reportedByOxyUserId: oxyUserId,
      category: category as MaintenanceCategory,
      urgency: urgencyRaw as MaintenanceUrgency,
      title: requiredText(req.body?.title, 'title', MAINTENANCE_TITLE_MAX),
      description: requiredText(req.body?.description, 'description', MAINTENANCE_DESCRIPTION_MAX),
    });

    const recipient = await otherPartyOf(leaseId, oxyUserId);
    void notificationDispatchService.createForUser(recipient, {
      type: 'maintenance_reported',
      title: 'New repair request',
      message: request.title,
      // An emergency is the one urgency that should reach somebody now; every
      // other one is ordinary mail. Mapping them all to `urgent` would make the
      // level meaningless, which is the same as not having it.
      priority: request.urgency === 'emergency' ? 'urgent' : 'medium',
      data: { requestId: request.id, leaseId, propertyId: access.propertyId },
    });

    res.status(201).json(
      successResponse(toMaintenanceRequestDTO(request, 'tenant'), 'Maintenance request created'),
    );
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
    const oxyUserId = requireSessionOxyUserId(req);
    const to = String(req.body?.status ?? '');
    if (!STATUSES.has(to)) {
      throw new AppError('status is not a known maintenance status', 400, 'VALIDATION_ERROR');
    }

    let scheduledFor: Date | undefined;
    if (req.body?.scheduledFor !== undefined) {
      const parsed = new Date(String(req.body.scheduledFor));
      if (!Number.isFinite(parsed.getTime())) {
        throw new AppError('scheduledFor is not a valid date', 400, 'VALIDATION_ERROR');
      }
      scheduledFor = parsed;
    }

    const outcome = await applyMaintenanceTransition(getDb(), {
      id: String(req.params.id),
      oxyUserId,
      to: to as MaintenanceStatus,
      ...(scheduledFor === undefined ? {} : { scheduledFor }),
    });

    if (!outcome.ok) {
      // Three refusals, three statuses. A 409 for an illegal move is the one
      // that matters: it says "the request has moved on", which is true and
      // actionable, where a 400 would read as "you sent nonsense" to somebody
      // whose screen was simply a few seconds stale.
      if (outcome.reason === 'not_found') {
        throw new AppError('Maintenance request not found', 404, 'NOT_FOUND');
      }
      if (outcome.reason === 'missing_schedule') {
        throw new AppError(
          'scheduledFor is required when scheduling a repair',
          400,
          'VALIDATION_ERROR',
        );
      }
      throw new AppError(
        'That change is not available from the current status',
        409,
        'MAINTENANCE_TRANSITION_ILLEGAL',
      );
    }

    const access = await maintenanceRoleOnLease(getDb(), outcome.request.leaseId, oxyUserId);
    const recipient = await otherPartyOf(outcome.request.leaseId, oxyUserId);
    void notificationDispatchService.createForUser(recipient, {
      type: 'maintenance_status_changed',
      title: 'Repair request updated',
      message: outcome.request.title,
      priority: 'medium',
      data: {
        requestId: outcome.request.id,
        from: outcome.from,
        to: outcome.request.status,
      },
    });

    res.json(
      successResponse(
        toMaintenanceRequestDTO(outcome.request, access?.role ?? 'tenant'),
        'Maintenance request updated',
      ),
    );
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
    const oxyUserId = requireSessionOxyUserId(req);
    const body = requiredText(req.body?.body, 'body', MAINTENANCE_COMMENT_MAX);

    const outcome = await addMaintenanceComment(getDb(), {
      requestId: String(req.params.id),
      oxyUserId,
      body,
    });
    if (!outcome.ok) {
      throw new AppError('Maintenance request not found', 404, 'NOT_FOUND');
    }

    const recipient = await otherPartyOf(outcome.request.leaseId, oxyUserId);
    void notificationDispatchService.createForUser(recipient, {
      type: 'maintenance_comment',
      title: 'New message on a repair request',
      message: outcome.request.title,
      priority: 'medium',
      data: { requestId: outcome.request.id },
    });

    res
      .status(201)
      .json(successResponse(toMaintenanceCommentDTO(outcome.comment), 'Comment added'));
  } catch (error) {
    next(error);
  }
}
