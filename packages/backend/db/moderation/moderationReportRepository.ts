/**
 * `moderation_reports` — a report Homiio has taken, and everything that happened
 * to it afterwards.
 *
 * Nothing here is a verdict. CrowdSource owns cases, reviews and decisions; the
 * `decision_*` columns are a CACHE of a published revision, overwritten by a
 * later revision and never edited in place.
 *
 * ## `reporter` became `reporter_oxy_user_id`
 *
 * Mongo named the field `reporter`. `db/schema/moderation.ts` renamed it to match
 * `listing_reports` and `eviction_reports`, which hold the same fact — and, more
 * than cosmetics, to bring it inside `isOxyAccountColumn` so the foreign-key gate
 * CLASSIFIES it instead of skipping a column whose name says nothing about what
 * it holds. It is an Oxy account id: a foreign service's primary key, so it
 * carries no foreign key of its own, here or anywhere.
 *
 * ## The duplicate check is the INDEX, not a preceding read
 *
 * Mongo's intake read `findOne({reporter, reportedType, reportedId})` and then
 * inserted, which is a window two concurrent submissions both pass.
 * `moderation_reports_reporter_object_key` is a unique index over exactly that
 * triple, so {@link insertModerationReport} inserts and converges on `23505`.
 * The read is kept only to ANSWER with the existing row — the caller needs its id
 * to tell the reporter "already submitted" — and it is no longer what decides.
 */

import { and, asc, count, eq, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import { getDb, inSavepoint, type DatabaseOrTransaction } from '../postgres';
import { moderationReports } from '../schema/moderation';
import { isUniqueViolation } from '../uniqueViolation';

export type ModerationReportRow = typeof moderationReports.$inferSelect;
export type ModerationReportInsert = typeof moderationReports.$inferInsert;

/** The delivery states the reconciliation sweep re-derives work from. */
export const RECONCILABLE_LOCAL_STATUSES = ['queued', 'delivery_failed'] as const;

/** This reporter has already reported this object. */
export class DuplicateModerationReportError extends Error {
  readonly existing: ModerationReportRow;

  constructor(existing: ModerationReportRow) {
    super('This item has already been reported by this reporter.');
    this.name = 'DuplicateModerationReportError';
    this.existing = existing;
  }
}

/** The one report this reporter filed about this object, if there is one. */
export async function findModerationReportByReporter(
  db: DatabaseOrTransaction,
  key: {
    readonly reporterOxyUserId: string;
    readonly reportedType: ModerationReportRow['reportedType'];
    readonly reportedId: string;
  },
): Promise<ModerationReportRow | undefined> {
  const [row] = await db
    .select()
    .from(moderationReports)
    .where(
      and(
        eq(moderationReports.reporterOxyUserId, key.reporterOxyUserId),
        eq(moderationReports.reportedType, key.reportedType),
        eq(moderationReports.reportedId, key.reportedId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Store the report.
 *
 * @throws {DuplicateModerationReportError} When this reporter already reported
 *   this object — raised from the unique index's own `23505`, so two concurrent
 *   submissions cannot both succeed. The existing row is read back so the caller
 *   can answer with its id rather than a bare conflict.
 */
export async function insertModerationReport(
  db: DatabaseOrTransaction,
  values: ModerationReportInsert,
): Promise<ModerationReportRow> {
  try {
    // The insert runs in its own SAVEPOINT so a conflict does not abort the
    // caller's transaction — the recovery read below would otherwise die with
    // `25P02` and this function would never raise the duplicate error at all.
    // See `inSavepoint` for the full reasoning.
    const [row] = await inSavepoint(db, (tx) =>
      tx.insert(moderationReports).values(values).returning(),
    );
    return row;
  } catch (error) {
    if (!isUniqueViolation(error, 'moderation_reports_reporter_object_key')) throw error;
    const existing = await findModerationReportByReporter(db, {
      reporterOxyUserId: values.reporterOxyUserId,
      reportedType: values.reportedType,
      reportedId: values.reportedId,
    });
    if (!existing) {
      // The index refused the insert, so a row satisfying it existed at that
      // instant. Not finding it now means it was removed in between — a real
      // state, and one the caller must not be handed a fabricated row for.
      throw error;
    }
    throw new DuplicateModerationReportError(existing);
  }
}

/** One report by id. */
export async function findModerationReportById(
  reportId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationReportRow | undefined> {
  const [row] = await db
    .select()
    .from(moderationReports)
    .where(eq(moderationReports.id, reportId))
    .limit(1);
  return row;
}

/**
 * Patch the delivery / decision cache on a report.
 *
 * An explicit column bag rather than a spread of caller input: everything this
 * writes is derived from a CrowdSource response or a local delivery outcome, and
 * a spread here would be the one place a request body could reach these columns.
 */
export type ModerationReportPatch = Pick<
  ModerationReportInsert,
  | 'localStatus'
  | 'localStatusReason'
  | 'crowdSourceReportId'
  | 'crowdSourceCaseId'
  | 'crowdSourceMerged'
  | 'submittedAt'
  | 'decisionId'
  | 'decisionRevision'
  | 'decisionOutcome'
  | 'decisionStatus'
  | 'decidedAt'
  | 'enforcedAction'
  | 'enforcedAt'
  | 'contentSnapshotHash'
  | 'lastDeliveryError'
>;

/** Apply a patch to one report. Returns the updated row, or `undefined` if it is gone. */
export async function updateModerationReport(
  reportId: string,
  patch: ModerationReportPatch,
  db: DatabaseOrTransaction = getDb(),
): Promise<ModerationReportRow | undefined> {
  const [row] = await db
    .update(moderationReports)
    .set(patch)
    .where(eq(moderationReports.id, reportId))
    .returning();
  return row;
}

/**
 * Cache a decision on a report, but only if it is not OLDER than the one already
 * there.
 *
 * The revision comparison is in the `UPDATE`'s own predicate, not a read
 * followed by a write. Deliveries overlap — a sender retries for a day, and a
 * correction can arrive while the decision it supersedes is still being applied
 * — so an older revision landing last would otherwise overwrite the current
 * answer with a stale one. Expressed as a predicate, the database decides, and
 * two concurrent appliers cannot interleave a read and a write between them.
 *
 * `decision_revision IS NULL` is the "no decision cached yet" arm, matching
 * Mongo's `{$exists: false}`: a column that has never been written is not
 * comparable, and `NULL <= n` is NULL rather than true.
 *
 * @returns `true` when this call wrote the row — `false` means a NEWER revision
 *   is already cached, which is a correct outcome and not a failure.
 */
export async function cacheDecisionOnReport(
  input: {
    readonly reportId: string;
    readonly localStatus: ModerationReportRow['localStatus'];
    readonly decisionId: string;
    readonly decisionRevision: number;
    readonly decisionOutcome: string;
    readonly decisionStatus: string;
    readonly decidedAt: Date;
    readonly enforcedAction?: ModerationReportRow['enforcedAction'];
    readonly enforcedAt?: Date;
  },
  db: DatabaseOrTransaction = getDb(),
): Promise<boolean> {
  const updated = await db
    .update(moderationReports)
    .set({
      localStatus: input.localStatus,
      decisionId: input.decisionId,
      decisionRevision: input.decisionRevision,
      decisionOutcome: input.decisionOutcome,
      decisionStatus: input.decisionStatus,
      decidedAt: input.decidedAt,
      ...(input.enforcedAction === undefined
        ? {}
        : { enforcedAction: input.enforcedAction, enforcedAt: input.enforcedAt ?? new Date() }),
    })
    .where(
      and(
        eq(moderationReports.id, input.reportId),
        or(
          isNull(moderationReports.decisionRevision),
          lte(moderationReports.decisionRevision, input.decisionRevision),
        ),
      ),
    )
    .returning({ id: moderationReports.id });
  return updated.length === 1;
}

/** Every report CrowdSource opened under one case id. */
export async function findModerationReportsByCaseId(
  caseId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly ModerationReportRow[]> {
  return db
    .select()
    .from(moderationReports)
    .where(eq(moderationReports.crowdSourceCaseId, caseId));
}

/**
 * The oldest reports still expecting delivery, id only.
 *
 * `queued` and `delivery_failed` only — `received` is excluded deliberately and
 * the omission is the safety property, not an oversight: those reports have no
 * subject provider, so an event re-derived for one would fail on its first
 * attempt and dead-letter. The sweep counts them instead.
 *
 * Ordered oldest-first, which is what `moderation_reports_local_status_created_idx`
 * exists to serve.
 */
export async function listReportsAwaitingDelivery(
  batchSize: number,
  db: DatabaseOrTransaction = getDb(),
): Promise<readonly string[]> {
  const rows = await db
    .select({ id: moderationReports.id })
    .from(moderationReports)
    .where(inArray(moderationReports.localStatus, [...RECONCILABLE_LOCAL_STATUSES]))
    .orderBy(asc(moderationReports.createdAt))
    .limit(batchSize);
  return rows.map((row) => row.id);
}

/** How many reports were submitted before `before` and still have no decision. */
export async function countReportsAwaitingDecision(
  before: Date,
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(moderationReports)
    .where(
      and(
        eq(moderationReports.localStatus, 'submitted'),
        isNotNull(moderationReports.submittedAt),
        lt(moderationReports.submittedAt, before),
      ),
    );
  return row?.total ?? 0;
}

/**
 * How many reports have no route to review at all.
 *
 * The only number that makes "reports stored here that no jury will ever see"
 * visible, which is precisely the cost of accepting them.
 */
export async function countLocalOnlyReports(
  db: DatabaseOrTransaction = getDb(),
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(moderationReports)
    .where(eq(moderationReports.localStatus, 'received'));
  return row?.total ?? 0;
}
