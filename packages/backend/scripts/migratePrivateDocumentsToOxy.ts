/**
 * Move the private documents in Homiio's bucket into their owners' Oxy
 * accounts (ADR 0043 stage 4c).
 *
 * `services/files/privateDocumentMigration.ts` is the logic and says what moves
 * to whom; `docs/oxy-files.md` is the runbook. This is the command:
 *
 *   bun run packages/backend/scripts/migratePrivateDocumentsToOxy.ts            # preview
 *   bun run packages/backend/scripts/migratePrivateDocumentsToOxy.ts --apply    # move
 *   ... --apply --limit=500 --concurrency=4 --per-minute=20 --report=/tmp/oxy-private-docs.jsonl
 *
 * PREVIEW (the default) writes nothing and uploads nothing: it counts, per
 * table, the rows still on the bucket and the rows that name nothing Homiio
 * stores (an applicant's own link, which never moves). `--apply` moves rows in
 * id order, table by table, `--concurrency` at a time, and appends one JSON
 * line per row to `--report` (default: stdout) — table, row id, outcome,
 * SHA-256 and size; never a key, a URL or a person. Resumable: a moved row is
 * never selected again. Run it until the preview reports nothing on the bucket.
 *
 * Every row is read back through Homiio's consent before it is switched, and
 * the run STOPS at the first `read_back_refused` (exit 2): that is an Oxy
 * without stage 4c, and nothing has moved.
 *
 * Needs `DATABASE_URL`, the bucket (`AWS_S3_BUCKET` + the task role, as the
 * API task has), and Homiio's Oxy service identity holding
 * `files:user-media:write` and `files:linked:read`. Production runs it as a
 * one-off ECS task of the API image, like the other backfills.
 */

import path from 'path';
import { appendFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { closePostgres, connectPostgres } from '../db/postgres';
import {
  countLegacyPrivateDocuments,
  findLegacyPrivateDocuments,
  migratePrivateDocument,
  PRIVATE_DOCUMENT_TABLES,
  type PrivateDocumentReportLine,
} from '../services/files/privateDocumentMigration';
import { OXY_APP_UPLOADS_PER_MINUTE, OxyCallPacer } from '../services/files/oxyCallPacer';
import { mapWithConcurrency } from '../utils/concurrency';

const APPLY = process.argv.includes('--apply');

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function intFlag(name: string, fallback: number): number {
  const parsed = Number.parseInt(flag(name) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const LIMIT = intFlag('limit', Number.MAX_SAFE_INTEGER);
const CONCURRENCY = intFlag('concurrency', 4);
/** Uploads started a minute; Oxy's budget is shared with the live app (see oxyCallPacer.ts). */
const PER_MINUTE = Math.min(intFlag('per-minute', 20), OXY_APP_UPLOADS_PER_MINUTE);
const PAGE = 200;
const REPORT = flag('report');

function report(line: PrivateDocumentReportLine): void {
  const json = JSON.stringify(line);
  if (REPORT) appendFileSync(REPORT, `${json}\n`);
  else console.log(json);
}

async function main(): Promise<void> {
  await connectPostgres();
  console.error('[oxy-private-docs] left:', JSON.stringify(await countLegacyPrivateDocuments()));
  if (!APPLY) {
    console.error(
      '[oxy-private-docs] PREVIEW only — nothing uploaded or written. Re-run with --apply.',
    );
    return;
  }

  const pacer = new OxyCallPacer({
    perMinute: PER_MINUTE,
    onRateLimited: (waitMs) =>
      console.error(
        `[oxy-private-docs] Oxy rate limit: waiting ${Math.round(waitMs / 1000)}s, then resending`,
      ),
  });
  const totals = new Map<string, number>();
  let done = 0;
  let refused = false;
  for (const table of PRIVATE_DOCUMENT_TABLES) {
    let afterId: string | null = null;
    while (done < LIMIT && !refused) {
      const page = await findLegacyPrivateDocuments(table, afterId, Math.min(PAGE, LIMIT - done));
      if (page.length === 0) break;
      afterId = page[page.length - 1].id;
      const lines = await mapWithConcurrency(page, CONCURRENCY, (row) =>
        migratePrivateDocument(row, { pacer }),
      );
      for (const line of lines) {
        report(line);
        totals.set(line.outcome, (totals.get(line.outcome) ?? 0) + 1);
        if (line.outcome === 'read_back_refused') refused = true;
      }
      done += page.length;
      console.error(
        `[oxy-private-docs] ${done} rows processed`,
        JSON.stringify(Object.fromEntries(totals)),
      );
    }
  }
  console.error('[oxy-private-docs] left:', JSON.stringify(await countLegacyPrivateDocuments()));
  if (refused) {
    console.error(
      '[oxy-private-docs] STOPPED: Oxy would not hand a stored document back to Homiio ' +
        '(stage 4c not serving, or files:linked:read not granted). Rows stay on the bucket.',
    );
    process.exitCode = 2;
  }
}

main()
  .catch((error: unknown) => {
    console.error(
      '[oxy-private-docs] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void closePostgres();
  });
