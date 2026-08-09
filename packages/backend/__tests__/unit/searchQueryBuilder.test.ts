/**
 * The search plan, asserted on the SQL it actually renders.
 *
 * `buildSearchPlan` used to return a Mongo filter OBJECT, which a test could
 * read a key off. It now returns drizzle `SQL` fragments, and the only honest
 * way to assert on one is to render it the way the driver will — column names
 * come from the casing authority and values are BOUND, so a test that stringified
 * the fragment by hand would be asserting against a spelling nothing uses.
 *
 * Rendering also makes the parameter list assertable, which matters more here
 * than it looks: `= $1` with `false` and `= $1` with `true` render identically
 * in the SQL text, so several of these tests are only meaningful because they
 * check `params` too.
 *
 * No database is touched. This file is the pure half of the query builder; the
 * behaviour of the predicates against real rows is
 * `__tests__/integration/propertyCatalogueReads.test.ts`.
 */

import { and, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { DATABASE_CASING } from '../../db/casing';
import {
  buildSearchPlan,
  buildSort,
  DEFAULT_PRICE_COLUMN,
  priceColumnForOffering,
} from '../../controllers/property/searchQueryBuilder';
import { properties } from '../../db/schema';
import { OfferingType } from '@homiio/shared-types';

const dialect = new PgDialect({ casing: DATABASE_CASING });

/** The rendered SQL and bound parameters of a condition list. */
function render(conditions: SQL[]): { sql: string; params: unknown[] } {
  const combined = conditions.length === 1 ? conditions[0] : and(...conditions);
  if (!combined) throw new Error('buildSearchPlan produced no conditions at all');
  const query = dialect.sqlToQuery(combined);
  return { sql: query.sql, params: query.params };
}

/** The rendered SQL of an ORDER BY list, one entry per clause. */
function renderSort(clauses: SQL[]): string[] {
  return clauses.map((clause) => dialect.sqlToQuery(clause).sql);
}

/**
 * Whether a rendered plan constrains `column` at all.
 *
 * Matches the QUOTED column name so a substring cannot match a different
 * column — `"price_ethics_is_fair_price"` contains `price`, and an unquoted
 * search for it would report the fair-price filter as a price-range filter.
 */
function constrains(sql: string, column: { name: string }): boolean {
  return sql.includes(`"${DATABASE_CASING === 'snake_case' ? toSnake(column.name) : column.name}"`);
}

/** The SQL name drizzle derives for a camelCase property name. */
function toSnake(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

describe('buildSearchPlan visibility floor', () => {
  it('always excludes soft-deleted and jury-restricted listings', () => {
    const { sql, params } = render(buildSearchPlan({}).conditions);
    expect(sql).toContain('"properties"."deleted_at" is null');
    expect(sql).toContain('"properties"."moderation_restricted" =');
    // The VALUE matters and the SQL text does not carry it.
    expect(params).toContain(false);
  });

  it('excludes restricted listings whatever status the caller asks for', () => {
    for (const status of ['published', 'restricted', 'draft', undefined]) {
      const { sql } = render(buildSearchPlan(status ? { status } : {}).conditions);
      expect(sql).toContain('"properties"."moderation_restricted" =');
    }
  });
});

describe('buildSearchPlan fairPrice filter', () => {
  it('constrains price_ethics_is_fair_price when fairPrice=true', () => {
    const { sql, params } = render(buildSearchPlan({ fairPrice: 'true' }).conditions);
    expect(sql).toContain('"properties"."price_ethics_is_fair_price" =');
    expect(params).toContain(true);
    expect(buildSearchPlan({ fairPrice: 'true' }).params.fairPrice).toBe(true);
  });

  it('ignores fairPrice when not explicitly true', () => {
    const { sql } = render(buildSearchPlan({ fairPrice: 'false' }).conditions);
    expect(sql).not.toContain('price_ethics_is_fair_price');
    expect(buildSearchPlan({ fairPrice: 'false' }).params.fairPrice).toBeUndefined();
  });
});

describe('buildSort', () => {
  it('sorts by the fairness score with a createdAt tie-breaker', () => {
    const { params } = buildSearchPlan({ sortBy: 'fairness', sortOrder: 'desc' });
    expect(renderSort(buildSort(params))).toEqual([
      '"properties"."price_ethics_fairness_score" desc nulls last',
      '"properties"."created_at" desc',
    ]);
  });

  it('honours an ascending fairness sort', () => {
    const { params } = buildSearchPlan({ sortBy: 'fairness', sortOrder: 'asc' });
    expect(renderSort(buildSort(params))[0]).toBe(
      '"properties"."price_ethics_fairness_score" asc nulls last',
    );
  });

  /**
   * NULLS LAST in BOTH directions, which is a deliberate difference from Mongo:
   * a missing price sorted FIRST there, so "cheapest first" led with listings
   * that have no price at all. See `db/properties/propertyReads`.
   */
  it('puts unpriced listings last in both price directions', () => {
    const ascending = buildSearchPlan({ sortBy: 'price', sortOrder: 'asc' });
    const descending = buildSearchPlan({ sortBy: 'price', sortOrder: 'desc' });
    expect(renderSort(buildSort(ascending.params))[0]).toBe(
      '"properties"."long_term_rent_monthly_amount" asc nulls last',
    );
    expect(renderSort(buildSort(descending.params))[0]).toBe(
      '"properties"."long_term_rent_monthly_amount" desc nulls last',
    );
  });

  it('resolves the price sort to the requested offering', () => {
    const shortTerm = buildSearchPlan({ sortBy: 'price', offering: 'short_term_rent' });
    expect(renderSort(buildSort(shortTerm.params))[0]).toContain('short_term_rent_nightly_rate');

    const sale = buildSearchPlan({ sortBy: 'price', offering: 'sale' });
    expect(renderSort(buildSort(sale.params))[0]).toContain('"properties"."sale_price"');
  });

  /**
   * `sortBy=salePrice` is UNREACHABLE, and has been since before this port.
   *
   * `buildSearchPlan` lower-cases the requested sort and tests it against a set
   * whose members are camelCase, so `salePrice` becomes `saleprice`, matches
   * nothing, and falls back to recency. `createdAt` has the same defect and is
   * harmless because its fallback IS recency. This is carried across verbatim
   * and pinned here rather than fixed, so that fixing it is a deliberate change
   * to what an endpoint returns rather than a side effect of a store migration —
   * `SORT_SALE_PRICE` is still reachable by constructing the params directly,
   * which is what the assertion above does.
   */
  it('does NOT reach the salePrice sort from the query string (pre-existing)', () => {
    const { params } = buildSearchPlan({ sortBy: 'salePrice' });
    expect(params.sortField).toBe('createdAt');
    expect(renderSort(buildSort(params))).toEqual(['"properties"."created_at" desc']);
  });

  it('ranks by text relevance only when a term is supplied', () => {
    const { params } = buildSearchPlan({ sortBy: 'relevance', q: 'barcelona' });
    expect(renderSort(buildSort(params, 'barcelona'))[0]).toContain('ts_rank');
    // Without a term there is nothing to rank against, so it falls back to
    // recency rather than to an empty tsquery that matches nothing.
    expect(renderSort(buildSort(params))).toEqual(['"properties"."created_at" desc']);
  });

  /**
   * `has_images DESC` is prepended by `propertyOrderBy`, not by `buildSort` —
   * once, for every feed, so a caller cannot forget it. Pinned here because the
   * Mongo original prepended it at four separate call sites and this is where a
   * reader will look for it.
   */
  it('does not prepend the image-first key itself', () => {
    const { params } = buildSearchPlan({});
    expect(renderSort(buildSort(params)).join(' ')).not.toContain('has_images');
  });
});

describe('buildSearchPlan category-lens filters', () => {
  it('adds petFriendly when petFriendly=true (home "Pet friendly" lens)', () => {
    const { sql, params } = render(buildSearchPlan({ petFriendly: 'true' }).conditions);
    expect(sql).toContain('"properties"."pet_friendly" =');
    expect(params).toContain(true);
  });

  it('ignores petFriendly when not a literal boolean', () => {
    const { sql } = render(buildSearchPlan({ petFriendly: 'yes' }).conditions);
    expect(sql).not.toContain('pet_friendly');
  });

  it('adds instantBook when instantBook=true (home "Instant book" lens)', () => {
    const { sql } = render(buildSearchPlan({ instantBook: 'true' }).conditions);
    expect(sql).toContain('"properties"."short_term_rent_instant_book" =');
  });

  it('applies exchangeMode only for an EXCHANGE offering', () => {
    const withExchange = render(
      buildSearchPlan({ offering: 'exchange', exchangeMode: 'swap' }).conditions,
    );
    expect(withExchange.sql).toContain('"properties"."exchange_mode" = any($');
    // A `swap` request also matches a `both` listing — and the pair is bound as
    // ONE array parameter. A bare `${array}` would render `($5, $6)`, a row
    // constructor, which Postgres refuses to cast to `text[]`; asserting the
    // parameter SHAPE here is what catches that regression without a database.
    expect(withExchange.params).toContainEqual(['swap', 'both']);

    const withoutExchange = render(
      buildSearchPlan({ offering: 'sale', exchangeMode: 'swap' }).conditions,
    );
    expect(withoutExchange.sql).not.toContain('exchange_mode');
  });
});

describe('priceColumnForOffering', () => {
  it('maps each priced offering to its own column, and exchange to none', () => {
    expect(priceColumnForOffering(OfferingType.LONG_TERM_RENT)).toBe(properties.longTermRentMonthlyAmount);
    expect(priceColumnForOffering(OfferingType.SHORT_TERM_RENT)).toBe(properties.shortTermRentNightlyRate);
    expect(priceColumnForOffering(OfferingType.SALE)).toBe(properties.salePrice);
    expect(priceColumnForOffering(OfferingType.EXCHANGE)).toBeNull();
    expect(priceColumnForOffering(undefined)).toBeNull();
    // The fallback the price range uses when no offering is requested.
    expect(DEFAULT_PRICE_COLUMN).toBe(properties.longTermRentMonthlyAmount);
  });
});

describe('buildSearchPlan price ranges', () => {
  it('applies a bare range to the requested offering, never to sale', () => {
    const shortTerm = render(
      buildSearchPlan({ offering: 'short_term_rent', priceMin: '50' }).conditions,
    );
    expect(shortTerm.sql).toContain('"properties"."short_term_rent_nightly_rate" >=');
    expect(shortTerm.params).toContain(50);

    // A sale query ignores the bare range — it has its own params.
    const sale = render(buildSearchPlan({ offering: 'sale', priceMin: '50' }).conditions);
    expect(sale.sql).not.toContain('"properties"."long_term_rent_monthly_amount"');
    expect(sale.params).not.toContain(50);
  });

  it('applies minSalePrice ONLY for an explicit sale query', () => {
    const sale = render(buildSearchPlan({ offering: 'sale', minSalePrice: '250000' }).conditions);
    expect(sale.sql).toContain('"properties"."sale_price" >=');
    expect(sale.params).toContain(250000);

    const notSale = render(buildSearchPlan({ minSalePrice: '250000' }).conditions);
    expect(notSale.sql).not.toContain('"properties"."sale_price"');
    // …but the value is still echoed for downstream visibility.
    expect(buildSearchPlan({ minSalePrice: '250000' }).params.minSalePrice).toBe(250000);
  });
});

describe('buildSearchPlan excludeIds', () => {
  /**
   * The id-SHAPE filter is GONE. The old builder passed each entry through
   * `Types.ObjectId.isValid` and silently dropped what failed, so post-cutover
   * every uuid v7 in an exclude list was discarded and the listing reappeared.
   */
  it('excludes ids of every shape, including a uuid v7', () => {
    const uuid = '019fd591-0000-7000-8000-000000000000';
    const hex = '6a515dd9c196de4ad2a8550e';
    const { sql, params } = render(buildSearchPlan({ excludeIds: `${uuid},${hex}` }).conditions);
    expect(sql).toContain('"properties"."id" not in');
    expect(params).toEqual(expect.arrayContaining([uuid, hex]));
  });

  it('applies no exclusion at all for an empty list', () => {
    const { sql } = render(buildSearchPlan({ excludeIds: ' , ' }).conditions);
    expect(sql).not.toContain('not in');
  });
});

describe('the rendering helpers themselves', () => {
  /**
   * A vacuity floor on this file. Every assertion above reads a rendered
   * string, so a `render` that returned `''` — or a `buildSearchPlan` that
   * returned no conditions — would make most of the `not.toContain` checks pass
   * for the wrong reason.
   */
  it('renders a non-trivial plan with real columns and real parameters', () => {
    const { sql, params } = render(buildSearchPlan({}).conditions);
    expect(sql.length).toBeGreaterThan(50);
    expect(params.length).toBeGreaterThan(0);
    expect(constrains(sql, { name: 'deletedAt' })).toBe(true);
  });
});
