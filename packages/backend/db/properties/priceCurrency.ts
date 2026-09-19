/**
 * Which currencies a search scope's prices are actually in.
 *
 * ## Why this is a query and not a table
 *
 * A country does not determine the currency its listings are priced in.
 * Romania is the counter-example that settles it: `LISTING_CURRENCIES` carries
 * `RON`, and the same file records that "Romanian real estate is priced in
 * EUR". Both appear on Romanian listings, so any static country → currency map
 * would confidently answer one of them and silently filter the other half of
 * the market away. The only truthful source is the rows in scope.
 *
 * ## One census, two readers
 *
 * `priceHistogramForScope` has counted prices per currency since it shipped —
 * ADR 0004 §6.5 forbids mixing currencies inside a statistic, so the bars have
 * always shown one currency and reported the rest as `otherCurrencyCount`. The
 * price FILTER needed the same answer and did not have it: `priceMax=1200`
 * compared 1,200 against 1,200 RON and 1,200 zł as though they were one amount.
 *
 * So the census lives here and both read it. Two copies of "the currency of
 * this area" is how the bars come to describe a different set of homes from the
 * one the thumbs filter.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { parseListingCurrency, type ListingCurrency } from '@homiio/shared-types';

import { getDb } from '../postgres';
import { addresses, properties } from '../schema';

/** How many priced listings a scope holds in one currency. */
export interface PriceCurrencyCount {
  /** `null` for a priced listing whose currency column was never filled in. */
  currency: string | null;
  count: number;
}

export interface PriceCurrencyCensusOptions {
  /** The scope's predicate, from `resolveSearchScope` — WITHOUT the price bounds. */
  where: SQL | undefined;
  /** The offering's price column (`priceColumnForOffering`). */
  priceColumn: AnyPgColumn;
  /** That price's currency column. */
  currencyColumn: AnyPgColumn;
}

/**
 * Count the scope's priced listings by currency, most common first.
 *
 * Ordered by count and then by code so the answer is deterministic when two
 * currencies tie — a dominant currency that flipped between identical requests
 * would make a price filter return different homes on a refresh.
 *
 * A `null` currency is COUNTED and kept distinct rather than folded into any
 * code. It means "this listing has a price and nobody recorded what it is in",
 * which is not an answer to "is this under 1,200 euros".
 */
export async function priceCurrencyCensus(
  options: PriceCurrencyCensusOptions,
): Promise<PriceCurrencyCount[]> {
  const { where, priceColumn, currencyColumn } = options;
  const db = getDb();

  const rows = await db.execute<{ currency: string | null; total: number }>(sql`
    select ${currencyColumn} as currency, count(*)::int as total
    from ${properties}
    inner join ${addresses} on ${properties.addressId} = ${addresses.id}
    where ${where ?? sql`true`}
      and ${priceColumn} is not null
      and ${priceColumn} >= 0
    group by 1
    order by total desc, currency asc
  `);

  return [...rows].map((row) => ({ currency: row.currency, count: Number(row.total) }));
}

/**
 * The currency a scope's prices are mostly in, or `undefined` when the scope
 * holds no priced listing that names one.
 *
 * `undefined` is a real answer and the caller must not paper over it: a scope
 * with no priced listing has no currency, and a bound applied in an invented
 * one would return homes nobody asked about.
 */
export function dominantCurrency(census: readonly PriceCurrencyCount[]): ListingCurrency | undefined {
  for (const row of census) {
    // A code outside `LISTING_CURRENCIES` can exist in the column: external
    // listings are upserted with `updateOne`, which runs no validator (see the
    // `properties` schema header). Skipping it rather than trusting it keeps a
    // portal's stray string out of the filter, and the CHECK constraint keeps
    // it out of new rows.
    const parsed = parseListingCurrency(row.currency);
    if (parsed) return parsed;
  }
  return undefined;
}
