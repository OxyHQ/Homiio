/**
 * `tenant_applications` and its two child tables — the long-term rent
 * application, on Postgres.
 *
 * Empty in production, so this port has no backfill and no consistency window.
 *
 * ## `decided_at` was a HOOK and is now an EQUIVALENCE
 *
 * `TenantApplication.pre('save')` stamped `decidedAt` on the first move into a
 * terminal status — and it is a SAVE hook, so `findOneAndUpdate` bypassed it
 * entirely. That is how a `rejected` application with no `decided_at` reached a
 * landlord's dashboard sorted as if it were still open.
 *
 * `tenant_applications_decided_at_check` now states
 * `(status in terminal) = (decided_at is not null)`, so {@link decideApplication}
 * has to write both together — and CANNOT write a stamp for `reviewing`, which
 * the hook would happily have left behind on a later transition back. The
 * terminal set is `TENANT_APPLICATION_TERMINAL_STATUSES`, declared in the schema
 * precisely so the constraint and the writer name the same list.
 *
 * ## The children are inserted with the parent, in one transaction
 *
 * `reference_contacts[]` and `documents[]` were `{ _id: false }` subdocuments —
 * they had no ids and the backfill mints them (`db/MIGRATION-CONTRACT.md`). An
 * application that committed without its references is one a landlord judges on
 * incomplete information, so they are not a follow-up write.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import {
  tenantApplicationDocuments,
  tenantApplicationReferences,
  tenantApplications,
} from '../schema';
import {
  TENANT_APPLICATION_STATUSES,
  TENANT_APPLICATION_TERMINAL_STATUSES,
} from '../schema/applications';

/** An application status the CHECK accepts. */
export type TenantApplicationStatusValue = (typeof TENANT_APPLICATION_STATUSES)[number];

export type ApplicationRow = typeof tenantApplications.$inferSelect;
export type ApplicationReferenceRow = typeof tenantApplicationReferences.$inferSelect;
export type ApplicationDocumentRow = typeof tenantApplicationDocuments.$inferSelect;

/** The statuses an application can still be acted on from. */
export const ACTIVE_APPLICATION_STATUSES: readonly TenantApplicationStatusValue[] = [
  'submitted',
  'reviewing',
];

/** Whether `value` is one of the five declared statuses. */
export function isApplicationStatus(value: unknown): value is TenantApplicationStatusValue {
  return (
    typeof value === 'string' &&
    (TENANT_APPLICATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Whether a status is one the CHECK requires a `decided_at` for.
 *
 * Reads the schema's own tuple rather than restating the three values, so the
 * writer and `tenant_applications_decided_at_check` cannot drift.
 */
export function isTerminalApplicationStatus(status: TenantApplicationStatusValue): boolean {
  return (TENANT_APPLICATION_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** One application plus the children a response carries. */
export interface HydratedApplication {
  application: ApplicationRow;
  references: readonly ApplicationReferenceRow[];
  documents: readonly ApplicationDocumentRow[];
}

/** Attach the children of `rows`, preserving the query's ordering. */
async function hydrate(
  db: DatabaseOrTransaction,
  rows: readonly ApplicationRow[],
): Promise<HydratedApplication[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];

  const [references, documents] = await Promise.all([
    db
      .select()
      .from(tenantApplicationReferences)
      .where(inArray(tenantApplicationReferences.applicationId, ids)),
    db
      .select()
      .from(tenantApplicationDocuments)
      .where(inArray(tenantApplicationDocuments.applicationId, ids)),
  ]);

  const group = <T extends { applicationId: string }>(child: readonly T[]): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of child) {
      const existing = grouped.get(row.applicationId);
      if (existing) existing.push(row);
      else grouped.set(row.applicationId, [row]);
    }
    return grouped;
  };

  const referencesByApplication = group(references);
  const documentsByApplication = group(documents);

  return rows.map((application) => ({
    application,
    references: referencesByApplication.get(application.id) ?? [],
    documents: documentsByApplication.get(application.id) ?? [],
  }));
}

/** One application, hydrated. No ownership predicate — the caller decides. */
export async function findApplicationById(
  db: DatabaseOrTransaction,
  id: string,
): Promise<HydratedApplication | undefined> {
  const [row] = await db
    .select()
    .from(tenantApplications)
    .where(eq(tenantApplications.id, id))
    .limit(1);
  if (!row) return undefined;
  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

/** Does this applicant already hold an active application on this property? */
export async function findActiveApplicationForApplicant(
  db: DatabaseOrTransaction,
  propertyId: string,
  applicantOxyUserId: string,
): Promise<ApplicationRow | undefined> {
  const [row] = await db
    .select()
    .from(tenantApplications)
    .where(
      and(
        eq(tenantApplications.propertyId, propertyId),
        eq(tenantApplications.applicantOxyUserId, applicantOxyUserId),
        inArray(tenantApplications.status, [...ACTIVE_APPLICATION_STATUSES]),
      ),
    )
    .limit(1);
  return row;
}

export interface CreateApplicationInput {
  readonly columns: typeof tenantApplications.$inferInsert;
  readonly references: readonly Omit<
    typeof tenantApplicationReferences.$inferInsert,
    'id' | 'applicationId'
  >[];
  readonly documents: readonly Omit<
    typeof tenantApplicationDocuments.$inferInsert,
    'id' | 'applicationId'
  >[];
}

/** Insert an application with its references and documents, in one transaction. */
export async function createApplication(
  db: DatabaseOrTransaction,
  input: CreateApplicationInput,
): Promise<HydratedApplication> {
  const [row] = await db.insert(tenantApplications).values(input.columns).returning();

  if (input.references.length > 0) {
    await db
      .insert(tenantApplicationReferences)
      .values(input.references.map((reference) => ({ ...reference, applicationId: row.id })));
  }
  if (input.documents.length > 0) {
    await db
      .insert(tenantApplicationDocuments)
      .values(input.documents.map((document) => ({ ...document, applicationId: row.id })));
  }

  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

export interface ListApplicationsFilter {
  readonly applicantOxyUserId?: string;
  readonly landlordOxyUserId?: string;
  readonly status?: TenantApplicationStatusValue;
}

/** The predicate shared by the page and its `count(*)`, so the two agree. */
function listFilter(filter: ListApplicationsFilter): SQL {
  const clauses: SQL[] = [];
  if (filter.applicantOxyUserId !== undefined) {
    clauses.push(eq(tenantApplications.applicantOxyUserId, filter.applicantOxyUserId));
  }
  if (filter.landlordOxyUserId !== undefined) {
    clauses.push(eq(tenantApplications.landlordOxyUserId, filter.landlordOxyUserId));
  }
  if (filter.status !== undefined) clauses.push(eq(tenantApplications.status, filter.status));
  return clauses.length > 0 ? (and(...clauses) as SQL) : sql`true`;
}

export interface ListApplicationsResult {
  readonly applications: readonly HydratedApplication[];
  readonly total: number;
}

/** One page of applications, newest submission first. */
export async function listApplications(
  db: DatabaseOrTransaction,
  filter: ListApplicationsFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<ListApplicationsResult> {
  const where = listFilter(filter);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(tenantApplications)
      .where(where)
      .orderBy(desc(tenantApplications.submittedAt))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(tenantApplications)
      .where(where),
  ]);
  return { applications: await hydrate(db, rows), total: totalRow.value };
}

/**
 * Move an application to `nextStatus`, stamping `decided_at` iff that status is
 * terminal.
 *
 * `fromStatuses` is the precondition, carried in the `UPDATE`'s own predicate so
 * two landlords cannot both decide — the read that precedes this in the
 * controller chooses the ERROR, this chooses whether the write happens.
 *
 * The `decided_at` value is written on the terminal transition and cleared
 * otherwise, which is what the equivalence CHECK demands. Clearing matters: a
 * `submitted → reviewing` move on a row that somehow carries a stamp would be a
 * `23514` rather than a silent inconsistency.
 */
export async function decideApplication(
  db: DatabaseOrTransaction,
  id: string,
  nextStatus: TenantApplicationStatusValue,
  fromStatuses: readonly TenantApplicationStatusValue[],
  options: { readonly notes?: string } = {},
): Promise<HydratedApplication | undefined> {
  const values: Partial<typeof tenantApplications.$inferInsert> = {
    status: nextStatus,
    decidedAt: isTerminalApplicationStatus(nextStatus) ? new Date() : null,
  };
  if (options.notes !== undefined) values.notes = options.notes;

  const [row] = await db
    .update(tenantApplications)
    .set(values)
    .where(
      and(
        eq(tenantApplications.id, id),
        inArray(tenantApplications.status, [...fromStatuses]),
      ),
    )
    .returning();
  if (!row) return undefined;
  const [hydrated] = await hydrate(db, [row]);
  return hydrated;
}

/**
 * The wire shape the applications screens read.
 *
 * The Mongoose handlers returned `application.toJSON()` — every field, with the
 * two arrays inline — so this rebuilds that shape from the child tables. `id`,
 * never `_id`.
 */
export function serializeApplication(hydrated: HydratedApplication): Record<string, unknown> {
  const row = hydrated.application;
  return {
    id: row.id,
    propertyId: row.propertyId,
    applicantOxyUserId: row.applicantOxyUserId,
    landlordOxyUserId: row.landlordOxyUserId,
    moveInDate: row.moveInDate,
    leaseTermMonths: row.leaseTermMonths,
    monthlyIncome: row.monthlyIncome,
    employmentStatus: row.employmentStatus,
    status: row.status,
    notes: row.notes,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    referenceContacts: hydrated.references.map((reference) => ({
      id: reference.id,
      name: reference.name,
      relationship: reference.relationship,
      phone: reference.phone,
      email: reference.email,
    })),
    documents: hydrated.documents.map((document) => ({
      id: document.id,
      type: document.type,
      url: document.url,
      filename: document.filename,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
