/**
 * Copy the photos in Homiio's own bucket into Oxy Files (ADR 0043 stage 4).
 *
 * `services/files/imageMigration.ts` is the logic and says what moves to whom;
 * `docs/oxy-files.md` is the runbook. This is the command:
 *
 *   bun run packages/backend/scripts/migrateImagesToOxy.ts                    # preview
 *   bun run packages/backend/scripts/migrateImagesToOxy.ts --apply            # copy
 *   ... --apply --limit=5000 --concurrency=4 --report=/tmp/oxy-images.jsonl
 *   ... --apply --detach-missing      # also take unreadable photos off listings
 *
 * PREVIEW (the default) writes nothing and uploads nothing: it counts what is
 * left by kind. `--apply` copies in id order, `--concurrency` rows at a time,
 * and appends one JSON line per row to `--report` (default: stdout) — row id,
 * outcome, owner kind, SHA-256 and size; never a key or a URL. Resumable: a
 * row already in Oxy is never selected again, so re-running after a crash, a
 * deploy or `--limit` continues where it stopped. Run it until the preview
 * reports nothing left.
 *
 * Needs `DATABASE_URL`, the bucket (`AWS_S3_BUCKET` + the task role, as the
 * API task has), and Homiio's Oxy service identity holding `files:app:write`
 * and `files:user-media:write`. Production runs it as a one-off ECS task of
 * the API image, like the other backfills.
 */

import path from 'path';
import { appendFileSync } from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { closePostgres, connectPostgres } from '../db/postgres';
import {
  countLegacyImages,
  detachMissingImage,
  findLegacyImages,
  type MigrationReportLine,
  migrateLegacyImage,
} from '../services/files/imageMigration';
import { mapWithConcurrency } from '../utils/concurrency';

const APPLY = process.argv.includes('--apply') || process.env.OXY_IMAGES_APPLY === '1';
const DETACH_MISSING = process.argv.includes('--detach-missing');

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
const PAGE = 200;
const REPORT = flag('report');

function report(line: MigrationReportLine): void {
  const json = JSON.stringify(line);
  if (REPORT) appendFileSync(REPORT, `${json}\n`);
  else console.log(json);
}

async function main(): Promise<void> {
  await connectPostgres();
  const before = await countLegacyImages();
  console.error('[oxy-images] left to move:', JSON.stringify(before));
  if (!APPLY) {
    console.error('[oxy-images] PREVIEW only — nothing uploaded or written. Re-run with --apply.');
    return;
  }

  const totals = new Map<string, number>();
  let done = 0;
  let afterId: string | null = null;
  while (done < LIMIT) {
    const page = await findLegacyImages(afterId, Math.min(PAGE, LIMIT - done));
    if (page.length === 0) break;
    afterId = page[page.length - 1].imageId;
    const lines = await mapWithConcurrency(page, CONCURRENCY, async (candidate) => {
      const line = await migrateLegacyImage(candidate);
      if (line.outcome === 'missing_object' && DETACH_MISSING) {
        await detachMissingImage(candidate.imageId);
        return { ...line, error: 'detached' };
      }
      return line;
    });
    for (const line of lines) {
      report(line);
      totals.set(line.outcome, (totals.get(line.outcome) ?? 0) + 1);
    }
    done += page.length;
    console.error(
      `[oxy-images] ${done} rows processed`,
      JSON.stringify(Object.fromEntries(totals)),
    );
  }
  console.error('[oxy-images] left to move:', JSON.stringify(await countLegacyImages()));
}

main()
  .catch((error: unknown) => {
    console.error('[oxy-images] failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => {
    void closePostgres();
  });
