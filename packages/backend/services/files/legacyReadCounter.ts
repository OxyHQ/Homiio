/**
 * Counts every request to the legacy photo door (`legacyImages.ts`) into
 * `legacy_media_reads`: surface `public_image`, outcome `redirected` (an old
 * URL sent to its Oxy rendition) or `missing` (a 404).
 *
 * It was the evidence Homiio's bucket was retired on; the bucket is gone
 * (`docs/oxy-files.md`), and the same counts now say when the door itself can
 * go — when nothing is redirected any more. A per-request INSERT would put a
 * write on the hot path of every old photo URL, so requests are tallied in
 * memory and added to the day's row once a minute — `INSERT … ON CONFLICT DO
 * UPDATE SET reads = reads + n`, so several tasks flushing the same day
 * converge on one row and none overwrites another's count. A failed flush
 * puts its counts back for the next one; a task killed between flushes loses
 * at most a minute of counts, which can delay retiring the door and never
 * hasten it — only a zero is acted on, and a lost count is itself evidence of
 * a request.
 *
 * ## Zeros are written too
 *
 * Every flush writes a row for EVERY counted (surface, outcome) pair of the
 * day, zero included, and the flush runs every minute from boot on every API
 * task ({@link startLegacyReadCounter}) — not only once something has been
 * read. A day with all its rows present and zero `redirected` is therefore
 * evidence that the counter ran and nothing came through the door; a day with
 * no rows is a day nothing was counting, never a quiet one. Each flush also
 * bumps `updated_at`, so the latest one says when a counter last ran.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { legacyMediaReads } from '../../db/schema';
import type { LEGACY_MEDIA_OUTCOMES, LEGACY_MEDIA_SURFACES } from '../../db/schema/oxyFiles';
import { describeErrorForLog } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';

type Surface = Extract<(typeof LEGACY_MEDIA_SURFACES)[number], 'public_image'>;
type Outcome = Extract<(typeof LEGACY_MEDIA_OUTCOMES)[number], 'redirected' | 'missing'>;

const FLUSH_INTERVAL_MS = 60_000;

/**
 * Every pair the door can produce: what a fully counted day holds a row for.
 * (`served` and `private_document` were the bucket's; the table keeps their
 * history, and nothing writes them any more.)
 */
export const LEGACY_MEDIA_READ_PAIRS: ReadonlyArray<readonly [Surface, Outcome]> = [
  ['public_image', 'redirected'],
  ['public_image', 'missing'],
];

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
 * by the API, which mounts the legacy photo door.
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
