/**
 * The stay calendar a signed-out visitor sees (#518 §7.5). REAL routers, REAL
 * Postgres.
 *
 * ## Two failures, in opposite directions
 *
 * `GET /api/properties/:id/availability` sat on the authenticated router, so a
 * visitor without a session got a 401 — and
 * `packages/frontend/services/reservationService.ts` turned that into
 * `{ windows: [], booked: [] }`, which the calendar renders as a home with
 * every single night free. Nothing looked broken. The most confident wrong
 * answer a booking surface can give.
 *
 * Moving a route out from behind auth is the other failure waiting to happen:
 * whatever it returns is now returned to the anonymous internet. So this file
 * asserts BOTH halves, and the second is the one that must not rot —
 *
 *  - the route answers WITHOUT a session and reports the real blocked dates;
 *  - the body contains no guest, no host, no reservation id, no price, no
 *    message and no exchange counterparty. The assertion walks the whole
 *    response for those VALUES rather than checking a field list, so a field
 *    added later under any name still fails it.
 */

import express, { type Express } from 'express';
import request from 'supertest';

import apiRoutes from '../../routes';
import publicRoutes from '../../routes/public';
import { getDb } from '../../db/postgres';
import {
  exchangeRequests,
  propertyAvailabilityWindows,
  reservations,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const HOST = 'oxy-host-private';
const GUEST = 'oxy-guest-private';
const SWAPPER = 'oxy-swapper-private';

/** The public API, with NO session middleware anywhere in the stack. */
function buildPublicApi(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

/** The authenticated API, to prove the route is no longer ALSO declared there. */
function buildAuthedApi(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: GUEST };
    authed.userId = GUEST;
    next();
  });
  app.use('/api', apiRoutes());
  app.use(errorHandler);
  return app;
}

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

const DAY = 24 * 60 * 60 * 1000;
const BASE = Date.now();
const SECRET_MESSAGE = 'please do not publish this';

/** A home with a paid stay, a swap, a blocked window and an open one on it. */
async function seedFullCalendar(): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId: HOST,
      status: 'published',
      isExternal: false,
      offerings: ['short_term_rent', 'exchange'],
      shortTermRentNightlyRate: 137,
      shortTermRentCurrency: 'EUR',
      shortTermRentCleaningFee: 41,
      exchangeMode: 'both',
      maxGuests: 3,
      cancellationPolicy: 'moderate',
    },
  });

  await getDb().insert(reservations).values({
    propertyId,
    guestOxyUserId: GUEST,
    hostOxyUserId: HOST,
    checkIn: new Date(BASE + 10 * DAY),
    checkOut: new Date(BASE + 15 * DAY),
    guestCount: 2,
    nights: 5,
    nightlyRate: 137,
    subtotal: 685,
    cleaningFee: 41,
    total: 726,
    currency: 'EUR',
    cancellationPolicy: 'moderate',
    status: 'confirmed',
    specialRequests: SECRET_MESSAGE,
  });

  await getDb().insert(exchangeRequests).values({
    propertyId,
    requesterOxyUserId: SWAPPER,
    hostOxyUserId: HOST,
    mode: 'host',
    requestedWindowStart: new Date(BASE + 20 * DAY),
    requestedWindowEnd: new Date(BASE + 25 * DAY),
    message: SECRET_MESSAGE,
    status: 'confirmed',
  });

  await getDb().insert(propertyAvailabilityWindows).values([
    {
      propertyId,
      scope: 'listing',
      startsAt: new Date(BASE + 40 * DAY),
      endsAt: new Date(BASE + 45 * DAY),
      status: 'blocked',
    },
    {
      propertyId,
      scope: 'exchange',
      startsAt: new Date(BASE + 50 * DAY),
      endsAt: new Date(BASE + 55 * DAY),
      status: 'blocked',
    },
  ]);

  return propertyId;
}

/** Every primitive in the response, flattened — keys and values alike. */
function flatten(value: unknown, out: string[] = []): string[] {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((entry) => flatten(entry, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out.push(key);
      flatten(entry, out);
    }
    return out;
  }
  out.push(String(value));
  return out;
}

beforeEach(async () => {
  await getDb().delete(exchangeRequests);
  await getDb().delete(reservations);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(exchangeRequests);
  await getDb().delete(reservations);
  await resetGeoTables();
});

describe('the availability projection is PUBLIC', () => {
  it('answers a visitor with no session at all', async () => {
    const propertyId = await seedFullCalendar();
    const res = await request(buildPublicApi()).get(`/api/properties/${propertyId}/availability`);

    expect(res.status).toBe(200);
    expect(res.body.data.propertyId).toBe(propertyId);
    expect(res.body.data.maxGuests).toBe(3);
  });

  it('reports the blocked nights instead of an empty calendar', async () => {
    const propertyId = await seedFullCalendar();
    const res = await request(buildPublicApi()).get(`/api/properties/${propertyId}/availability`);

    const starts = (spans: { start: string }[]) =>
      spans.map((span) => new Date(span.start).getTime()).sort();

    // The paid stay AND the confirmed swap — a home committed to a swap is as
    // unavailable as one committed to a booking, and the calendar used to show
    // the swap's nights as free.
    expect(starts(res.body.data.booked)).toEqual(
      [BASE + 10 * DAY, BASE + 20 * DAY].sort(),
    );
    // Both calendars' windows: the `exchange`-scope block is a fortnight
    // nobody sleeps there, whatever calendar the host was editing.
    expect(starts(res.body.data.windows)).toEqual(
      [BASE + 40 * DAY, BASE + 50 * DAY].sort(),
    );
  });

  it('is no longer served by the authenticated router', async () => {
    // Declared in exactly one place. Two mounts would mean two projections to
    // keep honest, and the authenticated one is the one nobody would re-read.
    const propertyId = await seedFullCalendar();
    const res = await request(buildAuthedApi()).get(`/api/properties/${propertyId}/availability`);
    expect(res.status).toBe(404);
  });
});

describe('what the projection must never carry', () => {
  it('publishes dates and statuses, and nothing that identifies anybody', async () => {
    const propertyId = await seedFullCalendar();
    const res = await request(buildPublicApi()).get(`/api/properties/${propertyId}/availability`);
    const body = JSON.stringify(res.body);

    for (const secret of [GUEST, SWAPPER, HOST, SECRET_MESSAGE]) {
      expect(body).not.toContain(secret);
    }

    // The reservation's own id and its money, by VALUE — a rename cannot hide
    // either from this.
    const [stay] = await getDb().select().from(reservations);
    expect(body).not.toContain(stay.id);
    const values = flatten(res.body);
    for (const amount of ['137', '685', '726', '41']) {
      expect(values).not.toContain(amount);
    }
    for (const field of ['guestOxyUserId', 'hostOxyUserId', 'specialRequests', 'total', 'nightlyRate']) {
      expect(values).not.toContain(field);
    }

    // And the shape it DOES carry: `{ start, end, status }`, nothing else.
    for (const span of [...res.body.data.windows, ...res.body.data.booked]) {
      expect(Object.keys(span).sort()).toEqual(['end', 'start', 'status']);
    }
  });
});
