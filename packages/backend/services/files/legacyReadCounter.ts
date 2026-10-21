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
 *
 * ## Zeros are written too
 *
 * Every flush writes a row for EVERY (surface, outcome) pair of the day, zero
 * reads included, and the flush runs every minute from boot on every API task
 * ({@link startLegacyReadCounter}) — not only once something has been read. A
 * day with all its rows present and zero `served` is therefore evidence that
 * the counter ran and nothing was served; a day with no rows is a day nothing
 * was counting, and the gate (`storageStatus.ts`) refuses to read it as a
 * quiet one. Before this, the timer started on the first read, so a task that
 * served nothing wrote nothing and silence could not be told from an outage of
 * the counter. Each flush also bumps `updated_at`, so the latest one says when
 * a counter last ran.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { legacyMediaReads } from '../../db/schema';
import { LEGACY_MEDIA_OUTCOMES, LEGACY_MEDIA_SURFACES } from '../../db/schema/oxyFiles';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';

type Surface = (typeof LEGACY_MEDIA_SURFACES)[number];
type Outcome = (typeof LEGACY_MEDIA_OUTCOMES)[number];

const FLUSH_INTERVAL_MS = 60_000;

/** Every (surface, outcome) pair: what a fully counted day holds a row for. */
export const LEGACY_MEDIA_READ_PAIRS: ReadonlyArray<readonly [Surface, Outcome]> =
  LEGACY_MEDIA_SURFACES.flatMap((surface) =>
    LEGACY_MEDIA_OUTCOMES.map((outcome) => [surface, outcome] as const),
  );

/** `day|surface|outcome` → reads not yet written. */
const pending = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | null = null;

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function startTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    void flushLegacyReads();
  }, FLUSH_INTERVAL_MS);
  timer.unref?.();
}

/**
 * Start flushing every minute — zeros included — from now on. Called at boot
 * by every process that can read the bucket (the API: the legacy photo door
 * and the private-document door are both API routes).
 */
export function startLegacyReadCounter(): void {
  startTimer();
}

/** Stop the timer and write what is pending. For shutdown. */
export async function stopLegacyReadCounter(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = null;
  await flushLegacyReads();
}

/** Count one read. Never throws and never waits: it is on a request path. */
export function countLegacyRead(surface: Surface, outcome: Outcome, now = new Date()): void {
  const key = `${utcDay(now)}|${surface}|${outcome}`;
  pending.set(key, (pending.get(key) ?? 0) + 1);
  startTimer();
}

/**
 * Write every pending count, and a row for every pair of today (zero when
 * nothing was read). Exported for shutdown and for tests.
 */
export async function flushLegacyReads(now = new Date()): Promise<void> {
  const batch = new Map(pending);
  pending.clear();
  const today = utcDay(now);
  for (const [surface, outcome] of LEGACY_MEDIA_READ_PAIRS) {
    const key = `${today}|${surface}|${outcome}`;
    batch.set(key, batch.get(key) ?? 0);
  }
  try {
    await getDb()
      .insert(legacyMediaReads)
      .values(
        [...batch.entries()].map(([key, reads]) => {
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
    for (const [key, reads] of batch) {
      if (reads > 0) pending.set(key, (pending.get(key) ?? 0) + reads);
    }
    logger.warn('Legacy media read counts could not be flushed; kept for the next flush', {
      reason: describeErrorForLog(error),
    });
  }
}
