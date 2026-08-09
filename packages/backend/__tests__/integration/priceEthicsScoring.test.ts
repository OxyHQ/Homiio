/**
 * Price-ethics scoring, end to end, against a REAL Postgres.
 *
 * ## Why this suite exists at all
 *
 * Every write path calls `schedulePriceEthicsScore`, which is deliberately
 * FIRE-AND-FORGET: a scorer must never fail a listing create. The cost of that
 * is that when it breaks it breaks SILENTLY — the request still returns 201 and
 * the only trace is a log line nobody reads. Both halves of the port broke it
 * exactly that way and both were invisible to the rest of the suite:
 *
 *  - the read still went to Mongo, so every score threw
 *    `Cast to ObjectId failed for value "019fe6…"` — a uuid v7 id against an
 *    ObjectId path;
 *  - and once that was fixed, the WRITE threw `value.toISOString is not a
 *    function`, because `PropertyPriceEthics.scoredAt` is an ISO string on the
 *    wire and `price_ethics_scored_at` is a `timestamptz`.
 *
 * Neither turned a single existing test red. So the assertions below are on
 * the STORED COLUMNS after an awaited score — not on the promise resolving,
 * which it does either way.
 *
 * `scoreAndPersistProperty` is awaited directly rather than driven through
 * `schedulePriceEthicsScore`, because the scheduler's whole contract is that it
 * swallows the failure: a test that went through it could not tell a working
 * scorer from a broken one.
 */

import { eq } from 'drizzle-orm';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import { properties } from '../../db/schema';
import { scoreAndPersistProperty } from '../../services/priceEthicsService';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedNeighborhood,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

/** Barcelona, so every fixture sits inside the 2 km comparison radius. */
const BARCELONA = { longitude: 2.1686, latitude: 41.3874 };

/** The stored verdict block, read straight off the columns. */
async function storedPriceEthics(propertyId: string) {
  const [row] = await getDb()
    .select({
      isFairPrice: properties.priceEthicsIsFairPrice,
      fairnessScore: properties.priceEthicsFairnessScore,
      marketVerdict: properties.priceEthicsMarketVerdict,
      percentDiffFromAvg: properties.priceEthicsPercentDiffFromAvg,
      scoredAt: properties.priceEthicsScoredAt,
    })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return row ?? null;
}

/**
 * A published long-term-rent listing at (roughly) Barcelona centre.
 *
 * The tiny per-listing coordinate offset keeps every fixture inside the 2 km
 * radius while giving each its own address row — `addresses_normalized_key_key`
 * would otherwise collapse them into one building, and a comparison against a
 * single shared address is not the comparison this scorer performs.
 */
async function seedListing(
  chain: GeoChain,
  options: { monthlyAmount: number; index: number; neighborhoodId?: string },
): Promise<string> {
  const addressId = await seedAddress({
    chain,
    street: `Carrer de Prova ${options.index}`,
    longitude: BARCELONA.longitude + options.index * 0.0005,
    latitude: BARCELONA.latitude + options.index * 0.0005,
    neighborhoodId: options.neighborhoodId,
  });
  return seedProperty({
    addressId,
    idShape: 'generated',
    overrides: {
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      bathrooms: 1,
      squareFootage: 80,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: options.monthlyAmount,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
      availabilityIsAvailable: true,
    },
  });
}

beforeEach(async () => {
  await resetGeoTables();
});

describe('price ethics scoring', () => {
  it('stores a market verdict computed from nearby comparables', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-pe' });
    const neighborhoodId = await seedNeighborhood({ cityId: chain.cityId, name: 'Eixample' });

    // Six comparables around 1,000 €/month, then a target well above them.
    // `MIN_RADIUS_SAMPLE` is 5, so six is what makes the RADIUS scope — rather
    // than the city-wide fallback — the one under test.
    for (let index = 1; index <= 6; index += 1) {
      await seedListing(chain, { monthlyAmount: 1000, index, neighborhoodId });
    }
    const targetId = await seedListing(chain, {
      monthlyAmount: 2000,
      index: 7,
      neighborhoodId,
    });

    await scoreAndPersistProperty(targetId);

    const stored = await storedPriceEthics(targetId);
    // Twice the local average is unambiguously above market, whatever the exact
    // thresholds are — asserted on the verdict rather than on a score constant
    // so a threshold tweak does not need this test edited to stay meaningful.
    expect(stored?.marketVerdict).toBe('above_average');
    expect(stored?.percentDiffFromAvg).toBe(100);
    expect(stored?.isFairPrice).toBe(false);
    // The column is `timestamptz`; the domain value is an ISO STRING. This is
    // the assertion the `toISOString` failure would have caught.
    expect(stored?.scoredAt).toBeInstanceOf(Date);
  });

  it('scores a listing priced at the local average as fair', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-pf' });
    for (let index = 1; index <= 6; index += 1) {
      await seedListing(chain, { monthlyAmount: 1000, index });
    }
    const targetId = await seedListing(chain, { monthlyAmount: 1000, index: 7 });

    await scoreAndPersistProperty(targetId);

    const stored = await storedPriceEthics(targetId);
    expect(stored?.marketVerdict).toBe('average');
    expect(stored?.percentDiffFromAvg).toBe(0);
    expect(stored?.scoredAt).toBeInstanceOf(Date);
  });

  it('records a verdict-free score when there is no market to compare against', async () => {
    // One listing, no comparables. The scorer must still persist SOMETHING —
    // the ethical-pricing half does not depend on the market — and must not
    // invent a market verdict from an empty sample.
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-pg' });
    const targetId = await seedListing(chain, { monthlyAmount: 1200, index: 1 });

    await scoreAndPersistProperty(targetId);

    const stored = await storedPriceEthics(targetId);
    expect(stored?.scoredAt).toBeInstanceOf(Date);
    expect(stored?.marketVerdict).toBeNull();
    expect(stored?.percentDiffFromAvg).toBeNull();
  });

  it('leaves an unknown listing alone rather than throwing', async () => {
    // The scheduler swallows errors, so a throw here would be invisible in
    // production; the contract is that a missing listing is a no-op.
    await expect(
      scoreAndPersistProperty('019fe000-0000-7000-8000-000000000000'),
    ).resolves.toBeUndefined();
  });
});
