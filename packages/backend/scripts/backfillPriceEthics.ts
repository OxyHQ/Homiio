/**
 * Backfill `priceEthics` for published listings that were never scored or have
 * incomplete score data. Reuses `scoreAndPersistProperty` — no duplicate logic.
 *
 * Usage:
 *   bun run packages/backend/scripts/backfillPriceEthics.ts
 *   bun run packages/backend/scripts/backfillPriceEthics.ts --apply
 *   bun run packages/backend/scripts/backfillPriceEthics.ts --apply --limit=100
 *   bun run packages/backend/scripts/backfillPriceEthics.ts --apply --batch-size=25
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

import { PropertyStatus } from '@homiio/shared-types';
import database from '../database/connection';
import { scoreAndPersistProperty } from '../services/priceEthicsService';

const { Property } = require('../models');

const APPLY = process.argv.includes('--apply');

function readIntFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const BATCH_SIZE = readIntFlag('batch-size', 50);
const LIMIT = readIntFlag('limit', Number.MAX_SAFE_INTEGER);

const NEEDS_SCORE_FILTER = {
  $or: [
    { priceEthics: { $exists: false } },
    { priceEthics: null },
    { 'priceEthics.fairnessScore': { $exists: false } },
    { 'priceEthics.scoredAt': { $exists: false } },
  ],
};

const HAS_PRICE_FILTER = {
  $or: [
    { 'longTermRent.monthlyAmount': { $gt: 0 } },
    { 'shortTermRent.nightlyRate': { $gt: 0 } },
    { 'sale.price': { $gt: 0 } },
  ],
};

async function processBatch(ids: string[]): Promise<{ scored: number; failed: number }> {
  let scored = 0;
  let failed = 0;

  for (const propertyId of ids) {
    try {
      await scoreAndPersistProperty(propertyId);
      scored += 1;
    } catch (error) {
      failed += 1;
      console.error(`  failed ${propertyId}:`, error instanceof Error ? error.message : error);
    }
  }

  return { scored, failed };
}

async function main(): Promise<void> {
  await database.connect();

  const filter = {
    status: PropertyStatus.PUBLISHED,
    deletedAt: null,
    $and: [NEEDS_SCORE_FILTER, HAS_PRICE_FILTER],
  };

  const total = await Property.countDocuments(filter);
  const toProcess = Math.min(total, LIMIT);

  console.log(
    `${APPLY ? 'Scoring' : 'Would score'} ${toProcess} of ${total} published listing(s) ` +
      `(batch=${BATCH_SIZE}${LIMIT < Number.MAX_SAFE_INTEGER ? `, limit=${LIMIT}` : ''})`,
  );

  if (!APPLY) {
    const sample = await Property.find(filter)
      .select({ _id: 1, source: 1, sourceId: 1, isExternal: 1 })
      .limit(Math.min(10, toProcess))
      .lean();
    for (const doc of sample) {
      const label = doc.isExternal
        ? `external ${doc.source}/${doc.sourceId}`
        : `property ${doc._id}`;
      console.log(`  - ${label}`);
    }
    if (toProcess > sample.length) {
      console.log(`  … and ${toProcess - sample.length} more`);
    }
    await database.disconnect?.();
    return;
  }

  const cursor = Property.find(filter)
    .select({ _id: 1 })
    .lean()
    .cursor({ batchSize: BATCH_SIZE });

  let batch: string[] = [];
  let processed = 0;
  let scored = 0;
  let failed = 0;

  for await (const doc of cursor) {
    if (processed >= LIMIT) break;

    batch.push(String(doc._id));
    processed += 1;

    if (batch.length >= BATCH_SIZE || processed >= LIMIT) {
      const result = await processBatch(batch);
      scored += result.scored;
      failed += result.failed;
      console.log(`  batch done: ${processed}/${toProcess} processed (${scored} scored, ${failed} failed)`);
      batch = [];
    }
  }

  console.log(`Finished: ${scored} scored, ${failed} failed out of ${processed} processed`);
  await database.disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
