/**
 * A dated SEARCH stops advertising homes the booking path would refuse
 * (#518 §7.5, #519 §7.5).
 *
 * ## The gap
 *
 * `GET /api/properties` has filtered a dated feed since the Postgres port.
 * `GET /api/properties/search` — the one the stays UI actually calls, with
 * `checkIn`/`checkOut` among its own params — had no date filter at all. So
 * search and the booking path disagreed: a person picked a home the reservation
 * flow then refused, and the refusal arrived after they had chosen.
 *
 * ## Three ways a home is taken, and each gets a case
 *
 * The host's own calendar, a confirmed reservation, and a confirmed exchange.
 * Leaving any one out advertises a home the transaction would decline, and the
 * exchange half is the one that was missing everywhere until recently — so each
 * is seeded separately and named, rather than counted.
 *
 * The free listing in every case is the control: a filter that returned nothing
 * would pass an assertion that only checked the booked one was absent.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { ExchangeMode, OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { searchProperties } from '../../controllers/property/search';
import { getDb } from '../../db/postgres';
import {
  exchangeRequests,
  leases,
  propertyAvailabilityWindows,
  reservations,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { objectIdHex, resetGeoTables, seedAddress, seedGeoChain, seedProperty } from '../helpers/postgresGeoFixtures';

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

/** The stay everybody is asking about. */
const CHECK_IN = '2026-07-10T00:00:00.000Z';
const CHECK_OUT = '2026-07-14T00:00:00.000Z';

let city: string;
let free: string;
let reserved: string;
let blocked: string;
let swapped: string;
let counter = 0;

beforeEach(async () => {
  await getDb().delete(exchangeRequests);
  await getDb().delete(leases);
  await resetGeoTables();

  counter += 1;
  const chain = await seedGeoChain({
    cityName: `Stayton ${counter}`,
    regionName: 'Stay Region',
    countryCode: `S${counter}`,
    countryName: `Stayland ${counter}`,
  });
  city = chain.cityId;

  const seedStay = async (): Promise<string> =>
    seedProperty({
      addressId: await seedAddress({ chain }),
      overrides: {
        status: PropertyStatus.PUBLISHED,
        type: PropertyType.APARTMENT,
        availabilityIsAvailable: true,
        offerings: [OfferingType.SHORT_TERM_RENT, OfferingType.EXCHANGE],
        shortTermRentNightlyRate: 90,
        shortTermRentCurrency: 'EUR',
        exchangeMode: ExchangeMode.SWAP,
        maxGuests: 4,
      } as never,
    });

  free = await seedStay();
  reserved = await seedStay();
  blocked = await seedStay();
  swapped = await seedStay();

  await getDb().insert(reservations).values({
    id: objectIdHex(),
    propertyId: reserved,
    guestOxyUserId: 'oxy-guest',
    hostOxyUserId: 'oxy-host',
    checkIn: new Date('2026-07-11T00:00:00.000Z'),
    checkOut: new Date('2026-07-13T00:00:00.000Z'),
    guestCount: 2,
    nights: 2,
    nightlyRate: 90,
    subtotal: 180,
    total: 180,
    status: 'confirmed',
    cancellationPolicy: 'moderate',
  });

  await getDb().insert(propertyAvailabilityWindows).values({
    propertyId: blocked,
    scope: 'listing',
    startsAt: new Date('2026-07-09T00:00:00.000Z'),
    endsAt: new Date('2026-07-15T00:00:00.000Z'),
    status: 'blocked',
  });

  await getDb().insert(exchangeRequests).values({
    id: objectIdHex(),
    propertyId: swapped,
    requesterOxyUserId: 'oxy-requester',
    hostOxyUserId: 'oxy-host',
    mode: ExchangeMode.SWAP,
    requestedWindowStart: new Date('2026-07-12T00:00:00.000Z'),
    requestedWindowEnd: new Date('2026-07-16T00:00:00.000Z'),
    status: 'confirmed',
  });
});

afterEach(async () => {
  await getDb().delete(exchangeRequests);
  await getDb().delete(leases);
  await resetGeoTables();
});

const search = (query: Record<string, string>) =>
  request(buildApp()).get('/properties/search').query({ city, ...query });

describe('a dated search agrees with the booking path', () => {
  it('leaves out a home with a confirmed reservation over those nights', async () => {
    const res = await search({ checkIn: CHECK_IN, checkOut: CHECK_OUT });

    expect(res.status).toBe(200);
    expect(idsOf(res.body)).not.toContain(reserved);
  });

  it('leaves out a home the host blocked on their own calendar', async () => {
    const res = await search({ checkIn: CHECK_IN, checkOut: CHECK_OUT });

    expect(idsOf(res.body)).not.toContain(blocked);
  });

  it('leaves out a home committed to a confirmed swap', async () => {
    const res = await search({ checkIn: CHECK_IN, checkOut: CHECK_OUT });

    // The one that was missing from every surface until #539. A home promised
    // to a swap was advertised as free, and the booking path — which asks one
    // question across all three tables — would have refused it afterwards.
    expect(idsOf(res.body)).not.toContain(swapped);
  });

  it('still returns the one that is genuinely free', async () => {
    const res = await search({ checkIn: CHECK_IN, checkOut: CHECK_OUT });

    // The control. Without it, a filter that returned nothing at all would pass
    // all three cases above.
    expect(idsOf(res.body)).toEqual([free]);
  });
});

describe('what does not count as a question about dates', () => {
  it('narrows nothing when no dates were sent', async () => {
    const res = await search({});

    // Every home, including the three that are taken. A search that never
    // mentioned dates is not asking, and quietly applying the filter would drop
    // most of a catalogue for a reason nobody could see.
    expect(idsOf(res.body)).toHaveLength(4);
  });

  it('narrows nothing on a half-open range', async () => {
    // Somebody mid-edit in a date picker. Filtering on one bound would take a
    // guess at the other.
    expect(idsOf(await search({ checkIn: CHECK_IN }).then((r) => r.body))).toHaveLength(4);
    expect(idsOf(await search({ checkOut: CHECK_OUT }).then((r) => r.body))).toHaveLength(4);
  });

  it('narrows nothing on a reversed range', async () => {
    const res = await search({ checkIn: CHECK_OUT, checkOut: CHECK_IN });

    expect(idsOf(res.body)).toHaveLength(4);
  });

  it('keeps the boundary open at both ends', async () => {
    // A stay that ends exactly when another begins does not overlap it —
    // back-to-back bookings are the ordinary case, and a closed boundary would
    // lose a night on every listing.
    const res = await search({
      checkIn: '2026-07-13T00:00:00.000Z',
      checkOut: '2026-07-14T00:00:00.000Z',
    });

    // The reservation ends at the 13th, so it no longer conflicts.
    expect(idsOf(res.body)).toContain(reserved);
  });
});
