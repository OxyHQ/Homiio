/**
 * Counts every read of Homiio's own bucket into `legacy_media_reads`.
 *
 * The bucket is retired on EVIDENCE (`docs/oxy-files.md` § Retiring the
 * bucket): zero `served` reads for the soak. A per-request INSERT would put a
 * write on the hot path of every old photo URL, so reads are tallied in memory
 * and added to the day's row once a minute — `INSERT … ON CONFLICT DO UPDATE
 * SET reads = reads + n`, so several tasks flushing the same day converge on
 * one row and none overwrites another's count. A failed flush puts its counts
 * back for the next one; a task killed between flushes loses at most a minute
 * of counts, which can delay the retirement and can never hasten it — only a
 * zero is acted on, and a lost count is itself evidence of a read.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { legacyMediaReads } from '../../db/schema';
import type { LEGACY_MEDIA_OUTCOMES, LEGACY_MEDIA_SURFACES } from '../../db/schema/oxyFiles';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';

type Surface = (typeof LEGACY_MEDIA_SURFACES)[number];
type Outcome = (typeof LEGACY_MEDIA_OUTCOMES)[number];

const FLUSH_INTERVAL_MS = 60_000;

/** `day|surface|outcome` → reads not yet written. */
const pending = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Count one read. Never throws and never waits: it is on a request path. */
export function countLegacyRead(surface: Surface, outcome: Outcome, now = new Date()): void {
  const key = `${utcDay(now)}|${surface}|${outcome}`;
  pending.set(key, (pending.get(key) ?? 0) + 1);
  if (!timer) {
    timer = setInterval(() => {
      void flushLegacyReads();
    }, FLUSH_INTERVAL_MS);
    timer.unref?.();
  }
}

/** Write every pending count. Exported for shutdown and for tests. */
export async function flushLegacyReads(): Promise<void> {
  if (pending.size === 0) return;
  const batch = [...pending.entries()];
  pending.clear();
  try {
    await getDb()
      .insert(legacyMediaReads)
      .values(
        batch.map(([key, reads]) => {
          const [day, surface, outcome] = key.split('|') as [string, Surface, Outcome];
          return { day, surface, outcome, reads };
        }),
      )
      .onConflictDoUpdate({
        target: [legacyMediaReads.day, legacyMediaReads.surface, legacyMediaReads.outcome],
        set: {
          reads: sql`${legacyMediaReads.reads} + excluded.reads`,
          updatedAt: sql`date_trunc('milliseconds', now())`,
        },
      });
  } catch (error) {
    for (const [key, reads] of batch) pending.set(key, (pending.get(key) ?? 0) + reads);
    logger.warn('Legacy media read counts could not be flushed; kept for the next flush', {
      reason: describeErrorForLog(error),
    });
  }
}
