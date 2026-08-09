/**
 * Archive external listings with absurd or unreliable monthly rents (e.g. Blueground
 * PARTNERS_NETWORK `lowestRent` mis-published as monthly).
 *
 * Usage:
 *   bun run packages/backend/scripts/cleanup-absurd-external-prices.ts
 *   bun run packages/backend/scripts/cleanup-absurd-external-prices.ts --apply
 */

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { validateMonthlyRentAmount } from '@homiio/listing-providers';
import { closePostgres, connectPostgres, getDb } from '../db/postgres';
import { properties } from '../db/schema';
import { expireExternalProperty } from '../db/properties/propertyWrites';

const APPLY = process.argv.includes('--apply');

const KNOWN_BAD_SOURCE_IDS = new Set(['bcn-1549599p']);

async function main(): Promise<void> {
  await connectPostgres();

  const externals = await getDb()
    .select({
      source: properties.source,
      sourceId: properties.sourceId,
      monthlyAmount: properties.longTermRentMonthlyAmount,
      currency: properties.longTermRentCurrency,
      bedrooms: properties.bedrooms,
    })
    .from(properties)
    .where(
      and(
        eq(properties.isExternal, true),
        eq(properties.status, 'published'),
        sql`${properties.offerings} @> array['long_term_rent']::text[]`,
        isNotNull(properties.longTermRentMonthlyAmount),
      ),
    );

  const toArchive: Array<{ source: string; sourceId: string; reason: string }> = [];

  for (const doc of externals) {
    const source = doc.source;
    const sourceId = doc.sourceId ?? '';
    const monthlyAmount = doc.monthlyAmount ?? undefined;
    const currency = doc.currency ?? undefined;
    const bedrooms = doc.bedrooms ?? undefined;

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
    // The same archive path the worker uses when a portal stops publishing a
    // listing, rather than a second spelling of it here: archived AND stamped
    // with a deadline, so `db/expiry.ts`'s sweep can eventually reap it.
    for (const row of toArchive) {
      await expireExternalProperty(row.source, row.sourceId);
    }
  }

  await closePostgres();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
