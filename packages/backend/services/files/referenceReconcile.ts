/**
 * The nightly reconciliation of Homiio's file references (ADR 0043 D6) — the
 * safety net under the triggers and the drain, and how references for photos
 * that existed before the move first reach Oxy.
 *
 * For each entity type Homiio sends its full inventory
 * (`referenceUsage.referenceInventory`) and Oxy adds what is missing and
 * removes what Homiio no longer uses — but only references created before
 * the reconciliation began, so a use registered meanwhile is never undone.
 *
 * ## One snapshot, and the pairs that moved during it
 *
 * The inventory is read inside one REPEATABLE READ, read-only transaction, so
 * it describes one instant. A pair the drain settled after that instant may be
 * listed in its old state — a photo removed at 02:00:30 listed as used, and
 * re-added by the commit. So after the commit, every pair settled since the
 * snapshot is marked pending again and the drain makes Oxy agree with the
 * present (`file_reference_changes.settled_at`, kept for exactly this).
 *
 * ## Paced to Oxy's reconciliation budget
 *
 * The SDK sends the inventory as pages of {@link OXY_RECONCILE_PAGE_ITEMS}, and
 * Oxy accepts {@link OXY_RECONCILE_PAGES_PER_MINUTE_LIMIT} of them a minute per
 * application. A 429 there ends the whole session, so the inventory is handed
 * over no faster than {@link RECONCILE_PAGES_PER_MINUTE} pages a minute — ~10
 * minutes for `property`'s ~2M pairs.
 *
 * Run before Oxy's sweep is switched to `enforce`: an application file Homiio
 * uses but never referenced reads as unused, and would be trashed 24 hours
 * after enforcement starts.
 */

import type { ServiceReferenceReconcileResult } from '@oxy.so/core';
import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { FILE_REFERENCE_ENTITY_TYPES } from '../../db/schema/oxyFiles';
import { logger } from '../../middlewares/logging';
import { OxyCallPacer } from './oxyCallPacer';
import { oxyFiles } from './oxyFilesClient';
import { type FileReferenceEntityType, referenceInventory } from './referenceUsage';

/** Items per page the SDK sends (`@oxy.so/core`'s `SERVICE_RECONCILE_PAGE_SIZE`). */
export const OXY_RECONCILE_PAGE_ITEMS = 1000;
/** Oxy's per-application budget for reconciliation pages (`appReferenceReconcileLimiter`). */
export const OXY_RECONCILE_PAGES_PER_MINUTE_LIMIT = 240;
/** What Homiio spends of it: a margin for the commit and status calls. */
export const RECONCILE_PAGES_PER_MINUTE = 200;

/**
 * The inventory, handed over one SDK page at a time no faster than `pacer`
 * allows: every {@link OXY_RECONCILE_PAGE_ITEMS} items wait for a slot.
 */
export async function* pacedInventory<T>(
  items: AsyncIterable<T>,
  pacer: Pick<OxyCallPacer, 'slot'>,
  pageItems = OXY_RECONCILE_PAGE_ITEMS,
): AsyncGenerator<T> {
  let count = 0;
  for await (const item of items) {
    if (count % pageItems === 0) await pacer.slot();
    count += 1;
    yield item;
  }
}

export interface ReconcileReport {
  entityType: FileReferenceEntityType;
  /** Absent when another task holds this type's reconciliation right now. */
  result?: ServiceReferenceReconcileResult;
  /** Pairs re-marked because the drain settled them after the snapshot. */
  remarked: number;
}

/** Reconcile one entity type. */
export async function reconcileFileReferenceType(
  entityType: FileReferenceEntityType,
  options: { dryRun?: boolean } = {},
): Promise<ReconcileReport> {
  const db = getDb();
  let snapshotAt: Date | undefined;
  let result: ServiceReferenceReconcileResult | undefined;
  await db.transaction(
    async (tx) => {
      // Every API task runs the cron; one reconciles each type and the rest
      // step aside (Oxy would answer them 409 anyway). Transaction-scoped, so
      // the lock goes with the snapshot.
      const [lock] = await tx.execute<{ locked: boolean; now: Date | string }>(sql`
        select pg_try_advisory_xact_lock(hashtext(${`homiio:file-references:${entityType}`})) as locked,
               now() as now
      `);
      if (!lock?.locked) return;
      snapshotAt = new Date(lock.now);
      result = await oxyFiles().references.reconcile(
        entityType,
        pacedInventory(
          referenceInventory(tx, entityType),
          new OxyCallPacer({ perMinute: RECONCILE_PAGES_PER_MINUTE }),
        ),
        { dryRun: options.dryRun === true },
      );
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  if (!snapshotAt) return { entityType, remarked: 0 };
  if (!result) throw new Error('Reconciliation produced no result');

  let remarked = 0;
  if (!options.dryRun) {
    const rows = await db.execute<{ id: string }>(sql`
      update file_reference_changes
      set settled_at = null,
          generation = generation + 1,
          available_at = date_trunc('milliseconds', now()),
          updated_at = date_trunc('milliseconds', now())
      where entity_type = ${entityType} and settled_at >= ${snapshotAt.toISOString()}
      returning id
    `);
    remarked = rows.length;
  }
  return { entityType, result, remarked };
}

/** Reconcile every entity type, one after another; a failure stops nothing else. */
export async function reconcileFileReferences(
  options: { dryRun?: boolean } = {},
): Promise<{ reports: ReconcileReport[]; failed: FileReferenceEntityType[] }> {
  const reports: ReconcileReport[] = [];
  const failed: FileReferenceEntityType[] = [];
  for (const entityType of FILE_REFERENCE_ENTITY_TYPES) {
    try {
      const report = await reconcileFileReferenceType(entityType, options);
      reports.push(report);
      if (!report.result) {
        logger.info('File references of this type are being reconciled elsewhere', { entityType });
        continue;
      }
      logger.info('File references reconciled', {
        entityType,
        dryRun: report.result.dryRun,
        added: report.result.added,
        removed: report.result.removed,
        unchanged: report.result.unchanged,
        refused: report.result.refused,
        remarked: report.remarked,
      });
    } catch (error) {
      failed.push(entityType);
      logger.error('File reference reconciliation failed', { entityType, error });
    }
  }
  return { reports, failed };
}
