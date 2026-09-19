/**
 * Repair requests, read and written (#518 §7.1, #519 §7.1).
 *
 * ## Authorization is in the QUERY, not in a check above it
 *
 * `AGENTS.md`: "Ownership is enforced in the REPOSITORY QUERY, so a non-owner
 * gets a 404 rather than a 403." Every function here takes an `oxyUserId` and
 * every predicate joins through `leases` with `partyFilter` — the same one
 * `listLeases` uses, so "who is on this tenancy" has exactly one definition.
 *
 * A caller cannot reach a request on somebody else's lease, and the answer they
 * get is "no such request" rather than "not yours", which is the right answer:
 * confirming the id exists is already telling them something.
 *
 * ## Transitions are checked against the shared table, under a lock
 *
 * {@link applyMaintenanceTransition} re-reads the row `FOR UPDATE` inside the
 * transaction and validates the move against `MAINTENANCE_TRANSITIONS` from
 * that re-read value. Checking the status the CALLER sent, or one read before
 * the transaction, is the lost-update shape: two landlords pressing "resolved"
 * on the same request both see `acknowledged`, both pass, and the second
 * silently overwrites the first's event.
 *
 * The event row and the status change are written in the SAME transaction, so
 * the history cannot disagree with the state it describes.
 */

import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  canTransitionMaintenance,
  maintenanceTransitionsFrom,
  type MaintenanceCategory,
  type MaintenanceRole,
  type MaintenanceStatus,
  type MaintenanceUrgency,
} from '@homiio/shared-types';

import type { DatabaseOrTransaction } from '../postgres';
import { leaseCoTenants, leases, maintenanceRequestComments, maintenanceRequestEvents, maintenanceRequests } from '../schema';

/**
 * Whether this account is on the lease at all, and on which side.
 *
 * `null` means "not a participant", which every caller turns into a 404.
 *
 * The landlord test comes FIRST and is exclusive: a person who somehow appears
 * as both — a landlord renting from themselves, which nothing forbids — is
 * treated as the landlord, because that is the role with the obligations. A
 * version that answered `tenant` would let them close their own repair without
 * ever resolving it.
 */
export async function maintenanceRoleOnLease(
  db: DatabaseOrTransaction,
  leaseId: string,
  oxyUserId: string,
): Promise<{ role: MaintenanceRole; propertyId: string } | null> {
  const [row] = await db
    .select({
      landlordOxyUserId: leases.landlordOxyUserId,
      tenantOxyUserId: leases.tenantOxyUserId,
      propertyId: leases.propertyId,
    })
    .from(leases)
    .where(eq(leases.id, leaseId))
    .limit(1);
  if (!row) return null;

  if (row.landlordOxyUserId === oxyUserId) return { role: 'landlord', propertyId: row.propertyId };
  if (row.tenantOxyUserId === oxyUserId) return { role: 'tenant', propertyId: row.propertyId };

  const [coTenant] = await db
    .select({ id: leaseCoTenants.id })
    .from(leaseCoTenants)
    .where(and(eq(leaseCoTenants.leaseId, leaseId), eq(leaseCoTenants.oxyUserId, oxyUserId)))
    .limit(1);
  // A co-tenant lives there, so they are a tenant for every purpose this domain
  // has: they can report, comment, and confirm a fix on their own home.
  return coTenant ? { role: 'tenant', propertyId: row.propertyId } : null;
}

/**
 * The predicate that scopes every read to one person's tenancies.
 *
 * A correlated `exists` rather than a join, so it composes with the request
 * table's own filters without changing the shape of the row or its count.
 */
function visibleToCaller(oxyUserId: string): SQL {
  return sql`exists (
    select 1 from ${leases}
    where ${leases.id} = ${maintenanceRequests.leaseId}
      and (
        ${leases.landlordOxyUserId} = ${oxyUserId}
        or ${leases.tenantOxyUserId} = ${oxyUserId}
        or exists (
          select 1 from ${leaseCoTenants}
          where ${leaseCoTenants.leaseId} = ${leases.id}
            and ${leaseCoTenants.oxyUserId} = ${oxyUserId}
        )
      )
  )`;
}

export type MaintenanceRequestRow = typeof maintenanceRequests.$inferSelect;
export type MaintenanceCommentRow = typeof maintenanceRequestComments.$inferSelect;
export type MaintenanceEventRow = typeof maintenanceRequestEvents.$inferSelect;

export interface ListMaintenanceFilter {
  readonly oxyUserId: string;
  readonly leaseId?: string;
  readonly propertyId?: string;
  /** Hide the two terminal states. The landlord surface's default question. */
  readonly openOnly?: boolean;
  readonly page: number;
  readonly limit: number;
}

export interface ListMaintenanceResult {
  readonly requests: readonly MaintenanceRequestRow[];
  readonly total: number;
}

/** The predicate shared by the page and its `count(*)`, so the two agree. */
function listFilter(filter: ListMaintenanceFilter): SQL {
  const clauses: SQL[] = [visibleToCaller(filter.oxyUserId)];
  if (filter.leaseId !== undefined) clauses.push(eq(maintenanceRequests.leaseId, filter.leaseId));
  if (filter.propertyId !== undefined) {
    clauses.push(eq(maintenanceRequests.propertyId, filter.propertyId));
  }
  if (filter.openOnly) {
    clauses.push(sql`${maintenanceRequests.status} not in ('closed', 'declined')`);
  }
  return and(...clauses) as SQL;
}

export async function listMaintenanceRequests(
  db: DatabaseOrTransaction,
  filter: ListMaintenanceFilter,
): Promise<ListMaintenanceResult> {
  const where = listFilter(filter);
  const [rows, [totals]] = await Promise.all([
    db
      .select()
      .from(maintenanceRequests)
      .where(where)
      .orderBy(desc(maintenanceRequests.createdAt))
      .limit(filter.limit)
      .offset((filter.page - 1) * filter.limit),
    db.select({ total: count() }).from(maintenanceRequests).where(where),
  ]);
  return { requests: rows, total: totals?.total ?? 0 };
}

export interface HydratedMaintenanceRequest {
  readonly request: MaintenanceRequestRow;
  readonly comments: readonly MaintenanceCommentRow[];
  readonly events: readonly MaintenanceEventRow[];
  /** The caller's own side of the lease, for the transitions they may take. */
  readonly role: MaintenanceRole;
}

/**
 * One request, with its thread and history, or `undefined`.
 *
 * `undefined` covers both "no such request" and "not yours" on purpose — see
 * the module header.
 */
export async function findMaintenanceRequest(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<HydratedMaintenanceRequest | undefined> {
  const [request] = await db
    .select()
    .from(maintenanceRequests)
    .where(and(eq(maintenanceRequests.id, id), visibleToCaller(oxyUserId)))
    .limit(1);
  if (!request) return undefined;

  const access = await maintenanceRoleOnLease(db, request.leaseId, oxyUserId);
  // Unreachable — the predicate above already required participation — but a
  // role is not something to default, so the read fails closed rather than
  // guessing `tenant` and handing somebody a confirm button.
  if (!access) return undefined;

  const [comments, events] = await Promise.all([
    db
      .select()
      .from(maintenanceRequestComments)
      .where(eq(maintenanceRequestComments.requestId, id))
      .orderBy(asc(maintenanceRequestComments.createdAt)),
    db
      .select()
      .from(maintenanceRequestEvents)
      .where(eq(maintenanceRequestEvents.requestId, id))
      .orderBy(asc(maintenanceRequestEvents.createdAt)),
  ]);

  return { request, comments, events, role: access.role };
}

export interface CreateMaintenanceInput {
  readonly leaseId: string;
  readonly propertyId: string;
  readonly reportedByOxyUserId: string;
  readonly category: MaintenanceCategory;
  readonly urgency: MaintenanceUrgency;
  readonly title: string;
  readonly description: string;
}

/**
 * Raise a request, and record its creation in the history.
 *
 * One transaction: a request with no opening event would make the timeline
 * start at whatever happened next, which reads as though the request appeared
 * in whatever state it is now in.
 */
export async function createMaintenanceRequest(
  db: DatabaseOrTransaction,
  input: CreateMaintenanceInput,
): Promise<MaintenanceRequestRow> {
  return db.transaction(async (tx) => {
    const [request] = await tx
      .insert(maintenanceRequests)
      .values({
        leaseId: input.leaseId,
        propertyId: input.propertyId,
        reportedByOxyUserId: input.reportedByOxyUserId,
        category: input.category,
        urgency: input.urgency,
        title: input.title,
        description: input.description,
      })
      .returning();

    await tx.insert(maintenanceRequestEvents).values({
      requestId: request.id,
      oxyUserId: input.reportedByOxyUserId,
      // A request is always raised by somebody living there; a landlord
      // recording their own repair is a different feature and does not exist.
      role: 'tenant',
      toStatus: 'open',
    });

    return request;
  });
}

/** Why a transition was refused. Distinct so the controller can map each one. */
export type MaintenanceTransitionFailure =
  /** No such request, or not this caller's. */
  | 'not_found'
  /** The move is not an edge of the state machine for this role. */
  | 'illegal'
  /** `scheduled` needs a date, and nothing else may carry one. */
  | 'missing_schedule';

export interface TransitionInput {
  readonly id: string;
  readonly oxyUserId: string;
  readonly to: MaintenanceStatus;
  /** Required for `scheduled`, refused otherwise. */
  readonly scheduledFor?: Date;
}

export type TransitionOutcome =
  | { readonly ok: true; readonly request: MaintenanceRequestRow; readonly from: MaintenanceStatus }
  | { readonly ok: false; readonly reason: MaintenanceTransitionFailure };

/**
 * Move a request, under a row lock.
 *
 * The lock is the whole of the concurrency story and it is worth being explicit
 * about what it prevents: two landlords (or one landlord in two tabs) pressing
 * "resolved" on the same `acknowledged` request. Without `FOR UPDATE` both read
 * `acknowledged`, both validate, both write — and the second overwrites the
 * first, leaving two events for one move and a `resolved_at` nobody can account
 * for. With it, the second waits, re-reads `resolved`, and is refused as
 * `illegal`, which is the truthful answer.
 */
export async function applyMaintenanceTransition(
  db: DatabaseOrTransaction,
  input: TransitionInput,
): Promise<TransitionOutcome> {
  return db.transaction(async (tx) => {
    // The lock and the visibility predicate in ONE statement: a separate
    // permission read would be a second round trip whose answer could be stale
    // by the time the update runs.
    const [locked] = await tx
      .select()
      .from(maintenanceRequests)
      .where(and(eq(maintenanceRequests.id, input.id), visibleToCaller(input.oxyUserId)))
      .limit(1)
      .for('update');
    if (!locked) return { ok: false, reason: 'not_found' } as const;

    const access = await maintenanceRoleOnLease(tx, locked.leaseId, input.oxyUserId);
    if (!access) return { ok: false, reason: 'not_found' } as const;

    const from = locked.status as MaintenanceStatus;
    if (!canTransitionMaintenance(from, input.to, access.role)) {
      return { ok: false, reason: 'illegal' } as const;
    }

    if (input.to === 'scheduled' && input.scheduledFor === undefined) {
      return { ok: false, reason: 'missing_schedule' } as const;
    }

    const [updated] = await tx
      .update(maintenanceRequests)
      .set({
        status: input.to,
        // The coherence CHECK is two-way, so leaving a stale date on a request
        // that has moved on would be refused by the database. Clearing it here
        // is what makes the move legal rather than a constraint violation.
        scheduledFor: input.to === 'scheduled' ? (input.scheduledFor ?? null) : null,
        // Stamped when the claim is made and NEVER cleared: "declared fixed on
        // the 3rd and was not" is the fact a reopen exists to preserve.
        ...(input.to === 'resolved' ? { resolvedAt: new Date() } : {}),
      })
      .where(eq(maintenanceRequests.id, input.id))
      .returning();

    await tx.insert(maintenanceRequestEvents).values({
      requestId: input.id,
      oxyUserId: input.oxyUserId,
      role: access.role,
      fromStatus: from,
      toStatus: input.to,
    });

    return { ok: true, request: updated, from } as const;
  });
}

export interface AddCommentInput {
  readonly requestId: string;
  readonly oxyUserId: string;
  readonly body: string;
}

export type AddCommentOutcome =
  | { readonly ok: true; readonly comment: MaintenanceCommentRow; readonly request: MaintenanceRequestRow }
  | { readonly ok: false; readonly reason: 'not_found' };

/**
 * Add a comment, with the author's role resolved from the lease.
 *
 * The role is stored rather than looked up on read, so a later change — a
 * co-tenant leaving, a property changing hands — does not retroactively
 * relabel what somebody said. A thread whose attributions move is a thread
 * nobody can rely on in a dispute, which is when these are read.
 */
export async function addMaintenanceComment(
  db: DatabaseOrTransaction,
  input: AddCommentInput,
): Promise<AddCommentOutcome> {
  const [request] = await db
    .select()
    .from(maintenanceRequests)
    .where(and(eq(maintenanceRequests.id, input.requestId), visibleToCaller(input.oxyUserId)))
    .limit(1);
  if (!request) return { ok: false, reason: 'not_found' };

  const access = await maintenanceRoleOnLease(db, request.leaseId, input.oxyUserId);
  if (!access) return { ok: false, reason: 'not_found' };

  const [comment] = await db
    .insert(maintenanceRequestComments)
    .values({
      requestId: input.requestId,
      oxyUserId: input.oxyUserId,
      role: access.role,
      body: input.body,
    })
    .returning();

  return { ok: true, comment, request };
}

/** What this caller may do next. The server's answer, computed from the shared table. */
export function availableTransitionsFor(
  status: MaintenanceStatus,
  role: MaintenanceRole,
): MaintenanceStatus[] {
  return maintenanceTransitionsFrom(status, role);
}
