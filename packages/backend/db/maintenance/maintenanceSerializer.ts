/**
 * Maintenance rows → the wire DTO the tenancy screens read.
 *
 * ## What is NOT in the DTO
 *
 * Nothing is stripped here, and that is worth saying explicitly rather than
 * leaving as an absence: these three tables hold no protected column, no
 * credential and no coordinate. The only identity they carry is an
 * `oxy_user_id`, which every participant of the lease can already see on the
 * lease itself — a thread where you cannot tell who said what is not a thread.
 *
 * ## `availableTransitions` is computed HERE
 *
 * From the shared `maintenanceTransitionsFrom`, against the caller's own role.
 * The client cannot derive it: it does not know which side of the lease it is
 * on without asking, and a screen that guessed would draw a landlord's buttons
 * for a tenant. Computing it from the SAME table the repository validates
 * against is what stops the two from disagreeing — an offered button that 409s
 * is a worse answer than a button that is not drawn.
 */

import {
  maintenanceTransitionsFrom,
  type MaintenanceComment,
  type MaintenanceEvent,
  type MaintenanceRequest,
  type MaintenanceRole,
  type MaintenanceStatus,
} from '@homiio/shared-types';

import type {
  HydratedMaintenanceRequest,
  MaintenanceCommentRow,
  MaintenanceEventRow,
  MaintenanceRequestRow,
} from './maintenanceRepository';

const iso = (value: Date | null): string | undefined => value?.toISOString();

/**
 * A request as a LIST row: no thread, no history.
 *
 * `availableTransitions` is present even here, because the list is where the
 * landlord's "acknowledge" and the tenant's "confirm" actions live — a list
 * that could not offer them would send somebody into a detail screen to press
 * one button.
 */
export function toMaintenanceRequestDTO(
  row: MaintenanceRequestRow,
  role: MaintenanceRole,
): MaintenanceRequest {
  return {
    id: row.id,
    leaseId: row.leaseId,
    propertyId: row.propertyId,
    reportedByOxyUserId: row.reportedByOxyUserId,
    category: row.category,
    urgency: row.urgency,
    status: row.status,
    title: row.title,
    description: row.description,
    ...(iso(row.scheduledFor) ? { scheduledFor: iso(row.scheduledFor)! } : {}),
    ...(iso(row.resolvedAt) ? { resolvedAt: iso(row.resolvedAt)! } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    availableTransitions: maintenanceTransitionsFrom(row.status as MaintenanceStatus, role),
  };
}

export function toMaintenanceCommentDTO(row: MaintenanceCommentRow): MaintenanceComment {
  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    role: row.role,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toMaintenanceEventDTO(row: MaintenanceEventRow): MaintenanceEvent {
  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    role: row.role,
    ...(row.fromStatus ? { from: row.fromStatus as MaintenanceStatus } : {}),
    to: row.toStatus as MaintenanceStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One request with its thread and history. */
export function toHydratedMaintenanceDTO(
  hydrated: HydratedMaintenanceRequest,
): MaintenanceRequest {
  return {
    ...toMaintenanceRequestDTO(hydrated.request, hydrated.role),
    comments: hydrated.comments.map(toMaintenanceCommentDTO),
    events: hydrated.events.map(toMaintenanceEventDTO),
  };
}
