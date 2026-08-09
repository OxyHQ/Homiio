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

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { PropertyStatus } from '@homiio/shared-types';
import { scoreAndPersistProperty } from '../services/priceEthicsService';
import {
  finalBatchToFlush,
  readyBatchAfterAppend,
} from './backfillPriceEthicsBatching';

import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { closePostgres, connectPostgres, getDb } from '../db/postgres';
import { properties } from '../db/schema';

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

/**
 * A listing whose verdict is missing or incomplete.
 *
 * The four Mongo branches this replaces (`priceEthics` absent, `priceEthics`
 * null, `fairnessScore` absent, `scoredAt` absent) collapse to two column
 * tests: the flattened block has no "absent versus null" distinction to make,
 * so a NULL in either column IS the un-scored state.
 */
const NEEDS_SCORE = or(
  isNull(properties.priceEthicsFairnessScore),
  isNull(properties.priceEthicsScoredAt),
);

/** A listing with a price to compare — any of the three priced offerings. */
const HAS_PRICE = or(
  gt(properties.longTermRentMonthlyAmount, 0),
  gt(properties.shortTermRentNightlyRate, 0),
  gt(properties.salePrice, 0),
);

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
  await connectPostgres();

  const filter = and(
    eq(properties.status, PropertyStatus.PUBLISHED),
    isNull(properties.deletedAt),
    NEEDS_SCORE,
    HAS_PRICE,
  );

  const [totalRow] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(properties)
    .where(filter);
  const total = totalRow?.total ?? 0;
  const toProcess = Math.min(total, LIMIT);

  console.log(
    `${APPLY ? 'Scoring' : 'Would score'} ${toProcess} of ${total} published listing(s) ` +
      `(batch=${BATCH_SIZE}${LIMIT < Number.MAX_SAFE_INTEGER ? `, limit=${LIMIT}` : ''})`,
  );

  if (!APPLY) {
    const sample = await getDb()
      .select({
        id: properties.id,
        source: properties.source,
        sourceId: properties.sourceId,
        isExternal: properties.isExternal,
      })
      .from(properties)
      .where(filter)
      .limit(Math.min(10, toProcess));
    for (const doc of sample) {
      const label = doc.isExternal
        ? `external ${doc.source}/${doc.sourceId}`
        : `property ${doc.id}`;
      console.log(`  - ${label}`);
    }
    if (toProcess > sample.length) {
      console.log(`  … and ${toProcess - sample.length} more`);
    }
    await closePostgres();
    return;
  }

  // KEYSET pagination on the primary key, not a Mongo cursor.
  //
  // The scorer WRITES the very columns the filter selects on, so an OFFSET walk
  // would skip listings: each batch scored shrinks the result set under the
  // next page's feet. Ordering by `id` and resuming after the last one seen is
  // stable under that, and it is also why the loop cannot simply re-query the
  // filter each time and take the first N — it would re-read forever if a
  // listing failed to score.
  let batch: string[] = [];
  let processed = 0;
  let cursorId: string | null = null;
  let scored = 0;
  let failed = 0;

  for (;;) {
    if (processed >= LIMIT) break;
    const page = await getDb()
      .select({ id: properties.id })
      .from(properties)
      .where(cursorId === null ? filter : and(filter, gt(properties.id, cursorId)))
      .orderBy(asc(properties.id))
      .limit(BATCH_SIZE);
    if (page.length === 0) break;
    cursorId = page[page.length - 1].id;

    for (const row of page) {
      if (processed >= LIMIT) break;

      batch.push(row.id);
      processed += 1;

      const ready = readyBatchAfterAppend(batch, BATCH_SIZE, processed, LIMIT);
      if (ready) {
        const result = await processBatch(ready);
        scored += result.scored;
        failed += result.failed;
        console.log(`  batch done: ${processed}/${toProcess} processed (${scored} scored, ${failed} failed)`);
        batch = [];
      }
    }
  }

  const remaining = finalBatchToFlush(batch);
  if (remaining) {
    const result = await processBatch(remaining);
    scored += result.scored;
    failed += result.failed;
    console.log(`  batch done: ${processed}/${toProcess} processed (${scored} scored, ${failed} failed)`);
  }

  console.log(`Finished: ${scored} scored, ${failed} failed out of ${processed} processed`);
  await closePostgres();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
