/**
 * "Ground floor" and "nobody said" are different answers (#518 §6, #519 §6.1).
 *
 * ## The bug the column carried
 *
 * `properties.floor` was `NOT NULL DEFAULT 0`. Every listing whose floor nobody
 * filled in was therefore recorded as being on the ground floor, so a filter
 * for a ground-floor flat matched almost the whole catalogue. Not a filter with
 * a rounding error in it — a filter that answers a different question, and
 * answers it confidently.
 *
 * Migration 0024 makes the column nullable and clears the defaulted zeros, so
 * `0` is now a real answer and the only one that means the ground floor.
 *
 * ## The rule that is easy to miss
 *
 * A floor a listing does not PUBLISH may not be filtered on either. The
 * serializer withholds `floor` below `exact` precision because the floor is
 * part of the address (ADR 0003) — and a filter with no matching rule hands the
 * same fact back through a different door: ask for the ground floor inside a
 * small enough area and the RESULT SET tells you the floor of a listing whose
 * payload refused to.
 *
 * So the discriminating fixture is not "a ground floor and a third floor". It
 * is four listings that are all genuinely on the ground floor and differ only
 * in what they publish, plus one that never said. A filter that ignored
 * publication would return all five; the honest answer is one.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { searchProperties } from '../../controllers/property/search';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { resetGeoTables, seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search', searchProperties);
  app.use(errorHandler);
  return app;
}

function idsOf(body: { data?: Array<{ id?: string }> }): string[] {
  return (body.data ?? []).map((row) => String(row.id)).sort();
}

let city: string;
/** Ground floor, and says so. The only listing a ground-floor filter may return. */
let groundPublished: string;
/** Ground floor, but publishes only the building. */
let groundWithheld: string;
/** Ground floor, `exact` — and the street number hidden, which caps it at `street`. */
let groundNumberHidden: string;
/** Third floor, published. */
let thirdPublished: string;
/** A basement: a floor somebody can be asked to live on, and a negative number. */
let basementPublished: string;
/** Nobody ever said. Under the old column this row WAS the ground floor. */
let floorUnstated: string;

beforeEach(async () => {
  await resetGeoTables();
  const chain = await seedGeoChain({
    cityName: 'Floorville',
    regionName: 'Floor Region',
    countryCode: 'FL',
    countryName: 'Floorland',
  });
  city = chain.cityId;

  const seed = async (overrides: Record<string, unknown>): Promise<string> =>
    seedProperty({
      addressId: await seedAddress({ chain }),
      overrides: {
        status: PropertyStatus.PUBLISHED,
        type: PropertyType.APARTMENT,
        availabilityIsAvailable: true,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 900,
        longTermRentCurrency: 'EUR',
        ...overrides,
      } as never,
    });

  groundPublished = await seed({ floor: 0, addressPublishedPrecision: 'exact', showAddressNumber: true });
  groundWithheld = await seed({ floor: 0, addressPublishedPrecision: 'building', showAddressNumber: true });
  groundNumberHidden = await seed({ floor: 0, addressPublishedPrecision: 'exact', showAddressNumber: false });
  thirdPublished = await seed({ floor: 3, addressPublishedPrecision: 'exact', showAddressNumber: true });
  basementPublished = await seed({ floor: -1, addressPublishedPrecision: 'exact', showAddressNumber: true });
  floorUnstated = await seed({ floor: null, addressPublishedPrecision: 'exact', showAddressNumber: true });
});

const search = (query: Record<string, string>) =>
  request(buildApp()).get('/properties/search').query({ city, ...query });

describe('a floor nobody stated is not a ground floor', () => {
  it('returns only the listing that is on the ground floor AND says so', async () => {
    const res = await search({ groundFloor: 'true' });

    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual([groundPublished]);
  });

  it('leaves out the listing whose floor nobody ever stated', async () => {
    const res = await search({ groundFloor: 'true' });

    // This is the whole defect. Under `NOT NULL DEFAULT 0` this row was stored
    // as floor 0 and came back as a ground-floor flat to anybody who asked.
    expect(idsOf(res.body)).not.toContain(floorUnstated);
  });

  it('leaves out a genuine ground floor that publishes only the building', async () => {
    const res = await search({ groundFloor: 'true' });

    // It really is on the ground floor. Returning it would tell the asker so,
    // which is exactly what its `address_published_precision` refuses to do.
    expect(idsOf(res.body)).not.toContain(groundWithheld);
  });

  it('leaves out one whose precision is `exact` but whose number is hidden', async () => {
    const res = await search({ groundFloor: 'true' });

    // `show_address_number = false` caps the public ceiling at `street`, which
    // is coarser than `exact`. A predicate that read only the precision column
    // would return this row and every case above would still pass.
    expect(idsOf(res.body)).not.toContain(groundNumberHidden);
  });
});

describe('the numeric range', () => {
  it('matches a floor above a minimum, and not one below it', async () => {
    const res = await search({ floorMin: '2' });

    expect(idsOf(res.body)).toEqual([thirdPublished]);
  });

  it('treats a basement as the floor it is', async () => {
    const res = await search({ floorMax: '-1' });

    // A negative floor is meaningful and was unrepresentable while the column
    // was a defaulted zero that everything else also was.
    expect(idsOf(res.body)).toEqual([basementPublished]);
  });

  it('spans a range across the ground floor', async () => {
    const res = await search({ floorMin: '-1', floorMax: '0' });

    expect(idsOf(res.body)).toEqual([basementPublished, groundPublished].sort());
  });
});

describe('the gate narrows nothing when nobody asked about the floor', () => {
  it('returns every listing, including the ones that withhold theirs', async () => {
    const res = await search({});

    // The floor rule must not leak into searches that never mentioned it: a
    // version that applied the publication predicate unconditionally would
    // quietly drop most of the catalogue, and every case above would pass.
    expect(idsOf(res.body)).toHaveLength(6);
    expect(idsOf(res.body)).toContain(groundWithheld);
    expect(idsOf(res.body)).toContain(floorUnstated);
  });
});

describe('what the payload says, the filter agrees with', () => {
  it('serializes no floor for a listing that publishes none', async () => {
    const res = await search({});
    const rows = (res.body.data ?? []) as Array<Record<string, unknown>>;

    const withheld = rows.find((row) => row.id === groundWithheld);
    // ABSENT, not null: the shared contract says so, and a `null` would tell a
    // reader the owner published a floor they do not have.
    expect(withheld).not.toHaveProperty('floor');

    const unstated = rows.find((row) => row.id === floorUnstated);
    // Publishes `exact`, but there is nothing to publish.
    expect(unstated).not.toHaveProperty('floor');

    const published = rows.find((row) => row.id === groundPublished);
    expect(published?.floor).toBe(0);
  });
});
