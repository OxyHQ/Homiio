/**
 * Reconcile Homiio's file references with Oxy now, instead of waiting for the
 * nightly run (`services/files/referenceReconcile.ts`, ADR 0043 D6):
 *
 *   bun run packages/backend/scripts/reconcileFileReferences.ts                 # dry run
 *   bun run packages/backend/scripts/reconcileFileReferences.ts --apply         # reconcile
 *   ... --type=property                                 # one entity type only
 *
 * DRY RUN (the default) sends Homiio's full inventory per entity type and Oxy
 * answers what it WOULD add, remove, leave and refuse — and changes nothing.
 * `--apply` commits the same reconciliation and re-marks the pairs the drain
 * settled during it. Run the dry run first and read it: `removed` is
 * references Homiio no longer uses, `added` uses Oxy never heard of (photos
 * moved before their drain ran), `refused` files Oxy will not let Homiio
 * reference (deleted, blocked, or not Homiio's to name).
 *
 * Prints one JSON line per type and exits 1 if any type failed. A type
 * another task is reconciling right now (the nightly cron) is reported as
 * `busy` and not counted as a failure; run again.
 *
 * Needs `DATABASE_URL` and Homiio's Oxy service identity holding
 * `files:references:write`. Production runs it as a one-off ECS task of the
 * API image (`docs/oxy-files.md`).
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { closePostgres, connectPostgres } from '../db/postgres';
import { FILE_REFERENCE_ENTITY_TYPES } from '../db/schema/oxyFiles';
import { reconcileFileReferenceType } from '../services/files/referenceReconcile';
import type { FileReferenceEntityType } from '../services/files/referenceUsage';

const APPLY = process.argv.includes('--apply');

function requestedTypes(): readonly FileReferenceEntityType[] {
  const raw = process.argv.find((arg) => arg.startsWith('--type='))?.slice('--type='.length);
  if (!raw) return FILE_REFERENCE_ENTITY_TYPES;
  const types = raw.split(',').map((type) => type.trim());
  for (const type of types) {
    if (!(FILE_REFERENCE_ENTITY_TYPES as readonly string[]).includes(type)) {
      throw new Error(
        `Unknown entity type "${type}" (one of: ${FILE_REFERENCE_ENTITY_TYPES.join(', ')})`,
      );
    }
  }
  return types as FileReferenceEntityType[];
}

async function main(): Promise<void> {
  const types = requestedTypes();
  await connectPostgres();
  console.error(
    `[oxy-references] ${APPLY ? 'RECONCILING' : 'DRY RUN — nothing changes. Re-run with --apply.'}`,
  );
  let failed = 0;
  for (const entityType of types) {
    try {
      const report = await reconcileFileReferenceType(entityType, { dryRun: !APPLY });
      if (!report.result) {
        console.log(JSON.stringify({ entityType, busy: true }));
        continue;
      }
      const { dryRun, added, removed, unchanged, refused } = report.result;
      console.log(
        JSON.stringify({
          entityType,
          dryRun,
          added,
          removed,
          unchanged,
          refused,
          remarked: report.remarked,
        }),
      );
    } catch (error) {
      failed += 1;
      console.log(
        JSON.stringify({
          entityType,
          failed: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(
      '[oxy-references] failed:',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void closePostgres();
  });
