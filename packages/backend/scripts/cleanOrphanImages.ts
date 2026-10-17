/**
 * Delete the `images` rows nothing shows — the ~948 left behind by expired
 * listings, and every one since (`db/images/unusedImages.ts` explains the
 * defect and its root fix; the nightly sweep in `services/cron.ts` keeps it
 * at zero after this).
 *
 *   bun run packages/backend/scripts/cleanOrphanImages.ts            # preview
 *   bun run packages/backend/scripts/cleanOrphanImages.ts --apply    # delete
 *   ... --apply --max=5000 --grace-hours=24
 *
 * PREVIEW (the default) counts the rows by entity type and by where their
 * bytes are (a legacy bucket object, or an Oxy file) and deletes nothing.
 * `--apply` walks the table once in id windows (`deleteUnusedImages`),
 * re-checking "shown by nothing" in the DELETE itself, and prints the ids it
 * removed. The bytes are not deleted
 * here: a legacy row's objects go with the bucket's retirement, and an Oxy
 * file stopped being used when its last listing went (Oxy collects a
 * Homiio-owned one; a person's stays theirs).
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { closePostgres, connectPostgres, getDb } from '../db/postgres';
import {
  countUnusedImages,
  sweepUnusedImages,
  UNUSED_IMAGE_GRACE_HOURS,
} from '../db/images/unusedImages';

const APPLY = process.argv.includes('--apply') || process.env.ORPHAN_IMAGES_APPLY === '1';

function intFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const MAX = intFlag('max', Number.MAX_SAFE_INTEGER);
const GRACE_HOURS = intFlag('grace-hours', UNUSED_IMAGE_GRACE_HOURS);

async function main(): Promise<void> {
  await connectPostgres();
  const counts = await countUnusedImages(getDb(), GRACE_HOURS);
  const total = counts.reduce((sum, row) => sum + row.rows, 0);
  console.log(`[orphan-images] unshown for ${GRACE_HOURS}h+: ${total}`);
  for (const row of counts) {
    console.log(`  ${row.entityType.padEnd(14)} ${row.storage.padEnd(7)} ${row.rows}`);
  }
  if (!APPLY) {
    console.log('[orphan-images] PREVIEW only — nothing deleted. Re-run with --apply.');
    return;
  }
  const deleted = await sweepUnusedImages(getDb(), {
    maxRows: MAX,
    graceHours: GRACE_HOURS,
    onWindow: (ids) => {
      for (const id of ids) console.log(`deleted ${id}`);
    },
  });
  console.log(`[orphan-images] deleted ${deleted}`);
}

main()
  .catch((error: unknown) => {
    console.error(
      '[orphan-images] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void closePostgres();
  });
