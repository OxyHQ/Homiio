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
 *    Since #518 §7.4 it takes a THIRD side (`co_tenant`), writes a row in
 *    `lease_signatures` bound to the terms and the contract document, and waits
 *    for every party before activating — see that function's own header.
 *  - **`recordPayment`** is DELETED, not ported. It had no caller anywhere in
 *    the package, so nothing in Homiio had ever recorded a payment. The rent
 *    LEDGER (`./paymentLedger.ts`) is now the one way one is recorded, and
 *    keeping this would have left a second writer able to mark an obligation
 *    `paid` with no evidence of who confirmed it. Same reasoning as
 *    `scheduleInspection` below — a method with no caller is a write path to
 *    invent, not one to preserve — with the ledger as the replacement.
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
  leaseSignatures,
  leases,
  properties,
} from '../schema';
import {
  LEASE_PAYMENT_METHODS,
  LEASE_PAYMENT_STATUSES,
  LEASE_SIGNATURE_PARTIES,
  LEASE_STATUSES,
} from '../schema/leases';
import { generatePaymentSchedule } from './paymentSchedule';
import { appendLeaseEvent, listLeaseEventsByLease } from './leaseEvents';
import { leaseTermsFingerprint } from './leaseTerms';
import {
  leaseSelection,
  type HydratedLease,
  type LeaseRow,
  type LeaseSignatureRow,
} from './leaseSerializer';

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

/**
 * What a hydration loads BEYOND the six always-present child tables.
 *
 * The timeline and the signature records are asked for rather than loaded
 * always, and the reason is which screens read them: the contracts INBOX draws
 * a card per lease and never a history, so loading both for a page of leases
 * would be two queries and a growing payload in service of nothing rendered.
 * The detail read asks for them; the list does not.
 */
export interface HydrateOptions {
  readonly events?: boolean;
  readonly signatures?: boolean;
}

/** Attach the children of `rows` to them, preserving the query's ordering. */
async function hydrate(
  db: DatabaseOrTransaction,
  rows: readonly LeaseRow[],
  options: HydrateOptions = {},
): Promise<HydratedLease[]> {
  const ids = rows.map((row) => row.id);
  const [children, events, signatures] = await Promise.all([
    loadChildren(db, ids),
    options.events ? listLeaseEventsByLease(db, ids) : Promise.resolve(undefined),
    options.signatures && ids.length > 0
      ? db
          .select()
          .from(leaseSignatures)
          .where(inArray(leaseSignatures.leaseId, ids))
          .orderBy(asc(leaseSignatures.leaseId), asc(leaseSignatures.signedAt), asc(leaseSignatures.id))
      : Promise.resolve(undefined),
  ]);
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
      ...(events ? { events: events.get(lease.id) ?? [] } : {}),
      ...(signatures
        ? { signatures: signatures.filter((row) => row.leaseId === lease.id) }
        : {}),
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
  options: HydrateOptions = {},
): Promise<HydratedLease | undefined> {
  const [row] = await db.select(leaseSelection()).from(leases).where(eq(leases.id, id)).limit(1);
  if (!row) return undefined;
  const [hydrated] = await hydrate(db, [row], options);
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

  // The timeline's first entry, in the transaction that creates the lease. It
  // replaces the one the client used to synthesize from `createdAt` — the same
  // fact, except that this one is a row and the next six are too.
  await appendLeaseEvent(db, {
    leaseId: row.id,
    eventType: 'created',
    actorOxyUserId: row.landlordOxyUserId,
  });

  const [hydrated] = await hydrate(db, [row], { events: true, signatures: true });
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

  if (input.coTenants) {
    // The set was just replaced with fresh rows carrying the default `pending`,
    // which would silently un-sign anybody still on the lease — and, because
    // activation now waits for every co-tenant, deactivate the lease as well.
    // The cache is re-derived from `lease_signatures`, which is why the
    // signature row deliberately holds no foreign key into this table.
    await restoreCoTenantSignatureCache(db, id);
  }

  // A lease nobody has signed yet is still being drafted, and a timeline that
  // recorded every keystroke of that would bury the events that matter. An
  // amendment is only an EVENT once there is a signature it could invalidate —
  // which is exactly the case a reader needs to see, because
  // `lease_signatures.terms_sha256` now names a version that no longer exists.
  const signed = await db
    .select({ id: leaseSignatures.id })
    .from(leaseSignatures)
    .where(eq(leaseSignatures.leaseId, id))
    .limit(1);
  if (signed.length > 0) {
    await appendLeaseEvent(db, {
      leaseId: id,
      eventType: 'amended',
      actorOxyUserId: landlordOxyUserId,
    });
  }

  const [hydrated] = await hydrate(db, [row], { events: true, signatures: true });
  return hydrated;
}

/**
 * Re-derive `lease_co_tenants.status` / `.signed_date` from `lease_signatures`.
 *
 * The cache's repair after the co-tenant set is replaced wholesale. Shared with
 * {@link signLease}, which writes it from the same source for the same reason:
 * two writers deriving one value from one table cannot disagree, while two
 * writers each maintaining their own copy eventually do.
 */
async function restoreCoTenantSignatureCache(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<void> {
  await db
    .update(leaseCoTenants)
    .set({
      status: 'signed',
      signedDate: sql`(
        select ${leaseSignatures.signedAt} from ${leaseSignatures}
        where ${leaseSignatures.leaseId} = ${leaseCoTenants.leaseId}
          and ${leaseSignatures.signerOxyUserId} = ${leaseCoTenants.oxyUserId}
      )`,
    })
    .where(
      and(
        eq(leaseCoTenants.leaseId, leaseId),
        sql`exists (
          select 1 from ${leaseSignatures}
          where ${leaseSignatures.leaseId} = ${leaseCoTenants.leaseId}
            and ${leaseSignatures.signerOxyUserId} = ${leaseCoTenants.oxyUserId}
        )`,
      ),
    );
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

/** Which seat on the lease somebody signed from. */
export type LeaseSignatory = (typeof LEASE_SIGNATURE_PARTIES)[number];

/** A lease's signatures, oldest first. */
export async function listLeaseSignatures(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<readonly LeaseSignatureRow[]> {
  return db
    .select()
    .from(leaseSignatures)
    .where(eq(leaseSignatures.leaseId, leaseId))
    .orderBy(asc(leaseSignatures.signedAt), asc(leaseSignatures.id));
}

/**
 * The document a signature binds to, or `undefined` when the lease has none.
 *
 * **The SERVER picks it, and it is always the most recent `lease_agreement`.**
 * The client does not name it, for the reason `AGENTS.md` gives about owner ids:
 * a party who could choose what they were signing could choose the addendum
 * they liked and leave the contract unsigned. `lease_agreement` rather than "the
 * newest document of any kind" because an inspection report and an insurance
 * certificate are evidence ABOUT a tenancy, not the agreement being entered
 * into — binding a signature to whichever was uploaded last would make the
 * binding depend on housekeeping.
 *
 * Returns the digest as well as the id, so the caller writes a pair Postgres can
 * check against `lease_documents` rather than a digest it computed itself.
 */
export async function findContractDocument(
  db: DatabaseOrTransaction,
  leaseId: string,
): Promise<{ id: string; name: string; contentSha256: string | null } | undefined> {
  const [row] = await db
    .select({
      id: leaseDocuments.id,
      name: leaseDocuments.name,
      contentSha256: leaseDocuments.contentSha256,
    })
    .from(leaseDocuments)
    .where(
      and(eq(leaseDocuments.leaseId, leaseId), eq(leaseDocuments.type, 'lease_agreement')),
    )
    // `id` breaks the tie: two documents uploaded in the same millisecond must
    // not make "the contract" depend on Postgres's row order.
    .orderBy(desc(leaseDocuments.uploadedDate), desc(leaseDocuments.id))
    .limit(1);
  return row;
}

export interface SignLeaseInput {
  readonly leaseId: string;
  readonly signerOxyUserId: string;
  readonly party: LeaseSignatory;
  /**
   * The digest the CLIENT displayed, when it sent one.
   *
   * Optional, and the optionality is a compatibility decision rather than a
   * weakening: an older client sends nothing and signs whatever the lease says
   * now, which is exactly what it did before this change. A client that sends
   * one gets the guarantee §7.4 asks for — it signed the version it was shown,
   * or it did not sign at all.
   */
  readonly expectedTermsSha256?: string;
  readonly activeStatus: LeaseStatusValue;
  readonly pendingStatus: LeaseStatusValue;
  readonly signableStatuses: readonly LeaseStatusValue[];
}

export type SignLeaseOutcome =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'terms_changed'; readonly currentTermsSha256: string }
  | {
      readonly kind: 'signed';
      readonly lease: HydratedLease;
      readonly signature: LeaseSignatureRow;
      /** False when this request found a signature already there (a double tap). */
      readonly recorded: boolean;
      /** True when THIS signature was the one that completed the lease. */
      readonly activated: boolean;
    };

/**
 * Record a signature — bound to the terms and to the contract document — move
 * the status, and generate the schedule if this completed the lease. ONE
 * transaction.
 *
 * This is `signAsLandlord`/`signAsTenant` PLUS the Mongoose `pre('save')` hook,
 * together, because that is what they were: the methods set the status and
 * `save()` ran the hook. Splitting them would let a lease commit as `active`
 * with no payment schedule, which is the state `generatePaymentSchedule` exists
 * to prevent.
 *
 * ## What changed, and why each half had to
 *
 * **A signature is a ROW now** (`lease_signatures`), carrying the digest of the
 * terms it was made against and, when the lease has one, the contract document
 * AND that document's content digest. The six columns on `leases` recorded that
 * somebody signed and never what they signed.
 *
 * **A CO-TENANT signs.** `lease_co_tenants.signed_date` and `.status` had no
 * writer at all while `isFullySigned` read them, and the controller refused a
 * co-tenant's signature outright. So the completion rule changes with them: a
 * lease goes `active` once the landlord, the tenant and EVERY co-tenant has
 * signed, rather than as soon as the two principals have. `status` and
 * `isFullySigned` now agree, which ends a disagreement `leaseSerializer.ts`
 * carried over from Mongo deliberately and which was always a lease calling
 * itself active while a named tenant had not signed.
 *
 * **The cache is written FROM the signatures, not beside them.** The four
 * columns on `leases` and the two on `lease_co_tenants` are recomputed in this
 * statement out of `lease_signatures`, so the only way for them to disagree with
 * the truth is for this transaction to roll back — in which case neither
 * exists.
 *
 * ## `SELECT … FOR UPDATE` is the whole concurrency story
 *
 * Two parties signing at the same instant is the ordinary case, not an exotic
 * one: the counterparty is notified the moment the first signature lands. Under
 * READ COMMITTED, without the lock, each transaction reads a set of signatures
 * that does not yet contain the other's, each concludes the lease is not
 * complete, and the lease stays `pending_signatures` FOREVER with every party
 * signed — a state no later request can repair, because
 * `lease_signatures_lease_signer_key` refuses the retry. The lock on the lease
 * row serializes the two, so the second one reads the first's signature and
 * activates. `leaseSignatureBinding.test.ts` forces that interleaving with a
 * held-open transaction rather than hoping two requests race.
 */
export async function signLease(
  db: DatabaseOrTransaction,
  input: SignLeaseInput,
): Promise<SignLeaseOutcome> {
  // The lock. Everything below reads state this statement has just frozen.
  const [locked] = await db
    .select({ id: leases.id, status: leases.status })
    .from(leases)
    .where(eq(leases.id, input.leaseId))
    .limit(1)
    .for('update');
  if (!locked) return { kind: 'not_found' };

  const before = await findLeaseById(db, input.leaseId);
  if (!before) return { kind: 'not_found' };

  const termsSha256 = leaseTermsFingerprint(before);
  if (input.expectedTermsSha256 !== undefined && input.expectedTermsSha256 !== termsSha256) {
    return { kind: 'terms_changed', currentTermsSha256: termsSha256 };
  }

  const document = await findContractDocument(db, input.leaseId);

  // `do nothing` rather than a read-then-insert: the read cannot see a row a
  // concurrent transaction has inserted and not committed, so the insert is the
  // only thing that can decide. An empty `returning` means somebody else won.
  const [inserted] = await db
    .insert(leaseSignatures)
    .values({
      leaseId: input.leaseId,
      signerOxyUserId: input.signerOxyUserId,
      party: input.party,
      termsSha256,
      documentId: document?.id ?? null,
      // Never computed here: it is copied from the row Postgres will check the
      // pair against, so a signature can only ever name a digest its document
      // really has.
      documentSha256: document?.contentSha256 ?? null,
    })
    .onConflictDoNothing({
      target: [leaseSignatures.leaseId, leaseSignatures.signerOxyUserId],
    })
    .returning();

  const signatures = await listLeaseSignatures(db, input.leaseId);
  const signature = inserted ?? signatures.find((row) => row.signerOxyUserId === input.signerOxyUserId);
  // Unreachable: the insert either produced a row or collided with one that is
  // now visible inside this transaction.
  if (!signature) return { kind: 'not_found' };

  const signerIds = new Set(signatures.map((row) => row.signerOxyUserId));
  const coTenants = await db
    .select({ oxyUserId: leaseCoTenants.oxyUserId })
    .from(leaseCoTenants)
    .where(eq(leaseCoTenants.leaseId, input.leaseId));
  const fullySigned =
    signerIds.has(before.lease.landlordOxyUserId) &&
    signerIds.has(before.lease.tenantOxyUserId) &&
    coTenants.every((coTenant) => signerIds.has(coTenant.oxyUserId));

  const landlordSignature = signatures.find(
    (row) => row.signerOxyUserId === before.lease.landlordOxyUserId,
  );
  const tenantSignature = signatures.find(
    (row) => row.signerOxyUserId === before.lease.tenantOxyUserId,
  );

  // Only a lease still awaiting signatures moves. An `active` lease gaining a
  // late co-tenant signature keeps its status; a terminated one is not revived
  // by somebody signing it.
  const wasSignable = input.signableStatuses.includes(locked.status as LeaseStatusValue);
  const nextStatus = !wasSignable
    ? (locked.status as LeaseStatusValue)
    : fullySigned
      ? input.activeStatus
      : input.pendingStatus;

  const [row] = await db
    .update(leases)
    .set({
      signaturesLandlordSigned: landlordSignature !== undefined,
      signaturesLandlordSignedDate: landlordSignature?.signedAt ?? null,
      signaturesTenantSigned: tenantSignature !== undefined,
      signaturesTenantSignedDate: tenantSignature?.signedAt ?? null,
      status: nextStatus,
    })
    .where(eq(leases.id, input.leaseId))
    .returning(leaseSelection());
  if (!row) return { kind: 'not_found' };

  // The co-tenant half of the same cache, derived rather than patched: one
  // statement sets every co-tenant who has a signature, and the `where` leaves
  // the rest alone. A co-tenant who never signed keeps whatever the landlord
  // recorded, `declined` included.
  await restoreCoTenantSignatureCache(db, input.leaseId);

  const activated = wasSignable && fullySigned && locked.status !== input.activeStatus;

  // The hook's second half: a lease that has just become active and has no
  // schedule gets one. The `count(*)` is what makes it idempotent — a second
  // signature on an already-active lease must not append a second schedule.
  if (nextStatus === input.activeStatus) {
    const [existing] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(leasePaymentSchedule)
      .where(eq(leasePaymentSchedule.leaseId, input.leaseId));
    if (existing.value === 0) {
      const instalments = generatePaymentSchedule({
        leaseTermsStartDate: before.lease.leaseTermsStartDate,
        leaseTermsEndDate: before.lease.leaseTermsEndDate,
        rentDetailsMonthlyRent: before.lease.rentDetailsMonthlyRent,
        rentDetailsDueDate: before.lease.rentDetailsDueDate,
        rentDetailsSecurityDeposit: before.lease.rentDetailsSecurityDeposit,
      });
      if (instalments.length > 0) {
        await db
          .insert(leasePaymentSchedule)
          .values(instalments.map((instalment) => ({ ...instalment, leaseId: input.leaseId })));
      }
    }
  }

  // The timeline, inside the same transaction as the fact it records. A `signed`
  // entry that could commit without its signature would be a history of
  // something that did not happen.
  if (inserted) {
    await appendLeaseEvent(db, {
      leaseId: input.leaseId,
      eventType: 'signed',
      actorOxyUserId: input.signerOxyUserId,
      // The SEAT, as a machine token the client renders through i18n — not the
      // account id, which the `actor` column already carries, and not a phrase.
      detail: input.party,
    });
  }
  if (activated) {
    await appendLeaseEvent(db, {
      leaseId: input.leaseId,
      eventType: 'activated',
      // No actor: the lease became active because the LAST signature arrived,
      // and crediting whoever signed last would attribute to one person a
      // transition every party caused.
      actorOxyUserId: null,
    });
  }

  const [hydrated] = await hydrate(db, [row], { events: true, signatures: true });
  return { kind: 'signed', lease: hydrated, signature, recorded: inserted !== undefined, activated };
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

  // The notice is an EVENT, and it was the clearest thing missing from the old
  // timeline: serving one moved a status and left nothing a party could point
  // at. `detail` carries the reason the server was given, verbatim — it is the
  // tenant's or the landlord's words, so it is not translated and not rephrased.
  await appendLeaseEvent(db, {
    leaseId: id,
    eventType: 'terminated',
    actorOxyUserId: input.givenByOxyUserId,
    detail: input.reason ?? null,
  });

  const [hydrated] = await hydrate(db, [row], { events: true, signatures: true });
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
 * `recordPayment` is DELETED (#518 §7.2, #519 §7.2).
 *
 * It set `status`, `paid_date`, `paid_amount`, `payment_method` and
 * `transaction_id` on an obligation — and it had **no caller anywhere in the
 * package**. So nothing in Homiio had ever recorded a payment; the only live
 * write was a landlord adding another due date.
 *
 * The ledger (`db/leases/paymentLedger.ts`) is now the one way a payment is
 * recorded, and the balance is DERIVED from it. Keeping this function would
 * have left a second writer able to mark an obligation `paid` behind the
 * ledger's back — two answers to "has this been paid", and the one that skipped
 * the ledger would carry no evidence of who confirmed it or when.
 *
 * The obligation's `paid_*` columns therefore stay null. Their coherence CHECK
 * (`lease_payment_schedule_paid_evidence_check`) now guards a path with no
 * writer, which is the strongest state it has ever been in, and it stays
 * because a future import path would need it.
 */


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

/**
 * One document, resolved by BOTH its id and its lease.
 *
 * The lease is part of the WHERE rather than something the caller checks after
 * loading the row: a document id from somebody else's tenancy then resolves to
 * nothing at all, so holding an id grants nothing even to a person who is a
 * party to some other lease. The viewer check stays in the controller, which is
 * where the session lives.
 */
export async function findLeaseDocument(
  db: DatabaseOrTransaction,
  leaseId: string,
  documentId: string,
): Promise<typeof leaseDocuments.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(leaseDocuments)
    .where(and(eq(leaseDocuments.leaseId, leaseId), eq(leaseDocuments.id, documentId)))
    .limit(1);
  return row;
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
