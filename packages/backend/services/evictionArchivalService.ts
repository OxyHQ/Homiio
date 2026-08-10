/**
 * The eviction board's retention sweep.
 *
 * ADR 0003 §7.5 sets the schedule, and the module it points at
 * (`db/expiry.ts`) explains why this file exists rather than a registry entry:
 * *"Registering a target is only half of the port… until that lands the table
 * still grows forever."* The registry only ever DELETES a row on a deadline;
 * neither half of this policy is a delete-on-deadline, so neither can be
 * expressed there.
 *
 *  - **Archived at 90 days after the last change.** The case leaves the public
 *    board and search, the contact block is DELETED rather than hidden, the exact
 *    pair is cleared, and the published location drops to `neighborhood`. What
 *    remains is the anonymous fact that an eviction was scheduled in that
 *    neighbourhood on that date and what its outcome was — which is what makes
 *    the board useful as evidence of a pattern.
 *  - **Deleted at 24 months after archival.**
 *
 * `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` records `eviction_cases.archived_at`
 * beside `conversations.sharing_expires_at` for exactly this reason: a later
 * reader comparing the registry against the deadline columns in the schema finds
 * one short and closes the gap, and that change would start deleting live
 * notices ninety days after their last edit.
 *
 * ## The contact block is DELETED, not hidden, and that is the point
 *
 * A hidden contact is still a contact — one bad read path, one export, one
 * `.select()` away. ADR 0003's matrix says "deleted at archive (90 d)" for
 * `eviction organiser contact`, and `archiveStaleCases` does it in the same
 * `UPDATE` that sets `archived_at`, so a partially archived case cannot exist.
 */

import { Logger } from '../utils/logger';
import { archiveStaleCases, deleteLongArchivedCases } from '../db/evictions/evictionRepository';

const logger = new Logger('EvictionArchivalService');

/** Days without a change before a case leaves the board (ADR 0003 §7.5). */
export const ARCHIVE_AFTER_DAYS = 90;

/** Months a case stays archived before it is deleted outright. */
export const DELETE_AFTER_ARCHIVE_MONTHS = 24;

/** How many cases one sweep may archive, so a backlog cannot stall a tick. */
const ARCHIVE_BATCH = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EvictionArchivalResult {
  readonly archived: number;
  readonly deleted: number;
}

/**
 * Run one archival pass.
 *
 * Returns counts rather than logging and swallowing, so the cron wrapper decides
 * what to log and a test can assert what happened. A sweep whose only output is a
 * log line is a sweep nobody can check.
 */
export async function sweepEvictionArchive(
  now: Date = new Date(),
): Promise<EvictionArchivalResult> {
  const changedBefore = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * DAY_MS);
  const archivedIds = await archiveStaleCases({ changedBefore, limit: ARCHIVE_BATCH });

  // 24 months as 730 days. Calendar months would make the deadline depend on
  // which month a case happened to be archived in, and nothing about this policy
  // is calendar-shaped.
  const archivedBefore = new Date(now.getTime() - DELETE_AFTER_ARCHIVE_MONTHS * 30.4375 * DAY_MS);
  const deleted = await deleteLongArchivedCases({ archivedBefore });

  if (archivedIds.length > 0 || deleted > 0) {
    // Counts and ids only. A case's title, label or contact must never reach a
    // log line (ADR 0003 §8.1); an opaque id is explicitly permitted.
    logger.info('Eviction archival sweep', {
      archived: archivedIds.length,
      deleted,
      archivedIds,
    });
  }

  return { archived: archivedIds.length, deleted };
}
