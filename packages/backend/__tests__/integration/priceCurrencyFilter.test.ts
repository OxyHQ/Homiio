/**
 * A price bound means an amount IN A CURRENCY (#518 §6, #519 §6.1).
 *
 * ## The bug this pins
 *
 * `priceMax=1200` was rendered as `long_term_rent_monthly_amount <= 1200` and
 * nothing else. The column holds whatever the listing was advertised in, and
 * production carries six different codes in it, so a search for homes under
 * 1,200 euros returned homes at 1,200 zł (about €280) and 1,200 RON (about
 * €240) as though they were the same amount. Nothing threw. The page just
 * answered a different question from the one asked, and looked right doing it.
 *
 * ADR 0004 already forbade mixing currencies inside a statistic — the price
 * histogram has counted one currency and reported `otherCurrencyCount` since it
 * shipped. The FILTER under the same slider did not, which is how the bars and
 * the thumbs came to describe different sets of homes.
 *
 * ## The listing that makes the case, and the one that states the cost
 *
 * A GBP listing at 1,100 is the discriminating row: 1,100 is inside a bound of
 * 1,200 as a NUMBER, and £1,100 is about €1,290, so it is outside the bound as
 * MONEY. The old filter returned it — a home dearer than the maximum somebody
 * set, on the page they set it on. Each assertion names ids rather than
 * counting, because "two in, two out" and "the wrong two in" have the same
 * length.
 *
 * Beside it, a PLN listing at 1,000 (about €230) is the honest cost of the same
 * rule: genuinely cheaper than the bound, and still left out, because Homiio
 * has no exchange rate it can cite or version and a converted bound would be an
 * invented price (ADR 0004). That listing is not hidden — it is counted in the
 * histogram's `otherCurrencyCount` and the slider says so. A test that seeded
 * only the GBP row would pass while quietly pretending the trade-off does not
 * exist.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import {
  OfferingType,
  PropertyStatus,
  PropertyType,
  type ListingCurrency,
} from '@homiio/shared-types';

import { getProperties } from '../../controllers/property/list';
import { searchProperties } from '../../controllers/property/search';
import { getSearchPriceHistogram } from '../../controllers/property/priceHistogram';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoTables, seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search', searchProperties);
  app.get('/properties/search/price-histogram', getSearchPriceHistogram);
  app.get('/properties', getProperties);
  app.use(errorHandler);
  return app;
}

/** The ids a response returned, in no particular order. */
function idsOf(body: { data?: Array<{ id?: string }> }): string[] {
  return (body.data ?? []).map((row) => String(row.id)).sort();
}

describe('a price bound applies in ONE currency', () => {
  let city: string;
  /** 900 EUR — inside a 1,200 EUR bound. */
  let euroCheap: string;
  /** 1,100 EUR — inside it too. */
  let euroMid: string;
  /** 1,500 EUR — outside it. */
  let euroDear: string;
  /** 1,100 GBP ≈ €1,290: inside the bound by NUMBER, outside it by MONEY. */
  let poundDear: string;
  /** 1,000 PLN ≈ €230: cheaper than the bound, and still not an answer to it. */
  let zlotyCheap: string;

  beforeEach(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({
      cityName: 'Kraków',
      regionName: 'Lesser Poland',
      countryCode: 'PL',
      countryName: 'Poland',
    });
    city = chain.cityId;

    const seedRent = async (amount: number, currency: ListingCurrency): Promise<string> =>
      seedProperty({
        addressId: await seedAddress({ chain }),
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.APARTMENT,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: amount,
          longTermRentCurrency: currency,
        },
      });

    // Three EUR listings to one each of GBP and PLN, so EUR is unambiguously
    // the scope's dominant currency and the tie-break never decides anything.
    euroCheap = await seedRent(900, 'EUR');
    euroMid = await seedRent(1100, 'EUR');
    euroDear = await seedRent(1500, 'EUR');
    poundDear = await seedRent(1100, 'GBP');
    zlotyCheap = await seedRent(1000, 'PLN');
  });

  it('leaves out a listing that is inside the bound only as a NUMBER', async () => {
    const res = await request(buildApp())
      .get('/properties/search')
      .query({ city, offering: OfferingType.LONG_TERM_RENT, priceMax: '1200', priceCurrency: 'EUR' });

    expect(res.status).toBe(200);
    // Exactly the two EUR listings under 1,200 — named, not counted.
    expect(idsOf(res.body)).toEqual([euroCheap, euroMid].sort());
    // £1,100 ≈ €1,290: it passed `<= 1200` as a bare number, and it is dearer
    // than the maximum this search set. That was the bug.
    expect(idsOf(res.body)).not.toContain(poundDear);
    // 1,000 zł ≈ €230: cheaper than the bound, and still out, because there is
    // no rate to say so with. Disclosed by the histogram, not silently dropped.
    expect(idsOf(res.body)).not.toContain(zlotyCheap);
    expect(idsOf(res.body)).not.toContain(euroDear);
  });

  it('answers a different question when the caller names PLN instead', async () => {
    const res = await request(buildApp())
      .get('/properties/search')
      .query({ city, offering: OfferingType.LONG_TERM_RENT, priceMax: '1050', priceCurrency: 'PLN' });

    expect(res.status).toBe(200);
    // Every EUR listing is out — including the 900, which is under 1,050 by
    // number. "Under 1,050 złoty" is not a question about euros.
    expect(idsOf(res.body)).toEqual([zlotyCheap]);
    expect(res.body.priceCurrency).toBe('PLN');
  });

  it('resolves the scope\'s own currency when the caller names none', async () => {
    const res = await request(buildApp())
      .get('/properties/search')
      .query({ city, offering: OfferingType.LONG_TERM_RENT, priceMax: '1200' });

    expect(res.status).toBe(200);
    // Nobody said which currency, so the homes in scope did: EUR, three rows to
    // one each. The bound is applied in it and the answer SAYS so.
    expect(res.body.priceCurrency).toBe('EUR');
    expect(idsOf(res.body)).toEqual([euroCheap, euroMid].sort());
  });

  it('censuses the SCOPE, not the catalogue', async () => {
    // A second city, overwhelmingly PLN. If the census ran before the place
    // filter — or over the whole table — this city's dominant currency would
    // be decided by the other one's rows.
    const other = await seedGeoChain({
      cityName: 'Gdańsk',
      regionName: 'Pomerania',
      // A country row per chain, so a DISTINCT code — `countries.code` is
      // unique and the fixture inserts one every time.
      countryCode: 'P2',
      countryName: 'Poland (second chain)',
    });
    const zlotyLocal: string[] = [];
    for (const amount of [1000, 1100, 1200, 1300, 1400, 1500]) {
      zlotyLocal.push(
        await seedProperty({
          addressId: await seedAddress({ chain: other }),
          overrides: {
            status: PropertyStatus.PUBLISHED,
            type: PropertyType.APARTMENT,
            availabilityIsAvailable: true,
            offerings: [OfferingType.LONG_TERM_RENT],
            longTermRentMonthlyAmount: amount,
            longTermRentCurrency: 'PLN',
          },
        }),
      );
    }

    const here = await request(buildApp())
      .get('/properties/search')
      .query({ city, offering: OfferingType.LONG_TERM_RENT, priceMax: '1200' });
    expect(here.body.priceCurrency).toBe('EUR');

    const there = await request(buildApp())
      .get('/properties/search')
      .query({ city: other.cityId, offering: OfferingType.LONG_TERM_RENT, priceMax: '1200' });
    expect(there.body.priceCurrency).toBe('PLN');
    expect(idsOf(there.body).length).toBe(3);
    expect(idsOf(there.body).every((id) => zlotyLocal.includes(id))).toBe(true);
  });

  it('excludes a priced listing whose currency nobody recorded', async () => {
    const unlabelled = await seedProperty({
      addressId: await seedAddress({
        chain: await seedGeoChain({
          cityName: 'Kraków',
          regionName: 'Lesser Poland',
          countryCode: 'P3',
          countryName: 'Poland (third chain)',
        }),
      }),
      overrides: {
        status: PropertyStatus.PUBLISHED,
        type: PropertyType.APARTMENT,
        availabilityIsAvailable: true,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 500,
        longTermRentCurrency: null,
      },
    });

    const res = await request(buildApp())
      .get('/properties/search')
      .query({ offering: OfferingType.LONG_TERM_RENT, priceMax: '1200', priceCurrency: 'EUR' });

    // 500 of something. "Unknown" is not an answer to "under 1,200 euros", the
    // same rule an area stored as `0` gets from `areaInRange`.
    expect(idsOf(res.body)).not.toContain(unlabelled);
  });

  it('reports no currency and filters nothing extra when no bound was sent', async () => {
    const res = await request(buildApp())
      .get('/properties/search')
      .query({ city, offering: OfferingType.LONG_TERM_RENT, priceCurrency: 'EUR' });

    expect(res.status).toBe(200);
    // A currency with no bound is not a filter. Every listing is still here,
    // including the GBP and PLN ones — narrowing on a stale param would drop a
    // whole market with nothing on screen to explain it.
    expect(idsOf(res.body)).toHaveLength(5);
    expect(res.body.priceCurrency).toBeUndefined();
  });

  it('matches nothing, rather than everything, where no price names a currency', async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({
      cityName: 'Tromsø',
      regionName: 'Troms',
      countryCode: 'NO',
      countryName: 'Norway',
    });
    await seedProperty({
      addressId: await seedAddress({ chain }),
      overrides: {
        status: PropertyStatus.PUBLISHED,
        type: PropertyType.APARTMENT,
        availabilityIsAvailable: true,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 800,
        longTermRentCurrency: null,
      },
    });

    const res = await request(buildApp())
      .get('/properties/search')
      .query({ city: chain.cityId, offering: OfferingType.LONG_TERM_RENT, priceMax: '1200' });

    expect(res.status).toBe(200);
    // The honest answer to "homes under 1,200 here" where no price has a unit
    // is none — NOT the unfiltered feed, which is what dropping the bound would
    // have shown.
    expect(res.body.data).toHaveLength(0);
    expect(res.body.priceCurrency).toBeUndefined();
  });
});

describe('the bars and the thumbs describe the same homes', () => {
  let city: string;

  beforeEach(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({
      cityName: 'Bucharest',
      regionName: 'Bucharest',
      countryCode: 'RO',
      countryName: 'Romania',
    });
    city = chain.cityId;
    // Romania is the case that rules out any country → currency table: both
    // codes are real there, and `LISTING_CURRENCIES` says so in its own header.
    const seedRent = async (amount: number, currency: ListingCurrency): Promise<string> =>
      seedProperty({
        addressId: await seedAddress({ chain }),
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.APARTMENT,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: amount,
          longTermRentCurrency: currency,
        },
      });
    await seedRent(3000, 'RON');
    await seedRent(4000, 'RON');
    await seedRent(5000, 'RON');
    await seedRent(700, 'EUR');
  });

  it('the histogram and the filter pick the same currency for one scope', async () => {
    const app = buildApp();
    const histogram = await request(app)
      .get('/properties/search/price-histogram')
      .query({ city, offering: OfferingType.LONG_TERM_RENT });
    expect(histogram.status).toBe(200);
    expect(histogram.body.priceHistogram.currency).toBe('RON');
    expect(histogram.body.priceHistogram.otherCurrencyCount).toBe(1);

    const search = await request(app)
      .get('/properties/search')
      .query({ city, offering: OfferingType.LONG_TERM_RENT, priceMax: '3500' });
    // Same scope, same census, same answer — one definition, in
    // `db/properties/priceCurrency.ts`.
    expect(search.body.priceCurrency).toBe('RON');
    expect(search.body.data).toHaveLength(1);
  });

  it('rejects a currency the column cannot hold instead of answering an empty area', async () => {
    const res = await request(buildApp())
      .get('/properties/search/price-histogram')
      .query({ city, currency: 'XYZ' });

    // The old `^[A-Z]{3}$` shape check accepted this and answered
    // `priceHistogram: null`, which a screen renders as "no prices here".
    expect(res.status).toBe(400);
  });

  it('accepts FAIR, which the old three-letter shape check rejected', async () => {
    const res = await request(buildApp())
      .get('/properties/search/price-histogram')
      .query({ city, currency: 'FAIR' });

    // No FairCoin listing in scope, so the distribution is legitimately null —
    // but the REQUEST is valid, and it used to be a 400.
    expect(res.status).toBe(200);
    expect(res.body.priceHistogram).toBeNull();
  });
});

describe('the browse feed applies the same rule', () => {
  it('does not return a cheaper number in another currency', async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({
      cityName: 'Lisbon',
      regionName: 'Lisbon',
      countryCode: 'PT',
      countryName: 'Portugal',
    });
    const seedRent = async (amount: number, currency: ListingCurrency): Promise<string> =>
      seedProperty({
        addressId: await seedAddress({ chain }),
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.APARTMENT,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: amount,
          longTermRentCurrency: currency,
        },
      });
    const euro = await seedRent(800, 'EUR');
    await seedRent(1400, 'EUR');
    const brl = await seedRent(900, 'BRL');

    const res = await request(buildApp())
      .get('/properties')
      .query({ offering: OfferingType.LONG_TERM_RENT, maxRent: '1000' });

    expect(res.status).toBe(200);
    expect(res.body.priceCurrency).toBe('EUR');
    expect(idsOf(res.body)).toContain(euro);
    expect(idsOf(res.body)).not.toContain(brl);
  });
});
