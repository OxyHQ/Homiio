/**
 * Whether Homiio's own bucket can be retired — the gate `docs/oxy-files.md`
 * § Retiring the bucket is decided on, computed rather than eyeballed.
 *
 * The PUBLIC half (photos) is retirable when all three hold:
 *  1. no shown photo is still only in the bucket (`countLegacyImages` = 0);
 *  2. the legacy door has served zero bytes from the bucket for the soak
 *     (`legacy_media_reads`, surface `public_image`, outcome `served`);
 *  3. the counter has been running for at least the soak — its first row is
 *     that old — so "no rows" cannot be mistaken for "no reads".
 *
 * The bucket as a whole additionally needs the private documents out of it,
 * which waits on Oxy stage 4b (`privateDocuments.ts`, `TODO(oxy-4b)`); until
 * then `privateDocuments` is non-zero and `bucketRetirable` is false.
 */

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { countLegacyImages } from './imageMigration';

export interface StorageStatus {
  soakDays: number;
  legacyImages: Array<{ target: string; rows: number }>;
  /** Reads per surface and outcome within the soak window. */
  recentReads: Array<{ surface: string; outcome: string; reads: number }>;
  /** When the counter first recorded anything, or null. */
  countingSince: string | null;
  /** Private documents still in the bucket (lease, application, maintenance). */
  privateDocuments: number;
  /** Reference changes not yet accepted by Oxy, and the oldest one's age. */
  pendingReferenceChanges: { rows: number; oldestCreatedAt: string | null; maxAttempts: number };
  publicImagesRetirable: boolean;
  bucketRetirable: boolean;
}

export async function storageRetirementStatus(soakDays = 14): Promise<StorageStatus> {
  const db = getDb();
  const legacyImages = await countLegacyImages();
  const reads = await db.execute<{ surface: string; outcome: string; reads: string }>(sql`
    select surface, outcome, sum(reads)::text as reads
    from legacy_media_reads
    where day >= (current_date - ${soakDays}::int)
    group by 1, 2 order by 1, 2
  `);
  const [since] = await db.execute<{ first: string | null }>(sql`
    select min(day)::text as first from legacy_media_reads
  `);
  const [privateDocs] = await db.execute<{ rows: string }>(sql`
    select (
      (select count(*) from lease_documents)
      + (select count(*) from tenant_application_documents)
      + (select count(*) from maintenance_request_attachments)
    )::text as rows
  `);
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
  const countedLongEnough =
    countingSince !== null &&
    Date.now() - new Date(`${countingSince}T00:00:00Z`).getTime() >= soakDays * 24 * 60 * 60 * 1000;
  const publicImagesRetirable =
    legacyImages.every((row) => row.rows === 0) && servedPublic === 0 && countedLongEnough;
  const privateDocuments = Number(privateDocs?.rows ?? 0);

  return {
    soakDays,
    legacyImages,
    recentReads,
    countingSince,
    privateDocuments,
    pendingReferenceChanges: {
      rows: Number(pending?.rows ?? 0),
      oldestCreatedAt: pending?.oldest ?? null,
      maxAttempts: pending?.max_attempts ?? 0,
    },
    publicImagesRetirable,
    bucketRetirable: publicImagesRetirable && privateDocuments === 0,
  };
}
