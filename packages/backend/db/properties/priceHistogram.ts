/**
 * How many listings sit at each price, for ONE search scope — the bars under a
 * search's price slider.
 *
 * ## The scope is the caller's, never this module's
 *
 * `where` arrives already built by `resolveSearchScope`
 * (`controllers/property/search.ts`), the same predicate the result page and its
 * count run under, minus the price bounds. Nothing here adds a location, a
 * status or a visibility rule of its own, so the histogram cannot describe a
 * wider set of homes than the search it sits under.
 *
 * ## One currency per distribution
 *
 * Prices are compared as stored, in their listing's own currency, and ADR 0004
 * §6.5 forbids mixing currencies inside a statistic. So the buckets count ONE
 * currency — the one asked for, or the scope's most common — and the listings
 * priced in any other are reported as `otherCurrencyCount` rather than folded
 * in at face value.
 *
 * ## The edge buckets are open-ended
 *
 * `width_bucket` answers 0 below `min` and `buckets + 1` at or above `max`;
 * both are clamped into the first and last bucket. That is what a price slider
 * whose ends mean "no limit" draws, and it keeps the invariant the tests pin:
 * the counts sum to every priced listing in the scope and currency.
 *
 * Written as raw statements rather than a `.select()` projection for the reason
 * `db/analytics/ownerAnalytics.ts` records: inside a projection drizzle renders
 * an interpolated column unqualified, and a GROUP BY over the same expression
 * then fails as "not grouped".
 */

import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { getDb } from '../postgres';
import { addresses, properties } from '../schema';

/** The share of the scope the upper bound covers when the caller names none. */
const DEFAULT_UPPER_PERCENTILE = 0.98;

export interface PriceHistogramBucket {
  /** Inclusive lower edge; the FIRST bucket also holds every price below it. */
  from: number;
  /** Exclusive upper edge; the LAST bucket also holds every price at or above it. */
  to: number;
  count: number;
}

export interface PriceHistogram {
  currency: string;
  /** The first bucket's lower edge. */
  min: number;
  /** The last bucket's upper edge. */
  max: number;
  /** Priced listings in the scope AND the currency — the sum of `buckets[].count`. */
  count: number;
  /** Priced listings in the scope carrying a different (or no) currency, left out. */
  otherCurrencyCount: number;
  buckets: PriceHistogramBucket[];
}

export interface PriceHistogramOptions {
  /** The scope's predicate, from `resolveSearchScope`. */
  where: SQL | undefined;
  /** The offering's price column (`priceColumnForOffering`). */
  priceColumn: AnyPgColumn;
  /** That price's currency column. */
  currencyColumn: AnyPgColumn;
  /** How many buckets split `min`..`max`. */
  bucketCount: number;
  /** ISO 4217 code; the scope's most common currency when absent. */
  currency?: string;
  /** Lower edge; the lowest price in the scope when absent. */
  min?: number;
  /** Upper edge; the scope's 98th-percentile price when absent. */
  max?: number;
}

/**
 * The price distribution of a search scope, or `null` when the scope holds no
 * priced listing in the chosen currency.
 */
export async function priceHistogramForScope(options: PriceHistogramOptions): Promise<PriceHistogram | null> {
  const { priceColumn, currencyColumn, bucketCount } = options;
  const db = getDb();

  const scoped = sql`
    from ${properties}
    inner join ${addresses} on ${properties.addressId} = ${addresses.id}
    where ${options.where ?? sql`true`}
      and ${priceColumn} is not null
      and ${priceColumn} >= 0
  `;

  // Census first: which currencies the scope's prices are in, so the buckets
  // can count one of them and say how many they left out.
  const census = await db.execute<{ currency: string | null; total: number }>(sql`
    select ${currencyColumn} as currency, count(*)::int as total
    ${scoped}
    group by 1
    order by total desc, currency asc
  `);
  const rows = [...census].map((row) => ({ currency: row.currency, total: Number(row.total) }));
  const priced = rows.reduce((sum, row) => sum + row.total, 0);

  const currency =
    options.currency ?? rows.find((row) => row.currency !== null)?.currency ?? undefined;
  if (!currency) return null;
  const inCurrency = rows.find((row) => row.currency === currency)?.total ?? 0;
  if (inCurrency === 0) return null;

  // Both are AGGREGATES even when the edge is named (`min(<constant>)`): a bare
  // parameter selected `from scoped` would answer once per listing, not once.
  // A named edge skips its data-driven form, so a slider's fixed track costs
  // no percentile sort.
  const lowerBound =
    options.min === undefined ? sql`min(price)` : sql`min(${options.min}::double precision)`;
  const upperBound =
    options.max === undefined
      ? sql`percentile_disc(${DEFAULT_UPPER_PERCENTILE}) within group (order by price)`
      : sql`max(${options.max}::double precision)`;

  // `edges` widens a zero-width span (every price equal, or a named minimum at
  // or above the percentile) by one unit, because `width_bucket` rejects
  // `low = high` and a single bar is the honest picture of one price anyway.
  const bucketRows = await db.execute<{ lo: number; hi: number; bucket: number | null; total: number }>(sql`
    with scoped as (
      select ${priceColumn}::double precision as price
      ${scoped}
        and ${currencyColumn} = ${currency}
    ),
    bounds as (
      select ${lowerBound} as lo, ${upperBound} as hi from scoped
    ),
    edges as (
      select lo, case when hi > lo then hi else lo + 1 end as hi from bounds
    )
    select
      edges.lo,
      edges.hi,
      least(greatest(width_bucket(scoped.price, edges.lo, edges.hi, ${bucketCount}::int), 1), ${bucketCount}::int) as bucket,
      count(*)::int as total
    from scoped cross join edges
    group by edges.lo, edges.hi, bucket
  `);

  const parsed = [...bucketRows];
  if (parsed.length === 0) return null;
  const min = Number(parsed[0].lo);
  const max = Number(parsed[0].hi);
  const width = (max - min) / bucketCount;
  const counts = new Array<number>(bucketCount).fill(0);
  for (const row of parsed) {
    counts[Number(row.bucket) - 1] += Number(row.total);
  }

  return {
    currency,
    min,
    max,
    count: inCurrency,
    otherCurrencyCount: priced - inCurrency,
    buckets: counts.map((count, index) => ({
      from: min + index * width,
      // The last edge is `max` exactly rather than an accumulated float.
      to: index === bucketCount - 1 ? max : min + (index + 1) * width,
      count,
    })),
  };
}
