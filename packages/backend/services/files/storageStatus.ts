/**
 * Whether Homiio's own bucket can be retired — the gate `docs/oxy-files.md`
 * § Retiring the bucket is decided on, computed rather than eyeballed.
 *
 * The PUBLIC half (photos) is retirable when all three hold:
 *  1. no shown photo is still only in the bucket (`countLegacyImages` = 0);
 *  2. the legacy door has served zero bytes from the bucket for the soak
 *     (`legacy_media_reads`, surface `public_image`, outcome `served`);
 *  3. the counter COUNTED every one of the soak's whole UTC days: each day
 *     before today, back {@link StorageStatus.soakDays} days, holds a row for
 *     every (surface, outcome) pair. The counter writes those rows, zeros
 *     included, every minute from boot (`legacyReadCounter.ts`), so a day
 *     without them is a day nothing was counting — never a quiet one — and
 *     "no rows" cannot be mistaken for "no reads". (A first row merely being
 *     old enough proved nothing: the counter used to write only on a read.)
 *
 * The bucket as a whole additionally needs the private documents out of it:
 * every lease, application and maintenance document moved into its owner's
 * Oxy account (`scripts/migratePrivateDocumentsToOxy.ts`, ADR 0043 stage 4c),
 * so that no row names a bucket object (`privateDocuments` = 0), and the
 * private surface read nothing from the bucket for the soak.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { countLegacyImages } from './imageMigration';
import { LEGACY_MEDIA_READ_PAIRS } from './legacyReadCounter';
import { countLegacyPrivateDocuments } from './privateDocumentMigration';

export interface StorageStatus {
  soakDays: number;
  legacyImages: Array<{ target: string; rows: number }>;
  /** Reads per surface and outcome within the soak window. */
  recentReads: Array<{ surface: string; outcome: string; reads: number }>;
  /** When the counter first recorded anything, or null. */
  countingSince: string | null;
  /**
   * How many of the soak's whole UTC days (the `soakDays` days before today)
   * the counter fully counted — a row for every pair. The gate needs all.
   */
  daysCounted: number;
  /** Private documents whose row still names a bucket object (lease, application, maintenance). */
  privateDocuments: number;
  /** Reference changes not yet accepted by Oxy, and the oldest one's age. */
  pendingReferenceChanges: { rows: number; oldestCreatedAt: string | null; maxAttempts: number };
  publicImagesRetirable: boolean;
  bucketRetirable: boolean;
}

export async function storageRetirementStatus(soakDays = 14): Promise<StorageStatus> {
  const db = getDb();
  const legacyImages = await countLegacyImages();
  // UTC days, as the counter writes them; the window includes today, so a
  // read served today closes the gate as surely as one yesterday.
  const reads = await db.execute<{ surface: string; outcome: string; reads: string }>(sql`
    select surface, outcome, sum(reads)::text as reads
    from legacy_media_reads
    where day >= ((now() at time zone 'utc')::date - ${soakDays}::int)
    group by 1, 2 order by 1, 2
  `);
  const [counted] = await db.execute<{ days: number }>(sql`
    select count(*)::int as days from (
      select day
      from legacy_media_reads
      where day >= ((now() at time zone 'utc')::date - ${soakDays}::int)
        and day < (now() at time zone 'utc')::date
      group by day
      having count(distinct (surface, outcome)) = ${LEGACY_MEDIA_READ_PAIRS.length}::int
    ) fully_counted
  `);
  const [since] = await db.execute<{ first: string | null }>(sql`
    select min(day)::text as first from legacy_media_reads
  `);
  const privateDocs = await countLegacyPrivateDocuments();
  const [pending] = await db.execute<{
    rows: string;
    oldest: string | null;
    max_attempts: number | null;
  }>(sql`
    select count(*)::text as rows, min(created_at)::text as oldest, max(attempts) as max_attempts
    from file_reference_changes where settled_at is null
  `);

  const recentReads = reads.map((row) => ({
    surface: row.surface,
    outcome: row.outcome,
    reads: Number(row.reads),
  }));
  const servedPublic = recentReads
    .filter((row) => row.surface === 'public_image' && row.outcome === 'served')
    .reduce((sum, row) => sum + row.reads, 0);
  const countingSince = since?.first ?? null;
  const daysCounted = counted?.days ?? 0;
  const publicImagesRetirable =
    legacyImages.every((row) => row.rows === 0) && servedPublic === 0 && daysCounted === soakDays;
  const privateDocuments = privateDocs.reduce((sum, row) => sum + row.onBucket, 0);
  const servedPrivate = recentReads
    .filter((row) => row.surface === 'private_document' && row.outcome === 'served')
    .reduce((sum, row) => sum + row.reads, 0);

  return {
    soakDays,
    legacyImages,
    recentReads,
    countingSince,
    daysCounted,
    privateDocuments,
    pendingReferenceChanges: {
      rows: Number(pending?.rows ?? 0),
      oldestCreatedAt: pending?.oldest ?? null,
      maxAttempts: pending?.max_attempts ?? 0,
    },
    publicImagesRetirable,
    bucketRetirable: publicImagesRetirable && privateDocuments === 0 && servedPrivate === 0,
  };
}
