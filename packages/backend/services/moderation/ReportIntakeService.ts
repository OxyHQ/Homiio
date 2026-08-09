/**
 * Storing a report and, when there is somewhere to send it, the promise to
 * deliver it — in one operation.
 *
 * This is the only part of the integration a user waits for. A success response
 * from a report endpoint means the report row and its outbox event committed
 * TOGETHER. It does not mean CrowdSource accepted anything — CrowdSource may be
 * unreachable, mid-deploy or not yet configured, and the reporter is told their
 * report was received either way, because it was.
 *
 * The transaction is the whole mechanism. Two writes outside one would give two
 * failure modes that are both silent: a report with no delivery event (the
 * report exists, nothing will ever send it, and nobody finds out until somebody
 * asks why a case never opened) or a delivery event with no report (a worker
 * looking up an id that was rolled back). Neither surfaces as an error at the
 * moment it happens, which is exactly why this has to be atomic rather than
 * carefully ordered.
 *
 * The one report with NO delivery event is the one whose type has no subject
 * provider, and that is a different claim entirely: not "delivery failed" but
 * "there was never a route out of this application for this kind of object".
 * Those two must not be conflated, which is why they are different `localStatus`
 * values and why the absent route is written down as a reason rather than
 * inferred from a missing row.
 *
 * ## Joining a caller's transaction rather than opening one
 *
 * Every caller here already has a domain write of its own — a `listing_reports`
 * row, a review report, an `eviction_reports` row. Those must commit with the
 * moderation report, not beside it, so this function takes the caller's
 * transaction handle instead of starting its own.
 * {@link withReportIntakeTransaction} is the helper that opens one for callers
 * that have nothing else to join.
 *
 * `db/moderation/moderationOutboxRepository.ts` REFUSES the root connection at
 * runtime, so a caller that forgets to thread the handle through fails loudly
 * instead of committing the report alone — see `transactionGuard.ts` for why the
 * type alone cannot express that.
 */

import { ModerationReportedType } from '@homiio/shared-types';
import {
  insertModerationReport,
  type ModerationReportRow,
} from '../../db/moderation/moderationReportRepository';
import { enqueueModerationOutboxEvent } from '../../db/moderation/moderationOutboxRepository';
import { getDb, type Database, type DatabaseOrTransaction } from '../../db/postgres';
import { reportSubmitEventId } from './ModerationOutboxService';
import { subjectProviderFor } from './subjects/registry';

/**
 * Refuses an identifier that is not a string, at the point the QUERY is built.
 *
 * The types say these are strings and every route rejects a missing one, but a
 * type is erased at runtime. Under Mongo a truthiness check happily passed
 * `{$ne: null}`, which matched an UNRELATED report and answered "you already
 * reported this" about somebody else's row. Parameterised SQL does not have that
 * particular hole, but the guard is kept and is still worth its lines: it turns
 * a malformed id into a loud `TypeError` at the boundary instead of a row keyed
 * by `"[object Object]"`.
 *
 * It lives here rather than at a route because {@link createModerationReport} is
 * exported: a queue worker, a backfill script or a future admin path is under no
 * obligation to have passed a route's validation, and a guard that exists at
 * only one caller is a guard that holds until the second one arrives.
 */
function requireIdentifier(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`createModerationReport: ${field} must be a non-empty string.`);
  }
  return value;
}

/**
 * Narrow a validated string to the reportable-type union.
 *
 * A predicate rather than a cast, so the union stays the single source of truth:
 * adding a member to `ModerationReportedType` cannot leave this accepting a value
 * the rest of the pipeline has no provider entry for.
 */
function isReportedType(value: string): value is ModerationReportedType {
  return (Object.values(ModerationReportedType) as string[]).includes(value);
}

export interface CreateModerationReportInput {
  reportedType: ModerationReportedType;
  reportedId: string;
  /** The reporter's Oxy user id, resolved from the session. */
  reporter: string;
  /** The reason in the surface's own vocabulary. */
  reason: string;
  details?: string;
}

export interface CreateModerationReportResult {
  report: ModerationReportRow;
  /**
   * The durable delivery event.
   *
   * Absent exactly when the reported type has no subject provider — the report
   * was stored and there is nothing to deliver it, by design rather than by
   * failure.
   */
  outboxEventId?: string;
}

/**
 * Why a report is not going anywhere, in words an operator can read.
 *
 * Stored on the row rather than left to be inferred from a missing outbox event.
 * A missing row is also what a lost write looks like, and the two need to be
 * distinguishable months later without re-deriving which types had providers at
 * the time.
 */
function localOnlyReason(reportedType: string): string {
  return (
    `Homiio has no moderation subject provider for '${reportedType}', so this report is ` +
    'recorded locally and is not sent for community review.'
  );
}

/**
 * Run `operation` inside a transaction, for a caller that has no other write to
 * join.
 *
 * Callers that DO have one — every existing report surface — must pass their own
 * handle to {@link createModerationReport} instead, so their domain write and
 * the moderation report commit together.
 */
export async function withReportIntakeTransaction<T>(
  operation: (tx: DatabaseOrTransaction) => Promise<T>,
  db: Database = getDb(),
): Promise<T> {
  return db.transaction(async (tx) => operation(tx));
}

/**
 * Store the report, and queue its delivery in the same transaction.
 *
 * Delivery is queued when — and only when — the reported type has a subject
 * provider. A type without one is stored at `received` with the reason recorded,
 * which is the behaviour that surface had before CrowdSource existed: the report
 * is a receipt and a local record, and nothing else ever happens to it.
 *
 * That branch is the reason the two writes stay in one transaction rather than
 * being ordered carefully. The condition is read BEFORE the transaction body
 * decides anything, so `localStatus` and the presence of an outbox row are
 * decided together from one fact — a report can never commit as `queued` with
 * nothing to deliver it, nor as `received` with a delivery event that will try
 * anyway.
 *
 * Intake deliberately does not read `CROWDSOURCE_ENABLED`. A report taken while
 * the integration is off still gets its delivery event, so turning the flag on
 * delivers the backlog instead of stranding it — the dispatcher LOOP is what is
 * gated, never the durable record. Nothing here is conditional on a third
 * party's state; only on whether this application knows how to describe the
 * object.
 *
 * @throws {DuplicateModerationReportError} When this reporter already reported
 *   this object. Raised by `moderation_reports_reporter_object_key` rather than
 *   by a preceding read, so two concurrent submissions cannot both pass.
 */
export async function createModerationReport(
  input: CreateModerationReportInput,
  tx: DatabaseOrTransaction,
): Promise<CreateModerationReportResult> {
  const reporterOxyUserId = requireIdentifier(input.reporter, 'reporter');
  const reportedId = requireIdentifier(input.reportedId, 'reportedId');
  const reportedType = requireIdentifier(input.reportedType, 'reportedType');
  const reason = requireIdentifier(input.reason, 'reason');
  if (!isReportedType(reportedType)) {
    throw new TypeError(
      `createModerationReport: reportedType '${reportedType}' is not a reportable type.`,
    );
  }
  const deliverable = subjectProviderFor(reportedType) !== undefined;

  const report = await insertModerationReport(tx, {
    reportedType,
    reportedId,
    reporterOxyUserId,
    reason,
    details: input.details,
    localStatus: deliverable ? 'queued' : 'received',
    ...(deliverable ? {} : { localStatusReason: localOnlyReason(reportedType) }),
  });

  if (!deliverable) return { report };

  const outboxEventId = await enqueueModerationOutboxEvent(
    {
      eventId: reportSubmitEventId(report.id),
      kind: 'report.submit',
      payload: { reportId: report.id },
    },
    tx,
  );

  return { report, outboxEventId };
}
