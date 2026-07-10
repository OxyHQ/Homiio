/**
 * Archive external listings with absurd or unreliable monthly rents (e.g. Blueground
 * PARTNERS_NETWORK `lowestRent` mis-published as monthly).
 *
 * Usage:
 *   bun run packages/backend/scripts/cleanup-absurd-external-prices.ts
 *   bun run packages/backend/scripts/cleanup-absurd-external-prices.ts --apply
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

import { PropertyStatus } from '@homiio/shared-types';
import { validateMonthlyRentAmount } from '@homiio/listing-providers';
import database from '../database/connection';

const { Property } = require('../models');

const APPLY = process.argv.includes('--apply');

const KNOWN_BAD_SOURCE_IDS = new Set(['bcn-1549599p']);

async function main(): Promise<void> {
  await database.connect();

  const externals = await Property.find({
    isExternal: true,
    status: PropertyStatus.PUBLISHED,
    offerings: 'long_term_rent',
    'longTermRent.monthlyAmount': { $exists: true },
  })
    .select({ source: 1, sourceId: 1, longTermRent: 1, bedrooms: 1 })
    .lean();

  const toArchive: Array<{ source: string; sourceId: string; reason: string }> = [];

  for (const doc of externals) {
    const source = typeof doc.source === 'string' ? doc.source : '';
    const sourceId = typeof doc.sourceId === 'string' ? doc.sourceId : '';
    const monthlyAmount = doc.longTermRent?.monthlyAmount;
    const currency = doc.longTermRent?.currency;
    const bedrooms = typeof doc.bedrooms === 'number' ? doc.bedrooms : undefined;

    if (KNOWN_BAD_SOURCE_IDS.has(sourceId)) {
      toArchive.push({ source, sourceId, reason: 'known bad Blueground partner listing' });
      continue;
    }

    const priceError = validateMonthlyRentAmount(monthlyAmount, currency, { bedrooms });
    if (priceError) {
      toArchive.push({ source, sourceId, reason: priceError });
    }
  }

  console.log(`${APPLY ? 'Archiving' : 'Would archive'} ${toArchive.length} external listing(s)`);
  for (const row of toArchive) {
    console.log(`  - ${row.source}/${row.sourceId}: ${row.reason}`);
  }

  if (APPLY && toArchive.length > 0) {
    const now = new Date();
    for (const row of toArchive) {
      await Property.updateOne(
        { source: row.source, sourceId: row.sourceId, isExternal: true },
        { $set: { status: PropertyStatus.ARCHIVED, expiresAt: now } },
      );
    }
  }

  await database.disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
