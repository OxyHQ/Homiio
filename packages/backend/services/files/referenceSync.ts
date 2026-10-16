/**
 * Drains `file_reference_changes`: makes Oxy's record of which Homiio entities
 * use which file agree with Homiio's own tables (ADR 0043 D4).
 *
 * The triggers of migration `0037_oxy_files` mark a (file, entity) pair in the
 * transaction of every change that could move its answer. This loop claims
 * marked pairs, reads the CURRENT answer (`referenceUsage.isReferenceInUse`),
 * and adds or removes the reference — so it is level-triggered: the order in
 * which changes happened cannot leave the wrong state behind.
 *
 * - A pair is settled only at the `generation` it was claimed at. A change that
 *   lands while Oxy is being asked bumps the generation, so the pair stays
 *   pending and is looked at again. Settled rows stay a week (see
 *   `db/schema/oxyFiles.ts` for why) and the expiry sweep removes them.
 * - Oxy answering `not_found` to an add (the file was deleted, blocked, or is
 *   not one Homiio may reference) is final for that pair: there is nothing to
 *   register, the file event says what happened, and the nightly
 *   reconciliation counts it as `refused`.
 * - A failed call backs off (1 min doubling to 6 h) and records `last_error`;
 *   nothing is dropped.
 *
 * Not leader-gated, like the moderation outbox: the claim is `FOR UPDATE SKIP
 * LOCKED` with a lease, so every API task shares the work and a task dying
 * mid-call has its lease expire and the pair reclaimed.
 */

import { randomUUID } from 'node:crypto';

import { and, eq, sql } from 'drizzle-orm';

import config from '../../config';
import { getDb } from '../../db/postgres';
import { fileReferenceChanges } from '../../db/schema';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { oxyErrorStatus, oxyFiles } from './oxyFilesClient';
import { type FileReferenceEntityType, isReferenceInUse } from './referenceUsage';

/** How long a claim is held before another task may take the pair over. */
const LEASE_SECONDS = 120;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_MAX_SECONDS = 6 * 60 * 60;

interface ClaimedPair {
  id: string;
  oxyFileId: string;
  entityType: FileReferenceEntityType;
  entityId: string;
  generation: number;
  attempts: number;
}

/** Claim up to `limit` due pairs for `owner`. */
async function claim(owner: string, limit: number): Promise<ClaimedPair[]> {
  const rows = await getDb().execute<{
    id: string;
    oxy_file_id: string;
    entity_type: FileReferenceEntityType;
    entity_id: string;
    generation: number;
    attempts: number;
  }>(sql`
    update file_reference_changes
    set lease_owner = ${owner},
        lease_until = date_trunc('milliseconds', now()) + make_interval(secs => ${LEASE_SECONDS})
    where id in (
      select id from file_reference_changes
      where settled_at is null
        and available_at <= now()
        and (lease_until is null or lease_until <= now())
      order by available_at
      limit ${limit}
      for update skip locked
    )
    returning id, oxy_file_id, entity_type, entity_id, generation, attempts
  `);
  return rows.map((row) => ({
    id: row.id,
    oxyFileId: row.oxy_file_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    generation: Number(row.generation),
    attempts: Number(row.attempts),
  }));
}

/** Done: settle the pair unless it changed again meanwhile, then let go of it. */
async function settle(owner: string, pair: ClaimedPair): Promise<void> {
  const db = getDb();
  const settled = await db
    .update(fileReferenceChanges)
    .set({
      settledAt: sql`date_trunc('milliseconds', now())`,
      leaseOwner: null,
      leaseUntil: null,
      attempts: 0,
      lastError: null,
    })
    .where(
      and(
        eq(fileReferenceChanges.id, pair.id),
        eq(fileReferenceChanges.generation, pair.generation),
        eq(fileReferenceChanges.leaseOwner, owner),
      ),
    )
    .returning({ id: fileReferenceChanges.id });
  if (settled.length === 0) {
    // Changed while we were asking Oxy: release it so the next pass reads it.
    await db
      .update(fileReferenceChanges)
      .set({ leaseOwner: null, leaseUntil: null })
      .where(and(eq(fileReferenceChanges.id, pair.id), eq(fileReferenceChanges.leaseOwner, owner)));
  }
}

async function backOff(owner: string, pair: ClaimedPair, error: unknown): Promise<void> {
  const attempts = pair.attempts + 1;
  const delay = Math.min(
    BACKOFF_MAX_SECONDS,
    BACKOFF_BASE_SECONDS * 2 ** Math.min(attempts - 1, 20),
  );
  const status = oxyErrorStatus(error);
  await getDb()
    .update(fileReferenceChanges)
    .set({
      attempts,
      leaseOwner: null,
      leaseUntil: null,
      availableAt: sql`date_trunc('milliseconds', now()) + make_interval(secs => ${delay})`,
      // A status and a message, never a URL or a token.
      lastError: `${status ?? 'transport'}: ${String(describeErrorForLog(error).message ?? 'error').slice(0, 500)}`,
    })
    .where(and(eq(fileReferenceChanges.id, pair.id), eq(fileReferenceChanges.leaseOwner, owner)));
}

/** One pass: claim, decide, tell Oxy, settle. Returns how many pairs settled. */
export async function syncFileReferences(
  options: { owner?: string; limit?: number } = {},
): Promise<{ claimed: number; added: number; removed: number; refused: number; failed: number }> {
  const owner = options.owner ?? `ref-sync:${randomUUID()}`;
  const pairs = await claim(owner, options.limit ?? config.oxyFiles.referenceSyncBatchSize);
  const summary = { claimed: pairs.length, added: 0, removed: 0, refused: 0, failed: 0 };
  if (pairs.length === 0) return summary;

  const db = getDb();
  const toAdd: ClaimedPair[] = [];
  const toRemove: ClaimedPair[] = [];
  for (const pair of pairs) {
    (await isReferenceInUse(db, pair)) ? toAdd.push(pair) : toRemove.push(pair);
  }

  const assets = oxyFiles();
  const send = async (
    batch: ClaimedPair[],
    call: typeof assets.references.add,
    counted: 'added' | 'removed',
  ): Promise<void> => {
    if (batch.length === 0) return;
    try {
      const results = await call(
        batch.map((pair) => ({
          fileId: pair.oxyFileId,
          entityType: pair.entityType,
          entityId: pair.entityId,
        })),
      );
      for (const [index, pair] of batch.entries()) {
        const result = results[index]?.result;
        if (counted === 'added' && result === 'not_found') {
          summary.refused += 1;
          logger.warn('Oxy refused a file reference; nothing to register', {
            fileId: pair.oxyFileId,
            entityType: pair.entityType,
            entityId: pair.entityId,
          });
        } else {
          summary[counted] += 1;
        }
        await settle(owner, pair);
      }
    } catch (error) {
      summary.failed += batch.length;
      logger.warn('File reference sync failed; backing off', {
        pairs: batch.length,
        reason: describeErrorForLog(error),
      });
      for (const pair of batch) await backOff(owner, pair, error);
    }
  };

  await send(toAdd, (refs) => assets.references.add(refs), 'added');
  await send(toRemove, (refs) => assets.references.remove(refs), 'removed');
  return summary;
}

/** The loop, one pass in flight at a time; started by `server.ts`. */
export class FileReferenceSyncLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlight: Promise<unknown> | null = null;

  start(): void {
    if (this.timer || !config.oxyFiles.referenceSyncEnabled) return;
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = syncFileReferences()
        .catch((error) =>
          logger.error('File reference sync pass failed', { reason: describeErrorForLog(error) }),
        )
        .finally(() => {
          this.inFlight = null;
        });
    };
    tick();
    this.timer = setInterval(tick, config.oxyFiles.referenceSyncIntervalMs);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }
}

export const fileReferenceSyncLoop = new FileReferenceSyncLoop();
