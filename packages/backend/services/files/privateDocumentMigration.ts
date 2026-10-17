/**
 * Moving the private documents in Homiio's bucket into their owners' Oxy
 * accounts (ADR 0043 stage 4c) — the logic behind
 * `scripts/migratePrivateDocumentsToOxy.ts`, kept here so it is tested.
 *
 * ## What moves, and to whom
 *
 * | Row                                  | Becomes a PRIVATE file of            |
 * |--------------------------------------|--------------------------------------|
 * | `lease_documents`                    | the party who uploaded it            |
 * | `tenant_application_documents`       | the application's applicant          |
 * | `maintenance_request_attachments`    | the party who attached it            |
 *
 * The bytes move verbatim — they were already re-encoded (a photo) or kept
 * byte for byte (a PDF) when they were stored — so a lease document keeps the
 * SHA-256 its signatures are bound to (`lease_documents.content_sha256`); a
 * row whose object no longer hashes to it is reported and left alone.
 *
 * ## Verified before the row moves
 *
 * Each object is read once, hashed, uploaded with that digest (Oxy refuses
 * bytes that do not match), and then READ BACK through Homiio's own consent
 * (`linkedDownloadUrls`) and hashed again. Only then is the row switched to
 * `oxy:<fileId>`, and only while it still names the object it named (a
 * compare-and-set). An Oxy that stores but cannot yet hand the file back to
 * Homiio — one without stage 4c — therefore moves nothing: the first such
 * answer is `read_back_refused` and the run stops, leaving every row on the
 * bucket, where it still reads.
 *
 * Switching the row fires its trigger (`0038_oxy_private_documents`), so the
 * drain registers the use with Oxy. The bucket object is kept: the bucket's
 * private half goes as a whole once nothing names it (`storageStatus.ts`).
 * Reports name rows by table and id and bytes by SHA-256 — never a key, a URL
 * or a person.
 */

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { validatePrivateDocumentKey } from '../../utils/imageStoreKey';
import { legacyObjectStore } from './legacyObjectStore';
import type { OxyCallPacer } from './oxyCallPacer';
import { downloadLinked, oxyErrorCode, oxyErrorStatus, oxyFiles } from './oxyFilesClient';
import { oxyDocumentRef, privateDocumentRefFromRowUrl } from './privateDocuments';

/** The three tables a private document lives in. */
export const PRIVATE_DOCUMENT_TABLES = [
  'lease_documents',
  'tenant_application_documents',
  'maintenance_request_attachments',
] as const;

export type PrivateDocumentTable = (typeof PRIVATE_DOCUMENT_TABLES)[number];

/** A row still on the bucket, and who will own its file. */
export interface LegacyPrivateDocument {
  table: PrivateDocumentTable;
  id: string;
  /** The row's own value: a delivery-route URL, a legacy S3 URL, or a key. */
  stored: string;
  ownerOxyUserId: string;
  /** The digest a signature may be bound to; lease documents only. */
  expectedSha256: string | null;
}

export type PrivateDocumentMigrationOutcome =
  | 'migrated'
  /** The row names nothing Homiio stores (an applicant's own link). Never moves. */
  | 'not_stored_here'
  | 'missing_object'
  | 'hash_mismatch'
  | 'upload_failed'
  /** Oxy stored it but would not hand it back to Homiio: stage 4c is not serving. */
  | 'read_back_refused'
  /** The row changed while this ran; the next run sees its new value. */
  | 'row_changed';

export interface PrivateDocumentReportLine {
  table: PrivateDocumentTable;
  id: string;
  outcome: PrivateDocumentMigrationOutcome;
  sha256?: string;
  bytes?: number;
  status?: number;
  code?: string;
}

/** The column holding the ref, per table. */
const REF_COLUMN: Readonly<Record<PrivateDocumentTable, string>> = {
  lease_documents: 'url',
  tenant_application_documents: 'url',
  maintenance_request_attachments: 'storage_key',
};

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** One page of a table's rows still on the bucket, in id order after `afterId`. */
export async function findLegacyPrivateDocuments(
  table: PrivateDocumentTable,
  afterId: string | null,
  limit: number,
): Promise<LegacyPrivateDocument[]> {
  const after = afterId ?? '';
  const db = getDb();
  const rows =
    table === 'lease_documents'
      ? await db.execute<{ id: string; stored: string; owner: string; sha: string | null }>(sql`
          select d.id, d.url as stored, d.uploaded_by_oxy_user_id as owner,
                 d.content_sha256 as sha
          from lease_documents d
          where d.url not like 'oxy:%' and d.id > ${after}
          order by d.id limit ${limit}`)
      : table === 'tenant_application_documents'
        ? await db.execute<{ id: string; stored: string; owner: string; sha: null }>(sql`
            select d.id, d.url as stored, a.applicant_oxy_user_id as owner, null as sha
            from tenant_application_documents d
            join tenant_applications a on a.id = d.application_id
            where d.url not like 'oxy:%' and d.id > ${after}
            order by d.id limit ${limit}`)
        : await db.execute<{ id: string; stored: string; owner: string; sha: null }>(sql`
            select a.id, a.storage_key as stored, a.uploaded_by_oxy_user_id as owner, null as sha
            from maintenance_request_attachments a
            where a.storage_key not like 'oxy:%' and a.id > ${after}
            order by a.id limit ${limit}`);
  return rows.map((row) => ({
    table,
    id: row.id,
    stored: row.stored,
    ownerOxyUserId: row.owner,
    expectedSha256: row.sha,
  }));
}

/** The bucket key a row names, or null when it names nothing Homiio stores. */
function bucketKeyOf(row: LegacyPrivateDocument): string | null {
  // A maintenance row holds the key itself; the two `url` columns hold a URL.
  const ref =
    row.table === 'maintenance_request_attachments'
      ? row.stored
      : privateDocumentRefFromRowUrl(row.stored);
  if (!ref) return null;
  const validation = validatePrivateDocumentKey(ref);
  return validation.ok ? validation.key : null;
}

/**
 * Move one row. Never throws for a per-row problem: the outcome says it. The
 * upload is metered by Oxy like every upload, so the CLI passes its pacer
 * (`oxyCallPacer.ts`): a 429 is waited out and sent again, never an outcome.
 */
export async function migratePrivateDocument(
  row: LegacyPrivateDocument,
  options: { pacer?: OxyCallPacer } = {},
): Promise<PrivateDocumentReportLine> {
  const { pacer } = options;
  const run = <T>(call: () => Promise<T>): Promise<T> => (pacer ? pacer.run(call) : call());
  const base = { table: row.table, id: row.id };
  const key = bucketKeyOf(row);
  if (!key) return { ...base, outcome: 'not_stored_here' };
  const validation = validatePrivateDocumentKey(key);
  if (!validation.ok) return { ...base, outcome: 'not_stored_here' };

  const object = await legacyObjectStore().get(key);
  if (!object) return { ...base, outcome: 'missing_object' };
  const sha256 = digest(object.buffer);
  const measured = { sha256, bytes: object.buffer.length };
  if (row.expectedSha256 && row.expectedSha256 !== sha256) {
    return { ...base, ...measured, outcome: 'hash_mismatch' };
  }

  let fileId: string;
  try {
    const { file } = await run(() =>
      oxyFiles().uploadUserMediaLarge(row.ownerOxyUserId, new Uint8Array(object.buffer), {
        mime: validation.contentType,
        visibility: 'private',
        filename: key.slice(key.lastIndexOf('/') + 1),
        sha256,
      }),
    );
    if (file.visibility !== 'private' || file.sha256 !== sha256) {
      return { ...base, ...measured, outcome: 'upload_failed', code: 'NOT_PRIVATE_OR_ALTERED' };
    }
    fileId = file.id;
  } catch (error) {
    return {
      ...base,
      ...measured,
      outcome: 'upload_failed',
      ...(oxyErrorStatus(error) ? { status: oxyErrorStatus(error) } : {}),
      ...(oxyErrorCode(error) ? { code: oxyErrorCode(error) } : {}),
    };
  }

  // Homiio must be able to read it back before any row depends on that.
  const [entry] = (await oxyFiles().linkedDownloadUrls([fileId])).filter(
    (candidate) => candidate.id === fileId,
  );
  if (!entry) return { ...base, ...measured, outcome: 'read_back_refused' };
  const readBack = await downloadLinked(entry.url);
  if (digest(readBack) !== sha256) return { ...base, ...measured, outcome: 'hash_mismatch' };

  const column = sql.raw(REF_COLUMN[row.table]);
  const tableName = sql.raw(row.table);
  const updated = await getDb().execute<{ id: string }>(sql`
    update ${tableName} set ${column} = ${oxyDocumentRef(fileId)}
    where id = ${row.id} and ${column} = ${row.stored}
    returning id`);
  if (updated.length === 0) return { ...base, ...measured, outcome: 'row_changed' };
  return { ...base, ...measured, outcome: 'migrated' };
}

/** Per table: rows still on the bucket, and rows that name nothing Homiio stores. */
export interface PrivateDocumentCount {
  table: PrivateDocumentTable;
  onBucket: number;
  notStoredHere: number;
}

/**
 * What is left to move — the preview, and the bucket gate in
 * `storageStatus.ts`. A pass over the rows not yet in Oxy, because "names a
 * bucket object" is the URL parse `privateDocumentRefFromRowUrl` does, not a
 * pattern SQL can match; the tables hold a tenancy's documents, not a feed.
 */
export async function countLegacyPrivateDocuments(): Promise<PrivateDocumentCount[]> {
  const counts: PrivateDocumentCount[] = [];
  for (const table of PRIVATE_DOCUMENT_TABLES) {
    const count = { table, onBucket: 0, notStoredHere: 0 };
    let afterId: string | null = null;
    for (;;) {
      const page = await findLegacyPrivateDocuments(table, afterId, 1000);
      for (const row of page) {
        if (bucketKeyOf(row)) count.onBucket += 1;
        else count.notStoredHere += 1;
      }
      if (page.length < 1000) break;
      afterId = page[page.length - 1].id;
    }
    counts.push(count);
  }
  return counts;
}
