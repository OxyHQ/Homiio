/**
 * Hybrid Rental Data Migration
 *
 * Backfills the new hybrid-rental fields introduced by Stream A on every
 * existing Property document:
 *   - rentMode = 'long_term'        (when missing)
 *   - availabilityWindows = []      (when missing)
 *
 * Idempotent: re-running on an already-migrated database is a no-op because
 * the filters only match documents where the field is still missing.
 *
 * Usage:
 *   bun run migrate:hybrid
 *   # or
 *   ts-node --transpile-only scripts/migrate-hybrid-rental.ts
 */

require('dotenv').config();
import { RentMode } from '@homiio/shared-types';
import database from '../database/connection';

const Property = require('../models/schemas/PropertySchema');

interface MigrationStepResult {
  field: string;
  matched: number;
  modified: number;
}

async function backfillField(
  field: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>
): Promise<MigrationStepResult> {
  const result = await Property.updateMany(filter, { $set: update });
  return {
    field,
    matched: typeof result.matchedCount === 'number' ? result.matchedCount : 0,
    modified: typeof result.modifiedCount === 'number' ? result.modifiedCount : 0
  };
}

async function run(): Promise<void> {
  console.log('[migrate-hybrid-rental] Connecting to database...');
  await database.connect();

  console.log('[migrate-hybrid-rental] Backfilling missing fields...');

  const steps: MigrationStepResult[] = [];

  steps.push(
    await backfillField(
      'rentMode',
      { $or: [{ rentMode: { $exists: false } }, { rentMode: null }] },
      { rentMode: RentMode.LONG_TERM }
    )
  );

  steps.push(
    await backfillField(
      'availabilityWindows',
      { $or: [{ availabilityWindows: { $exists: false } }, { availabilityWindows: null }] },
      { availabilityWindows: [] }
    )
  );

  for (const step of steps) {
    console.log(
      `[migrate-hybrid-rental] ${step.field}: matched=${step.matched} modified=${step.modified}`
    );
  }

  const remaining = await Property.countDocuments({
    $or: [
      { rentMode: { $exists: false } },
      { rentMode: null },
      { availabilityWindows: { $exists: false } },
      { availabilityWindows: null }
    ]
  });

  console.log(`[migrate-hybrid-rental] Remaining un-migrated documents: ${remaining}`);

  if (remaining === 0) {
    console.log('[migrate-hybrid-rental] Migration complete.');
  } else {
    console.warn(
      `[migrate-hybrid-rental] WARNING: ${remaining} document(s) still missing fields after migration.`
    );
  }
}

run()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[migrate-hybrid-rental] FAILED:', message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await database.disconnect();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[migrate-hybrid-rental] disconnect error:', message);
    }
    process.exit(process.exitCode ?? 0);
  });
