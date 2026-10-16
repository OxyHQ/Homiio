/**
 * Repair requests (#518 §7.1, #519 §7.1) — the use cases behind
 * `/api/maintenance` and the catalogue's maintenance tools.
 *
 * ## Authorization is not here
 *
 * Every read and write goes through `db/maintenance/maintenanceRepository.ts`,
 * whose predicates join through `leases`. `AGENTS.md`: "Ownership is enforced in
 * the REPOSITORY QUERY, so a non-owner gets a 404 rather than a 403." These use
 * cases therefore have no membership check of their own to fall out of step
 * with one — they validate INPUT and map refusals onto `AppError`s.
 *
 * ## Notifications are dispatched AFTER the write, and swallow
 *
 * `notificationDispatchService.createForUser`, per the one-chokepoint rule. A
 * mailbox row failing must never roll back a repair somebody reported — the
 * dispatcher swallows by contract, and the `void` at each call site is the
 * deliberate expression of that, not an unhandled promise.
 *
 * ## Photos are re-encoded, and that is a privacy measure
 *
 * A phone writes GPS into the EXIF of a photo taken indoors. Storing the upload
 * verbatim would publish the home's exact coordinates to everyone who can read
 * the request — the precision leak ADR 0003 exists to stop. `uploadPrivateImage`
 * decodes and re-encodes, which drops it.
 */

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
  createMaintenanceRequest as insertMaintenanceRequest,
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
import { AppError } from '../middlewares/errorHandler';
import { readPrivateDocument, storePrivateImage } from '../services/files/privateDocuments';
import notificationDispatchService from '../services/notificationDispatchService';

/**
 * How many photos one request may hold.
 *
 * A ceiling rather than a guess: each is fetched whole, base64, through a JSON
 * envelope, so a request with fifty of them is a screen that takes a minute to
 * open. Six is enough to show a room from several angles.
 */
export const MAINTENANCE_ATTACHMENTS_MAX = 6;

const CATEGORIES = new Set<string>(MAINTENANCE_CATEGORIES);
const URGENCIES = new Set<string>(MAINTENANCE_URGENCIES);
const STATUSES = new Set<string>(MAINTENANCE_STATUSES);

const NOT_FOUND = () => new AppError('Maintenance request not found', 404, 'NOT_FOUND');

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
  // out to: a repair thread is between the household and the owner.
  return actor.role === 'tenant' ? row.landlordOxyUserId : row.tenantOxyUserId;
}

export interface MaintenanceListInput {
  readonly leaseId?: string;
  readonly propertyId?: string;
  readonly openOnly?: boolean;
  readonly page: number;
  readonly limit: number;
}

/** The person's repair requests, newest first, each with their role on its lease. */
export async function listMyMaintenanceRequests(oxyUserId: string, input: MaintenanceListInput) {
  const result = await listMaintenanceRequests(getDb(), {
    oxyUserId,
    ...(input.leaseId === undefined ? {} : { leaseId: input.leaseId }),
    ...(input.propertyId === undefined ? {} : { propertyId: input.propertyId }),
    openOnly: input.openOnly === true,
    page: input.page,
    limit: input.limit,
  });

  // The role is resolved per LEASE rather than once: a person can be the
  // landlord of one tenancy and the tenant of another.
  const requests = await Promise.all(
    result.requests.map(async (row) => {
      const access = await maintenanceRoleOnLease(getDb(), row.leaseId, oxyUserId);
      return toMaintenanceRequestDTO(row, access?.role ?? 'tenant');
    }),
  );
  return { requests, total: result.total, page: input.page, limit: input.limit };
}

/** One request, with its thread and history. */
export async function getMaintenanceRequest(oxyUserId: string, requestId: string) {
  const hydrated = await findMaintenanceRequest(getDb(), requestId, oxyUserId);
  if (!hydrated) throw NOT_FOUND();
  return toHydratedMaintenanceDTO(hydrated);
}

/** Raise a request against a lease the person is a tenant or co-tenant on. */
export async function createMaintenanceRequest(
  oxyUserId: string,
  input: {
    readonly leaseId: unknown;
    readonly category: unknown;
    readonly urgency?: unknown;
    readonly title: unknown;
    readonly description: unknown;
  },
) {
  const leaseId = requiredText(input.leaseId, 'leaseId', 64);

  // The lease is what grants access AND what supplies `propertyId`. Taking the
  // property from the input would let a caller file a repair against a building
  // they have nothing to do with.
  const access = await maintenanceRoleOnLease(getDb(), leaseId, oxyUserId);
  if (!access) throw NOT_FOUND();
  if (access.role !== 'tenant') {
    throw new AppError(
      'Only a tenant or co-tenant can report a repair on this lease',
      403,
      'FORBIDDEN',
    );
  }

  const category = String(input.category ?? '');
  if (!CATEGORIES.has(category)) {
    throw new AppError('category is not a known maintenance category', 400, 'VALIDATION_ERROR');
  }
  const urgency = input.urgency === undefined ? 'normal' : String(input.urgency);
  if (!URGENCIES.has(urgency)) {
    throw new AppError('urgency is not a known urgency', 400, 'VALIDATION_ERROR');
  }

  const request = await insertMaintenanceRequest(getDb(), {
    leaseId,
    propertyId: access.propertyId,
    reportedByOxyUserId: oxyUserId,
    category: category as MaintenanceCategory,
    urgency: urgency as MaintenanceUrgency,
    title: requiredText(input.title, 'title', MAINTENANCE_TITLE_MAX),
    description: requiredText(input.description, 'description', MAINTENANCE_DESCRIPTION_MAX),
  });

  const recipient = await otherPartyOf(leaseId, oxyUserId);
  void notificationDispatchService.createForUser(recipient, {
    type: 'maintenance_reported',
    title: 'New repair request',
    message: request.title,
    // An emergency is the one urgency that should reach somebody now.
    priority: request.urgency === 'emergency' ? 'urgent' : 'medium',
    data: { requestId: request.id, leaseId, propertyId: access.propertyId },
  });

  return toMaintenanceRequestDTO(request, 'tenant');
}

/** Move a request along the state machine. */
export async function transitionMaintenanceRequest(
  oxyUserId: string,
  requestId: string,
  input: { readonly status: unknown; readonly scheduledFor?: unknown },
) {
  const to = String(input.status ?? '');
  if (!STATUSES.has(to)) {
    throw new AppError('status is not a known maintenance status', 400, 'VALIDATION_ERROR');
  }

  let scheduledFor: Date | undefined;
  if (input.scheduledFor !== undefined) {
    const parsed = new Date(String(input.scheduledFor));
    if (!Number.isFinite(parsed.getTime())) {
      throw new AppError('scheduledFor is not a valid date', 400, 'VALIDATION_ERROR');
    }
    scheduledFor = parsed;
  }

  const outcome = await applyMaintenanceTransition(getDb(), {
    id: requestId,
    oxyUserId,
    to: to as MaintenanceStatus,
    ...(scheduledFor === undefined ? {} : { scheduledFor }),
  });

  if (!outcome.ok) {
    // A 409 for an illegal move says "the request has moved on", which is true
    // and actionable, where a 400 would read as "you sent nonsense".
    if (outcome.reason === 'not_found') throw NOT_FOUND();
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

  return toMaintenanceRequestDTO(outcome.request, access?.role ?? 'tenant');
}

/** Say something on a request's thread. */
export async function commentOnMaintenanceRequest(
  oxyUserId: string,
  requestId: string,
  input: { readonly body: unknown },
) {
  const body = requiredText(input.body, 'body', MAINTENANCE_COMMENT_MAX);

  const outcome = await addMaintenanceComment(getDb(), { requestId, oxyUserId, body });
  if (!outcome.ok) throw NOT_FOUND();

  const recipient = await otherPartyOf(outcome.request.leaseId, oxyUserId);
  void notificationDispatchService.createForUser(recipient, {
    type: 'maintenance_comment',
    title: 'New message on a repair request',
    message: outcome.request.title,
    priority: 'medium',
    data: { requestId: outcome.request.id },
  });

  return toMaintenanceCommentDTO(outcome.comment);
}

/**
 * Attach a photo of what is broken.
 *
 * Order: authorize, then store, then record. The participation check runs
 * BEFORE any object is written, so a stranger's upload never reaches the
 * bucket; the row is written last, which leaves an unreferenced object rather
 * than a row pointing at bytes that were never stored.
 */
export async function attachMaintenancePhoto(
  oxyUserId: string,
  requestId: string,
  file: { readonly buffer: Buffer; readonly mimetype: string } | undefined,
) {
  if (!file) throw new AppError('A photo is required', 400, 'VALIDATION_ERROR');

  const hydrated = await findMaintenanceRequest(getDb(), requestId, oxyUserId);
  if (!hydrated) throw NOT_FOUND();
  if (hydrated.attachments.length >= MAINTENANCE_ATTACHMENTS_MAX) {
    throw new AppError(
      `A request may hold at most ${MAINTENANCE_ATTACHMENTS_MAX} photos`,
      409,
      'ATTACHMENT_LIMIT',
    );
  }

  const stored = await storePrivateImage(
    { ownerOxyUserId: oxyUserId, kind: 'maintenance_request', entityId: requestId },
    file.buffer,
  );

  const outcome = await addMaintenanceAttachment(getDb(), {
    requestId,
    oxyUserId,
    storageKey: stored.ref,
    contentType: stored.contentType,
    bytes: stored.bytes,
  });
  if (!outcome.ok) throw NOT_FOUND();
  return toMaintenanceAttachmentDTO(outcome.attachment);
}

/**
 * One photo's bytes, to a party of the request and nobody else.
 *
 * The repository resolves the attachment by BOTH its id and its request, under
 * the caller's participation — an id from somebody else's repair resolves to
 * nothing.
 */
export async function readMaintenanceAttachment(
  oxyUserId: string,
  requestId: string,
  attachmentId: string,
) {
  const attachment = await findMaintenanceAttachment(getDb(), {
    requestId,
    attachmentId,
    oxyUserId,
  });
  if (!attachment) throw new AppError('Attachment not found', 404, 'NOT_FOUND');

  const file = await readPrivateDocument(attachment.storageKey);
  // The row survives its object only if something deleted the bytes behind it.
  if (!file) throw new AppError('Attachment not found', 404, 'NOT_FOUND');

  return {
    id: attachment.id,
    contentType: file.contentType,
    base64: file.buffer.toString('base64'),
  };
}
