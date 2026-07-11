/**
 * Migrate `Review.depositReturned` from the legacy Boolean to the
 * {@link DepositReturn} string enum.
 *
 *   true  → 'full'   (deposit returned in full)
 *   false → 'no'     (deposit not returned)
 *
 * Documents that predate the field, or that already hold an enum string, are
 * left untouched. The reviucasa 'partial' outcome has no Boolean predecessor,
 * so it is never produced by this migration.
 *
 * Usage:
 *   bun run packages/backend/scripts/migrateReviewDepositReturned.ts          # dry run
 *   bun run packages/backend/scripts/migrateReviewDepositReturned.ts --apply  # write
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

import { DepositReturn } from '@homiio/shared-types';
import database from '../database/connection';

const { Review } = require('../models');

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  await database.connect();

  // Match on the legacy BSON boolean type so already-migrated string values are
  // never re-touched.
  const trueFilter = { depositReturned: { $type: 'bool', $eq: true } };
  const falseFilter = { depositReturned: { $type: 'bool', $eq: false } };

  const [trueCount, falseCount] = await Promise.all([
    Review.countDocuments(trueFilter),
    Review.countDocuments(falseFilter),
  ]);

  console.log(
    `${APPLY ? 'Migrating' : 'Would migrate'} depositReturned: ` +
    `${trueCount} true → '${DepositReturn.FULL}', ${falseCount} false → '${DepositReturn.NO}'`,
  );

  if (APPLY) {
    if (trueCount > 0) {
      await Review.updateMany(trueFilter, { $set: { depositReturned: DepositReturn.FULL } });
    }
    if (falseCount > 0) {
      await Review.updateMany(falseFilter, { $set: { depositReturned: DepositReturn.NO } });
    }
    console.log('Migration complete.');
  }

  await database.disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
