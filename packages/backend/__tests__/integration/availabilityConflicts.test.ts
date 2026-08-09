/**
 * Date-range availability on the browse feed, against a REAL Postgres.
 *
 * ## Why this suite exists
 *
 * The reservation half of the availability check read Mongo into an id list and
 * applied it only `if (ids.length > 0)`. Once `reservations` moved to Postgres
 * that read returned nothing, the guard skipped the exclusion, and every booked
 * listing was reported free.
 *
 * Nothing errored. An availability check with no bookings in front of it
 * APPROVES — so the wrong answer was the successful-looking one, and the
 * symptom would have been a double booking rather than a failure anyone could
 * see. That is exactly the shape a presence assertion cannot catch, so every
 * case below asserts on WHICH listings come back, and each seeds a listing that
 * must be EXCLUDED alongside one that must not. A test that only checked "some
 * results came back" would have passed against the bug.
 *
 * The boundary cases are the point of the `[)` range bounds: a stay that starts
 * exactly when another ends does not conflict, and one that overlaps by a single
 * day does.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getProperties } from '../../controllers/property/list';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { getDb } from '../../db/postgres';
import { reservations } from '../../db/schema';
import {
  objectIdHex,
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties', getProperties);
  app.use(errorHandler);
  return app;
}

const STAY_START = '2026-09-10';
const STAY_END = '2026-09-14';

/** A published, short-term-bookable listing. */
async function seedBookable(chain: GeoChain, street: string): Promise<string> {
  const addressId = await seedAddress({ chain, street });
  return seedProperty({
    addressId,
    idShape: 'generated',
    overrides: {
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      offerings: [OfferingType.SHORT_TERM_RENT],
      shortTermRentNightlyRate: 120,
      shortTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
      availabilityIsAvailable: true,
    },
  });
}

async function seedReservation(options: {
  propertyId: string;
  checkIn: string;
  checkOut: string;
  status?: 'confirmed' | 'pending' | 'cancelled';
}): Promise<void> {
  await getDb()
    .insert(reservations)
    .values({
      id: objectIdHex(),
      propertyId: options.propertyId,
      guestOxyUserId: 'oxy-guest',
      hostOxyUserId: 'oxy-host',
      checkIn: new Date(options.checkIn),
      checkOut: new Date(options.checkOut),
      guestCount: 2,
      nights: 4,
      nightlyRate: 120,
      subtotal: 480,
      total: 480,
      currency: 'EUR',
      cancellationPolicy: 'flexible',
      status: options.status ?? 'confirmed',
    });
}

/** The listing ids the feed returns for the stay under test. */
async function idsAvailableForStay(): Promise<string[]> {
  const res = await request(buildApp())
    .get(`/properties?checkIn=${STAY_START}&checkOut=${STAY_END}&limit=50`)
    .expect(200);
  return (res.body.data as { id: string }[]).map((listing) => listing.id);
}

beforeEach(async () => {
  await resetGeoTables();
});

describe('date-range availability', () => {
  it('excludes a listing whose confirmed reservation overlaps the stay', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-av' });
    const booked = await seedBookable(chain, 'Carrer Booked');
    const free = await seedBookable(chain, 'Carrer Free');
    await seedReservation({ propertyId: booked, checkIn: '2026-09-12', checkOut: '2026-09-16' });

    const available = await idsAvailableForStay();

    // Both halves asserted: without the FREE listing this would also pass if the
    // endpoint simply returned nothing.
    expect(available).toContain(free);
    expect(available).not.toContain(booked);
  });

  it('excludes a listing booked for exactly the requested range', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-aw' });
    const booked = await seedBookable(chain, 'Carrer Exact');
    const free = await seedBookable(chain, 'Carrer Open');
    await seedReservation({ propertyId: booked, checkIn: STAY_START, checkOut: STAY_END });

    const available = await idsAvailableForStay();

    expect(available).toContain(free);
    expect(available).not.toContain(booked);
  });

  it('keeps a listing whose reservation ENDS the day the stay begins', async () => {
    // `[)` bounds: a checkout and the next check-in on the same day do not
    // collide. This is the case an inclusive range would get wrong, and it is
    // why the predicate uses `tstzrange` rather than two `<=` comparisons.
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-ax' });
    const backToBack = await seedBookable(chain, 'Carrer Adjacent');
    await seedReservation({ propertyId: backToBack, checkIn: '2026-09-06', checkOut: STAY_START });

    expect(await idsAvailableForStay()).toContain(backToBack);
  });

  it('keeps a listing whose reservation BEGINS the day the stay ends', async () => {
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-ay' });
    const backToBack = await seedBookable(chain, 'Carrer Following');
    await seedReservation({ propertyId: backToBack, checkIn: STAY_END, checkOut: '2026-09-20' });

    expect(await idsAvailableForStay()).toContain(backToBack);
  });

  it('ignores reservations that are not confirmed', async () => {
    // A pending or cancelled booking holds no dates. Seeded as an overlapping
    // range on purpose, so the status is the ONLY thing keeping the listing in
    // the results — a predicate that ignored `status` would fail here.
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-az' });
    const pending = await seedBookable(chain, 'Carrer Pending');
    const cancelled = await seedBookable(chain, 'Carrer Cancelled');
    await seedReservation({
      propertyId: pending,
      checkIn: '2026-09-12',
      checkOut: '2026-09-16',
      status: 'pending',
    });
    await seedReservation({
      propertyId: cancelled,
      checkIn: '2026-09-12',
      checkOut: '2026-09-16',
      status: 'cancelled',
    });

    const available = await idsAvailableForStay();

    expect(available).toContain(pending);
    expect(available).toContain(cancelled);
  });

  it('excludes only the booked listing, not every listing at the same address', async () => {
    // The correlated subquery has to bind to the OUTER listing. If the
    // correlation bound to the reservations table instead — the failure mode the
    // `qualified()` helper exists to prevent — the predicate would match every
    // row and exclude the whole catalogue, which this case detects.
    const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-ba' });
    const addressId = await seedAddress({ chain, street: 'Carrer Shared' });
    const booked = await seedProperty({
      addressId,
      idShape: 'generated',
      overrides: {
        type: PropertyType.APARTMENT,
        offerings: [OfferingType.SHORT_TERM_RENT],
        shortTermRentNightlyRate: 120,
        status: PropertyStatus.PUBLISHED,
        availabilityIsAvailable: true,
      },
    });
    const sibling = await seedProperty({
      addressId,
      idShape: 'generated',
      overrides: {
        type: PropertyType.APARTMENT,
        offerings: [OfferingType.SHORT_TERM_RENT],
        shortTermRentNightlyRate: 130,
        status: PropertyStatus.PUBLISHED,
        availabilityIsAvailable: true,
      },
    });
    await seedReservation({ propertyId: booked, checkIn: '2026-09-11', checkOut: '2026-09-13' });

    const available = await idsAvailableForStay();

    expect(available).toContain(sibling);
    expect(available).not.toContain(booked);
  });
});
