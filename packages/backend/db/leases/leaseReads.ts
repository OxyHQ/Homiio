/**
 * `leases` and its six child tables — reads and writes, on Postgres.
 *
 * Empty in production, so this port has no backfill and no consistency window.
 *
 * ## Mongoose behaviour absorbed here rather than dropped
 *
 * `db/MIGRATION-CONTRACT.md` §"Model BEHAVIOUR the repository layer still has to
 * absorb" lists what a Mongoose method, hook or virtual used to do and now has
 * no counterpart. For `leases`:
 *
 *  - **`pre('save')`** did two things and BOTH move into {@link signLease}:
 *    promote `pending_signatures` → `active` once the lease is fully signed, and
 *    generate the payment schedule the first time a lease becomes `active`. A
 *    hook that fires on every save is replaced by the ONE transition that can
 *    trigger it, which is also the only place either condition can newly become
 *    true. `updateLease` cannot make a lease active — `EDITABLE_LEASE_FIELDS`
 *    has never contained `status`.
 *  - **`signAsLandlord` / `signAsTenant`** collapse into {@link signLease},
 *    which takes the side. They differed only in which columns they wrote.
 *  - **`recordPayment`** is {@link recordPayment}, and now has a CHECK behind it.
 *  - **`generatePaymentSchedule`** is `./paymentSchedule.ts`, a pure function.
 *  - **`scheduleInspection`** is NOT ported: nothing in this package calls it,
 *    and `lease_inspections.inspector` is declared free text on exactly that
 *    ground (see the schema). Porting a method with no caller would invent a
 *    write path rather than preserve one.
 *  - **The four virtuals** are computed by `./leaseSerializer.ts`.
 *  - **The five statics** (`findByProperty`, `findByTenant`, `findByLandlord`,
 *    `findActive`, `findExpiringSoon`) have no caller in this package either.
 *    `findActive`'s containment question is what `leases_term_range_gist`
 *    exists for; the index is in place for whoever writes that read.
 *
 * ## Everything a lease writes happens in ONE transaction
 *
 * A lease and its co-tenants, and a signature and the schedule it generates, are
 * single facts spread over several tables. `db.transaction(...)` is what keeps
 * them one — which is why every function here takes `DatabaseOrTransaction` and
 * not `Database`: `db/postgres.ts` records that a helper typed only as
 * `Database` silently forces its caller to run OUTSIDE the transaction.
 */

import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import {
  leaseCoTenants,
  leaseDocuments,
  leaseInspectionFindings,
  leaseInspections,
  leasePaymentSchedule,
  leaseSharedUtilityCosts,
  leases,
  properties,
} from '../schema';
import {
  LEASE_PAYMENT_METHODS,
  LEASE_PAYMENT_STATUSES,
  LEASE_STATUSES,
} from '../schema/leases';
import { generatePaymentSchedule } from './paymentSchedule';
import { leaseSelection, type HydratedLease, type LeaseRow } from './leaseSerializer';

/**
 * A lease status the CHECK accepts.
 *
 * Derived from the schema's own tuple rather than written as `string`: drizzle
 * types `status` as a literal union, so a `string` parameter does not fit the
 * column at all — and widening it with a cast would be exactly the hole the
 * union exists to close.
 */
export type LeaseStatusValue = (typeof LEASE_STATUSES)[number];

/** An instalment status the CHECK accepts. */
export type LeasePaymentStatusValue = (typeof LEASE_PAYMENT_STATUSES)[number];

/** A payment method the CHECK accepts. */
export type LeasePaymentMethodValue = (typeof LEASE_PAYMENT_METHODS)[number];

/**
 * Whether `value` is one of the declared payment methods.
 *
 * The narrowing has to happen BEFORE the update: a method the CHECK refuses
 * arrives as a `23514` from the driver, which is a 500 rather than the 400 the
 * caller earned — and it would arrive AFTER the row was already selected for
 * update, so the failure names a constraint rather than the field.
 */
export function isLeasePaymentMethod(value: unknown): value is LeasePaymentMethodValue {
  return (
    typeof value === 'string' && (LEASE_PAYMENT_METHODS as readonly string[]).includes(value)
  );
}

/**
 * The listing facts a lease is founded on: who owns it, and what it rents for.
 *
 * A four-column read rather than `findPropertyById` from `db/properties`: the
 * questions are "who owns this?" and "what is the long-term rent?", and
 * hydrating a listing's photos, documents and calendar to answer them would make
 * the lease path pay for a page render. It is also not a second serializer —
 * nothing here reshapes a property for the wire, which is the line that keeps
 * `db/properties/propertySerializer.ts` the single authority on that shape.
 */
export async function findPropertyLeaseBasis(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<
  | {
      id: string;
      oxyUserId: string | null;
      longTermRentMonthlyAmount: number | null;
      longTermRentCurrency: string | null;
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: properties.id,
      oxyUserId: properties.oxyUserId,
      longTermRentMonthlyAmount: properties.longTermRentMonthlyAmount,
      longTermRentCurrency: properties.longTermRentCurrency,
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row;
}

/**
 * Whether this tenant already holds a lease on this property in one of
 * `statuses`.
 *
 * The guard behind `POST /api/applications/:id/create-lease`, so approving two
 * applications for the same pair does not produce two contracts. It stays a READ
 * rather than a unique index: "active" is a set of statuses rather than a single
 * value, and a partial unique index over a status SET would also forbid the
 * legitimate case of a renewal drafted while the current lease is still running.
 */
export async function findLeaseForTenant(
  db: DatabaseOrTransaction,
  propertyId: string,
  tenantOxyUserId: string,
  statuses: readonly LeaseStatusValue[],
): Promise<{ id: string } | undefined> {
  const [row] = await db
    .select({ id: leases.id })
    .from(leases)
    .where(
      and(
        eq(leases.propertyId, propertyId),
        eq(leases.tenantOxyUserId, tenantOxyUserId),
        inArray(leases.status, [...statuses]),
      ),
    )
    .limit(1);
  return row;
}

/** Load every child table for a page of leases, keyed by lease id. */
async function loadChildren(
  db: DatabaseOrTransaction,
  leaseIds: readonly string[],
): Promise<{
  coTenants: Map<string, HydratedLease['coTenants'][number][]>;
  payments: Map<string, HydratedLease['paymentSchedule'][number][]>;
  documents: Map<string, HydratedLease['documents'][number][]>;
  inspections: Map<string, HydratedLease['inspections'][number][]>;
  findings: HydratedLease['inspectionFindings'];
  sharedCosts: Map<string, HydratedLease['sharedUtilityCosts'][number][]>;
}> {
  const ids = [...leaseIds];
  if (ids.length === 0) {
    return {
      coTenants: new Map(),
      payments: new Map(),
      documents: new Map(),
      inspections: new Map(),
      findings: [],
      sharedCosts: new Map(),
    };
  }

  const [coTenantRows, paymentRows, documentRows, inspectionRows, sharedCostRows] =
    await Promise.all([
      db.select().from(leaseCoTenants).where(inArray(leaseCoTenants.leaseId, ids)),
      db
        .select()
        .from(leasePaymentSchedule)
        .where(inArray(leasePaymentSchedule.leaseId, ids))
        // `(lease_id, due_date)` is the index, so this ordering is free — and it
        // is the order the schedule is generated in and read in.
        .orderBy(asc(leasePaymentSchedule.leaseId), asc(leasePaymentSchedule.dueDate)),
      db.select().from(leaseDocuments).where(inArray(leaseDocuments.leaseId, ids)),
      db
        .select()
        .from(leaseInspections)
        .where(inArray(leaseInspections.leaseId, ids))
        .orderBy(asc(leaseInspections.scheduledDate)),
      db
        .select()
        .from(leaseSharedUtilityCosts)
        .where(inArray(leaseSharedUtilityCosts.leaseId, ids)),
    ]);

  const inspectionIds = inspectionRows.map((row) => row.id);
  const findings = inspectionIds.length
    ? await db
        .select()
        .from(leaseInspectionFindings)
        .where(inArray(leaseInspectionFindings.inspectionId, inspectionIds))
    : [];

  const group = <T extends { leaseId: string }>(rows: readonly T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const existing = grouped.get(row.leaseId);
      if (existing) existing.push(row);
      else grouped.set(row.leaseId, [row]);
    }
    return grouped;
  };

  return {
    coTenants: group(coTenantRows),
    payments: group(paymentRows),
    documents: group(documentRows),
    inspections: group(inspectionRows),
    findings,
    sharedCosts: group(sharedCostRows),
  };
}

/** Attach the children of `rows` to them, preserving the query's ordering. */
async function hydrate(
  db: DatabaseOrTransaction,
  rows: readonly LeaseRow[],
): Promise<HydratedLease[]> {
  const children = await loadChildren(db, rows.map((row) => row.id));
  const inspectionIdsByLease = new Map<string, Set<string>>();
  for (const [leaseId, inspections] of children.inspections) {
    inspectionIdsByLease.set(leaseId, new Set(inspections.map((row) => row.id)));
  }

  return rows.map((lease) => {
    const ownInspectionIds = inspectionIdsByLease.get(lease.id) ?? new Set<string>();
    return {
      lease,
      coTenants: children.coTenants.get(lease.id) ?? [],
      paymentSchedule: children.payments.get(lease.id) ?? [],
      documents: children.documents.get(lease.id) ?? [],
      inspections: children.inspections.get(lease.id) ?? [],
      inspectionFindings: children.findings.filter((finding) =>
        ownInspectionIds.has(finding.inspectionId),
      ),
      sharedUtilityCosts: children.sharedCosts.get(lease.id) ?? [],
    };
  });
}

/**
 * "Every lease this person is a party to" — landlord, tenant, or co-tenant.
 *
 * The co-tenant arm was a `'coTenants.oxyUserId'` path match on the embedded
 * array; here it is an `EXISTS` over `lease_co_tenants`, which
 * `lease_co_tenants_lease_id_idx` does not serve on its own — the subquery
 * filters by `oxy_user_id` and joins back on `lease_id`. It stays an `EXISTS`
 * rather than a join so a person on the same lease twice cannot duplicate the
 * lease in the page, which is what makes the `count(*)` and the page agree.
 */
export function partyFilter(oxyUserId: string): SQL {
  return or(
    eq(leases.landlordOxyUserId, oxyUserId),
    eq(leases.tenantOxyUserId, oxyUserId),
    sql`exists (
      select 1 from ${leaseCoTenants}
      where ${leaseCoTenants.leaseId} = ${leases.id}
        and ${leaseCoTenants.oxyUserId} = ${oxyUserId}
    )`,
  ) as SQL;
}

export interface ListLeasesFilter {
  readonly oxyUserId: string;
  readonly status?: LeaseStatusValue;
  readonly propertyId?: string;
}

/** The predicate shared by the page and its `count(*)`, so the two agree. */
function listFilter(filter: ListLeasesFilter): SQL {
  const clauses: SQL[] = [partyFilter(filter.oxyUserId)];
  if (filter.status !== undefined) clauses.push(eq(leases.status, filter.status));
  if (filter.propertyId !== undefined) clauses.push(eq(leases.propertyId, filter.propertyId));
  return and(...clauses) as SQL;
}

export interface ListLeasesResult {
  readonly leases: readonly HydratedLease[];
  readonly total: number;
}

/** One page of a person's leases, newest first, hydrated. */
export async function listLeases(
  db: DatabaseOrTransaction,
  filter: ListLeasesFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<ListLeasesResult> {
  const where = listFilter(filter);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select(leaseSelection())
      .from(leases)
      .where(where)
      .orderBy(desc(leases.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ value: sql<number>`count(*)::int` }).from(leases).where(where),
  ]);
  return { leases: await hydrate(db, rows), total: totalRow.value };
}

/** One lease, hydrated. No ownership predicate — the caller decides access. */
export async function findLeaseById(
  db: DatabaseOrTransaction,
  id: string,
): Promise<HydratedLease | undefined> {
  const [row] = await db.select(leaseSelection()).from(leases).where(eq(leases.id, id)).limit(1);
  if (!row) return undefined;
  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

/**
 * The bare row, for the access checks that only need the parties and the status.
 *
 * Separate from {@link findLeaseById} because `updateLease`, `deleteLease` and
 * `signLease` all decide on `status` plus three id columns, and hydrating six
 * child tables to answer a 403 is work thrown away on every refusal.
 */
export async function findLeaseAccess(
  db: DatabaseOrTransaction,
  id: string,
): Promise<
  | {
      id: string;
      status: string;
      landlordOxyUserId: string;
      tenantOxyUserId: string;
      propertyId: string;
      coTenantOxyUserIds: string[];
    }
  | undefined
> {
  const [row] = await db
    .select({
      id: leases.id,
      status: leases.status,
      landlordOxyUserId: leases.landlordOxyUserId,
      tenantOxyUserId: leases.tenantOxyUserId,
      propertyId: leases.propertyId,
    })
    .from(leases)
    .where(eq(leases.id, id))
    .limit(1);
  if (!row) return undefined;

  const coTenants = await db
    .select({ oxyUserId: leaseCoTenants.oxyUserId })
    .from(leaseCoTenants)
    .where(eq(leaseCoTenants.leaseId, id));

  return { ...row, coTenantOxyUserIds: coTenants.map((coTenant) => coTenant.oxyUserId) };
}

/** The columns a caller may set on create or update, already flattened. */
export type LeaseWritableColumns = Partial<
  Omit<typeof leases.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>
>;

export interface CreateLeaseInput {
  readonly columns: typeof leases.$inferInsert;
  readonly coTenants: readonly Omit<typeof leaseCoTenants.$inferInsert, 'id' | 'leaseId'>[];
  readonly sharedUtilityCosts: readonly Omit<
    typeof leaseSharedUtilityCosts.$inferInsert,
    'id' | 'leaseId'
  >[];
}

/**
 * Insert a lease and its co-tenants in one transaction.
 *
 * The co-tenants are part of the lease a landlord submitted, not a follow-up
 * write: a lease that committed without them is one whose `isFullySigned` is
 * wrong from its first read.
 */
export async function createLease(
  db: DatabaseOrTransaction,
  input: CreateLeaseInput,
): Promise<HydratedLease> {
  const [row] = await db.insert(leases).values(input.columns).returning(leaseSelection());

  if (input.coTenants.length > 0) {
    await db
      .insert(leaseCoTenants)
      .values(input.coTenants.map((coTenant) => ({ ...coTenant, leaseId: row.id })));
  }
  if (input.sharedUtilityCosts.length > 0) {
    await db
      .insert(leaseSharedUtilityCosts)
      .values(input.sharedUtilityCosts.map((cost) => ({ ...cost, leaseId: row.id })));
  }

  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

export interface UpdateLeaseInput {
  readonly columns: LeaseWritableColumns;
  /** Replaces the whole set when present; left alone when omitted. */
  readonly coTenants?: readonly Omit<typeof leaseCoTenants.$inferInsert, 'id' | 'leaseId'>[];
  readonly sharedUtilityCosts?: readonly Omit<
    typeof leaseSharedUtilityCosts.$inferInsert,
    'id' | 'leaseId'
  >[];
}

/**
 * Apply an update to a lease the landlord still owns and may still edit.
 *
 * `coTenants` and `sharedCosts` are REPLACED rather than merged, because that is
 * what `Object.assign(lease, updates)` did to an embedded array: assigning the
 * field replaced it wholesale. Merging would be a new behaviour, and a landlord
 * who removes a co-tenant would find them still on the lease.
 */
export async function updateLease(
  db: DatabaseOrTransaction,
  id: string,
  landlordOxyUserId: string,
  editableStatuses: readonly LeaseStatusValue[],
  input: UpdateLeaseInput,
): Promise<HydratedLease | undefined> {
  const where = and(
    eq(leases.id, id),
    eq(leases.landlordOxyUserId, landlordOxyUserId),
    inArray(leases.status, [...editableStatuses]),
  ) as SQL;

  // `updated_at` carries drizzle's `$onUpdate`, so an empty `set` would restamp
  // the row for a request that changed nothing. `id` is a no-op assignment that
  // keeps the statement — and therefore the ownership predicate and the
  // RETURNING — valid when the body carried only child-table changes.
  const [row] = await db
    .update(leases)
    .set(Object.keys(input.columns).length > 0 ? input.columns : { id })
    .where(where)
    .returning(leaseSelection());
  if (!row) return undefined;

  if (input.coTenants) {
    await db.delete(leaseCoTenants).where(eq(leaseCoTenants.leaseId, id));
    if (input.coTenants.length > 0) {
      await db
        .insert(leaseCoTenants)
        .values(input.coTenants.map((coTenant) => ({ ...coTenant, leaseId: id })));
    }
  }
  if (input.sharedUtilityCosts) {
    await db.delete(leaseSharedUtilityCosts).where(eq(leaseSharedUtilityCosts.leaseId, id));
    if (input.sharedUtilityCosts.length > 0) {
      await db
        .insert(leaseSharedUtilityCosts)
        .values(input.sharedUtilityCosts.map((cost) => ({ ...cost, leaseId: id })));
    }
  }

  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

/**
 * Delete a lease the landlord owns, if its status still permits it.
 *
 * Every child table is `ON DELETE CASCADE`, so this one statement takes the
 * co-tenants, schedule, documents, inspections and their findings with it — the
 * relational equivalent of the document going away.
 */
export async function deleteLease(
  db: DatabaseOrTransaction,
  id: string,
  landlordOxyUserId: string,
  deletableStatuses: readonly LeaseStatusValue[],
): Promise<boolean> {
  const rows = await db
    .delete(leases)
    .where(
      and(
        eq(leases.id, id),
        eq(leases.landlordOxyUserId, landlordOxyUserId),
        inArray(leases.status, [...deletableStatuses]),
      ),
    )
    .returning({ id: leases.id });
  return rows.length > 0;
}

/** Which principal signed. */
export type LeaseSignatory = 'landlord' | 'tenant';

/**
 * Record a signature, move the status, and generate the schedule if this made
 * the lease active — all in ONE transaction.
 *
 * This is `signAsLandlord`/`signAsTenant` PLUS the `pre('save')` hook, together,
 * because that is what they were: the methods set the status and `save()` ran
 * the hook. Splitting them would let a lease commit as `active` with no payment
 * schedule, which is the state `generatePaymentSchedule` exists to prevent.
 *
 * **The status rule is the source's, co-tenants and all.** It goes `active` when
 * the OTHER principal has signed, consulting no co-tenant — while
 * `isFullySigned` does consult them. The two disagreeing is faithful; see
 * `./leaseSerializer.ts`.
 *
 * @returns The hydrated lease, or `undefined` when the id names no lease.
 */
export async function signLease(
  db: DatabaseOrTransaction,
  id: string,
  signatory: LeaseSignatory,
  digitalSignature: string | undefined,
  activeStatus: LeaseStatusValue,
  pendingStatus: LeaseStatusValue,
): Promise<HydratedLease | undefined> {
  const [current] = await db
    .select({
      id: leases.id,
      landlordSigned: leases.signaturesLandlordSigned,
      tenantSigned: leases.signaturesTenantSigned,
      startDate: leases.leaseTermsStartDate,
      endDate: leases.leaseTermsEndDate,
      monthlyRent: leases.rentDetailsMonthlyRent,
      dueDate: leases.rentDetailsDueDate,
      securityDeposit: leases.rentDetailsSecurityDeposit,
    })
    .from(leases)
    .where(eq(leases.id, id))
    .limit(1);
  if (!current) return undefined;

  const counterpartySigned =
    signatory === 'landlord' ? current.tenantSigned : current.landlordSigned;
  const nextStatus = counterpartySigned ? activeStatus : pendingStatus;
  const signedAt = new Date();

  const values: Partial<typeof leases.$inferInsert> =
    signatory === 'landlord'
      ? {
          signaturesLandlordSigned: true,
          signaturesLandlordSignedDate: signedAt,
          signaturesLandlordDigitalSignature: digitalSignature,
          status: nextStatus,
        }
      : {
          signaturesTenantSigned: true,
          signaturesTenantSignedDate: signedAt,
          signaturesTenantDigitalSignature: digitalSignature,
          status: nextStatus,
        };

  const [row] = await db
    .update(leases)
    .set(values)
    .where(eq(leases.id, id))
    .returning(leaseSelection());
  if (!row) return undefined;

  // The hook's second half: a lease that has just become active and has no
  // schedule gets one. The `count(*)` is what makes it idempotent — a second
  // signature on an already-active lease must not append a second schedule.
  if (nextStatus === activeStatus) {
    const [existing] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(leasePaymentSchedule)
      .where(eq(leasePaymentSchedule.leaseId, id));
    if (existing.value === 0) {
      const instalments = generatePaymentSchedule({
        leaseTermsStartDate: current.startDate,
        leaseTermsEndDate: current.endDate,
        rentDetailsMonthlyRent: current.monthlyRent,
        rentDetailsDueDate: current.dueDate,
        rentDetailsSecurityDeposit: current.securityDeposit,
      });
      if (instalments.length > 0) {
        await db
          .insert(leasePaymentSchedule)
          .values(instalments.map((instalment) => ({ ...instalment, leaseId: id })));
      }
    }
  }

  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

/** Serve a termination notice and close the lease. */
export async function terminateLease(
  db: DatabaseOrTransaction,
  id: string,
  input: {
    readonly givenByOxyUserId: string;
    readonly effectiveDate: Date;
    readonly reason?: string;
    readonly terminatedStatus: LeaseStatusValue;
  },
): Promise<HydratedLease | undefined> {
  const [row] = await db
    .update(leases)
    .set({
      terminationNoticeGivenByOxyUserId: input.givenByOxyUserId,
      terminationNoticeGivenDate: new Date(),
      terminationNoticeEffectiveDate: input.effectiveDate,
      terminationNoticeReason: input.reason,
      terminationNoticeAcknowledged: false,
      status: input.terminatedStatus,
    })
    .where(eq(leases.id, id))
    .returning(leaseSelection());
  if (!row) return undefined;
  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

/** One page of a lease's instalments, optionally filtered by status. */
export async function listLeasePayments(
  db: DatabaseOrTransaction,
  leaseId: string,
  filter: { readonly status?: LeasePaymentStatusValue },
  page: { readonly limit: number; readonly offset: number },
): Promise<{ rows: readonly (typeof leasePaymentSchedule.$inferSelect)[]; total: number }> {
  const clauses: SQL[] = [eq(leasePaymentSchedule.leaseId, leaseId)];
  if (filter.status !== undefined) clauses.push(eq(leasePaymentSchedule.status, filter.status));
  const where = and(...clauses) as SQL;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(leasePaymentSchedule)
      .where(where)
      .orderBy(asc(leasePaymentSchedule.dueDate))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(leasePaymentSchedule)
      .where(where),
  ]);
  return { rows, total: totalRow.value };
}

/** Append one instalment to a lease's schedule. */
export async function addLeasePayment(
  db: DatabaseOrTransaction,
  leaseId: string,
  input: Omit<typeof leasePaymentSchedule.$inferInsert, 'id' | 'leaseId'>,
): Promise<typeof leasePaymentSchedule.$inferSelect> {
  const [row] = await db
    .insert(leasePaymentSchedule)
    .values({ ...input, leaseId })
    .returning();
  return row;
}

/**
 * Mark an instalment paid.
 *
 * The port of `recordPayment`, and the CHECK is now behind it:
 * `lease_payment_schedule_paid_evidence_check` requires a `paid` row to carry
 * BOTH `paid_date` and `paid_amount`, so a caller that wrote only the status
 * would be refused rather than storing a payment nobody can evidence. All four
 * columns are written together here, exactly as the method wrote them.
 *
 * @returns The row, or `undefined` when the instalment is not on that lease —
 *   where the method threw `Error('Payment not found')`. A missing row is a 404
 *   the caller shapes, not an exception.
 */
export async function recordPayment(
  db: DatabaseOrTransaction,
  leaseId: string,
  paymentId: string,
  input: {
    readonly amount: number;
    readonly paymentMethod?: LeasePaymentMethodValue;
    readonly transactionId?: string;
    readonly paidStatus: LeasePaymentStatusValue;
  },
): Promise<typeof leasePaymentSchedule.$inferSelect | undefined> {
  const [row] = await db
    .update(leasePaymentSchedule)
    .set({
      status: input.paidStatus,
      paidDate: new Date(),
      paidAmount: input.amount,
      paymentMethod: input.paymentMethod,
      transactionId: input.transactionId,
    })
    .where(
      and(eq(leasePaymentSchedule.id, paymentId), eq(leasePaymentSchedule.leaseId, leaseId)),
    )
    .returning();
  return row;
}

/** A lease's documents. */
export async function listLeaseDocuments(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<readonly (typeof leaseDocuments.$inferSelect)[]> {
  return db
    .select()
    .from(leaseDocuments)
    .where(eq(leaseDocuments.leaseId, leaseId))
    .orderBy(asc(leaseDocuments.uploadedDate));
}

/** Attach a document to a lease. */
export async function addLeaseDocument(
  db: DatabaseOrTransaction,
  leaseId: string,
  input: Omit<typeof leaseDocuments.$inferInsert, 'id' | 'leaseId'>,
): Promise<typeof leaseDocuments.$inferSelect> {
  const [row] = await db
    .insert(leaseDocuments)
    .values({ ...input, leaseId })
    .returning();
  return row;
}
