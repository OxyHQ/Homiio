/**
 * Floor area and availability, against real rows (#518 §6, #519 §6.1).
 *
 * Both epics require the same shape of evidence for every filter: "Cada filtro
 * tiene fixtures que incluyen y excluyen viviendas distintas." A test that only
 * asserts the SQL mentions a column cannot tell a filter that narrows from one
 * that matches everything, and the unit suite next door already covers the
 * shape — so this one runs each filter against a trio where the answer is
 * different for every plausible implementation.
 *
 * The **unknown-size** row is the one that matters. `square_footage` is
 * `NOT NULL DEFAULT 0`, so a listing nobody measured is stored as `0`, and a
 * bare `<= 120` matches it. That is not a hypothetical: an ingested feed is
 * mostly rows like that, so "homes up to 120 m²" would return the catalogue
 * under a heading claiming otherwise — results that look like results.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

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
  app.use(errorHandler);
  return app;
}

const ids = (body: { data: Array<{ id: string }> }): string[] => body.data.map((row) => row.id);

/** A day, as the URL carries it. */
const civil = (date: Date): string => date.toISOString().slice(0, 10);

const DAY_MS = 24 * 60 * 60 * 1000;

describe('floor area', () => {
  let small: string;
  let large: string;
  let unknown: string;

  beforeEach(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({ cityName: 'Valencia', countryCode: 'ES-SZ' });
    const seedHome = async (squareFootage: number): Promise<string> =>
      seedProperty({
        addressId: await seedAddress({ chain }),
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.APARTMENT,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: 900,
          longTermRentCurrency: 'EUR',
          squareFootage,
        },
      });
    small = await seedHome(45);
    large = await seedHome(140);
    // Nobody filled the area in. Stored as 0, indistinguishable from a genuine
    // zero — which does not exist.
    unknown = await seedHome(0);
  });

  it('a minimum keeps the large home and drops the small one', async () => {
    const res = await request(buildApp()).get('/properties/search?sizeMin=100');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([large]);
  });

  it('a maximum keeps the small home and drops BOTH the large and the unmeasured one', async () => {
    // The assertion this file exists for. Without the `> 0` guard the
    // unmeasured row comes back too, and nothing about the response says so.
    const res = await request(buildApp()).get('/properties/search?sizeMax=120');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([small]);
  });

  it('a range keeps only what falls inside it', async () => {
    const res = await request(buildApp()).get('/properties/search?sizeMin=40&sizeMax=60');
    expect(ids(res.body)).toEqual([small]);
  });

  it('no bound returns all three, including the unmeasured one', async () => {
    // The floor under every assertion above: without it, a filter that returned
    // nothing at all would satisfy them.
    const res = await request(buildApp()).get('/properties/search');
    expect(ids(res.body).sort()).toEqual([small, large, unknown].sort());
  });

  it('narrows the price histogram by the same condition', async () => {
    // #519 §6.1: "Los histogramas y contadores salen de la consulta real con
    // las mismas condiciones." The histogram shares `buildSearchPlan`, so this
    // asserts that sharing rather than a reimplementation.
    const all = await request(buildApp()).get('/properties/search/price-histogram');
    const narrowed = await request(buildApp()).get(
      '/properties/search/price-histogram?sizeMin=100',
    );
    expect(all.status).toBe(200);
    expect(narrowed.status).toBe(200);
    // `count` is how many priced listings the histogram was built from. Three
    // homes are in scope; only the 140 m² one survives `sizeMin=100`.
    expect(all.body.priceHistogram.count).toBe(3);
    expect(narrowed.body.priceHistogram.count).toBe(1);
  });
});

describe('availability', () => {
  let readyNow: string;
  let readySoon: string;
  let readyLater: string;

  beforeEach(async () => {
    await resetGeoTables();
    const chain = await seedGeoChain({ cityName: 'Bilbao', countryCode: 'ES-AV' });
    const seedHome = async (availableFrom: Date): Promise<string> =>
      seedProperty({
        addressId: await seedAddress({ chain }),
        overrides: {
          status: PropertyStatus.PUBLISHED,
          type: PropertyType.APARTMENT,
          availabilityIsAvailable: true,
          offerings: [OfferingType.LONG_TERM_RENT],
          longTermRentMonthlyAmount: 900,
          longTermRentCurrency: 'EUR',
          availableFrom,
        },
      });
    readyNow = await seedHome(new Date(Date.now() - 30 * DAY_MS));
    readySoon = await seedHome(new Date(Date.now() + 10 * DAY_MS));
    readyLater = await seedHome(new Date(Date.now() + 200 * DAY_MS));
  });

  it('availableNow keeps only what is free today', async () => {
    const res = await request(buildApp()).get('/properties/search?availableNow=true');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([readyNow]);
  });

  it('a date keeps everything free by then', async () => {
    const by = civil(new Date(Date.now() + 30 * DAY_MS));
    const res = await request(buildApp()).get(`/properties/search?availableBy=${by}`);
    expect(ids(res.body).sort()).toEqual([readyNow, readySoon].sort());
  });

  it('availableNow wins when both arrive, instead of contradicting itself', async () => {
    // Bloom's `AvailabilityFilter` disables the picker while the switch is on
    // and keeps the chosen day, so a client legitimately sends both.
    const by = civil(new Date(Date.now() + 200 * DAY_MS));
    const res = await request(buildApp()).get(
      `/properties/search?availableNow=true&availableBy=${by}`,
    );
    expect(ids(res.body)).toEqual([readyNow]);
  });

  it('no availability filter returns all three', async () => {
    const res = await request(buildApp()).get('/properties/search');
    expect(ids(res.body).sort()).toEqual([readyNow, readySoon, readyLater].sort());
  });

  it('an unparseable date widens rather than 400ing a shared link', async () => {
    const res = await request(buildApp()).get('/properties/search?availableBy=soon');
    expect(res.status).toBe(200);
    expect(ids(res.body)).toHaveLength(3);
  });
});
