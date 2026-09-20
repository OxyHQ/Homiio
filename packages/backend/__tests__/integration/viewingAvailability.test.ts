/**
 * Real viewing slots, end to end (#518 §7.5, #519 §7.5). Against the REAL
 * Postgres and the REAL routers.
 *
 * `book-viewing.tsx` offered thirteen hardcoded half-hour labels and an owner
 * had no way to say when they could show the place. This file drives the whole
 * replacement: the owner publishes a weekly schedule and a zone, a visitor
 * reads the slots it produces without signing in, and a request is accepted
 * only if it IS one of them.
 *
 * ## Why the routers are mounted rather than the handlers
 *
 * The same reason `viewingRoutes.test.ts` exists: this domain has already
 * shipped a controller that nothing mounted, answering 404 in production for
 * months while every handler test passed. The public half and the authenticated
 * half are decided by which ROUTER a handler sits on, and that is precisely the
 * thing a handler test cannot see — so both routers are mounted here the way
 * `server.ts` mounts them, and the public app has no session middleware at all.
 *
 * ## The concurrency case holds a transaction open, and it is the mutation target
 *
 * Two supertest requests in a `Promise.all` do not reliably interleave — see
 * the header of `bookingConcurrency.test.ts`. The case at the bottom forces the
 * interleaving with a held-open transaction, and it overlaps by FIFTEEN
 * MINUTES rather than landing on the same instant, which is exactly what the
 * old `scheduled_at = scheduled_at` rule could not see.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import apiRoutes from '../../routes';
import publicRoutes from '../../routes/public';
import { getDb } from '../../db/postgres';
import { cities, properties, propertyViewingWindows, viewingRequests } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const OWNER = 'oxy-owner';
const VISITOR = 'oxy-visitor';
const MADRID = 'Europe/Madrid';

/** The authenticated half, mounted the way `server.ts` mounts it. */
function buildApi(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.use('/api', apiRoutes());
  app.use(errorHandler);
  return app;
}

/**
 * The PUBLIC half, with NO session middleware whatsoever.
 *
 * A signed-in app would hide the thing this asserts: that the slot list is
 * reachable by somebody who has not signed in. If a handler ever starts reading
 * `req.user` here it gets `undefined`, which is the condition `AGENTS.md` sets
 * for this router.
 */
function buildPublicApi(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

async function seedListing(
  overrides: Record<string, unknown> = {},
): Promise<{ propertyId: string; cityId: string }> {
  const { propertyId, chain } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: { oxyUserId: OWNER, status: 'published', isExternal: false, ...overrides },
  });
  return { propertyId, cityId: chain.cityId };
}

/** A weekly schedule an owner might publish: Tuesday and Thursday evenings. */
const EVENINGS = [
  { weekday: 2, startMinute: 17 * 60, endMinute: 19 * 60, slotMinutes: 30, modality: 'in_person' },
  { weekday: 4, startMinute: 17 * 60, endMinute: 18 * 60, slotMinutes: 60, modality: 'video' },
];

async function publishSchedule(
  propertyId: string,
  windows: unknown[] = EVENINGS,
  timeZone: string | null = MADRID,
  as = OWNER,
): Promise<request.Response> {
  return request(buildApi(as))
    .put(`/api/properties/${propertyId}/viewing-windows`)
    .send({ windows, timeZone });
}

async function availability(propertyId: string, days?: number): Promise<request.Response> {
  const path = `/api/properties/${propertyId}/viewing-availability`;
  return request(buildPublicApi()).get(days === undefined ? path : `${path}?days=${days}`);
}

async function windowRows(propertyId: string) {
  return getDb()
    .select()
    .from(propertyViewingWindows)
    .where(eq(propertyViewingWindows.propertyId, propertyId));
}

beforeEach(async () => {
  await getDb().delete(viewingRequests);
  await getDb().delete(propertyViewingWindows);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(viewingRequests);
  await getDb().delete(propertyViewingWindows);
  await resetGeoTables();
});

describe('the owner publishes a schedule', () => {
  it('stores the windows and the zone, and reads them back', async () => {
    const { propertyId } = await seedListing();

    const put = await publishSchedule(propertyId);
    expect(put.status).toBe(200);
    expect(put.body.data.timeZone).toBe(MADRID);
    expect(put.body.data.timeZoneSource).toBe('property');
    expect(put.body.data.windows).toHaveLength(2);

    // Persisted, not merely answered.
    expect(await windowRows(propertyId)).toHaveLength(2);

    const get = await request(buildApi(OWNER)).get(
      `/api/properties/${propertyId}/viewing-windows`,
    );
    expect(get.status).toBe(200);
    expect(get.body.data.windows.map((w: { weekday: number }) => w.weekday)).toEqual([2, 4]);
  });

  it('REPLACES the schedule rather than appending to it', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);

    const replaced = await publishSchedule(propertyId, [
      { weekday: 6, startMinute: 600, endMinute: 720, slotMinutes: 30, modality: 'in_person' },
    ]);
    expect(replaced.status).toBe(200);

    const rows = await windowRows(propertyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].weekday).toBe(6);
  });

  it('accepts an EMPTY schedule, which is how an owner withdraws their times', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    expect((await publishSchedule(propertyId, [])).status).toBe(200);
    expect(await windowRows(propertyId)).toHaveLength(0);

    const slots = await availability(propertyId);
    expect(slots.body.data.published).toBe(false);
    expect(slots.body.data.slots).toEqual([]);
  });

  it('answers 404 to somebody else, and the table is UNCHANGED', async () => {
    // Ownership is the repository's predicate, so a stranger's listing is
    // indistinguishable from one that does not exist — 404, never 403, or the
    // endpoint becomes a way to enumerate which listings are real.
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);

    const stranger = await publishSchedule(propertyId, [], MADRID, 'oxy-stranger');
    expect(stranger.status).toBe(404);

    // Re-read the table. A refusal that answered 404 and wrote anyway would
    // pass every assertion about the response.
    expect(await windowRows(propertyId)).toHaveLength(2);

    const read = await request(buildApi('oxy-stranger')).get(
      `/api/properties/${propertyId}/viewing-windows`,
    );
    expect(read.status).toBe(404);
  });

  it('refuses a window that is shorter than its own slot, naming which one', async () => {
    const { propertyId } = await seedListing();
    const res = await publishSchedule(propertyId, [
      { weekday: 2, startMinute: 600, endMinute: 660, slotMinutes: 30, modality: 'in_person' },
      { weekday: 3, startMinute: 600, endMinute: 620, slotMinutes: 60, modality: 'in_person' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VIEWING_WINDOW');
    expect(res.body.error.message).toContain('Window 1');
    // Nothing partially applied: the good window did not land either.
    expect(await windowRows(propertyId)).toHaveLength(0);
  });

  it('refuses an unknown time zone rather than storing it', async () => {
    const { propertyId } = await seedListing();
    const res = await publishSchedule(propertyId, EVENINGS, 'Mars/Olympus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TIMEZONE');
    expect(await windowRows(propertyId)).toHaveLength(0);
  });

  it('refuses an unknown modality', async () => {
    const { propertyId } = await seedListing();
    const res = await publishSchedule(propertyId, [
      { weekday: 2, startMinute: 600, endMinute: 660, slotMinutes: 30, modality: 'in_the_metaverse' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_VIEWING_WINDOW');
  });
});

describe('which clock a viewing time is in', () => {
  it('uses the owner-stated zone in preference to the city', async () => {
    const { propertyId, cityId } = await seedListing();
    await getDb().update(cities).set({ timezone: 'America/New_York' }).where(eq(cities.id, cityId));
    await publishSchedule(propertyId, EVENINGS, MADRID);

    const res = await availability(propertyId);
    expect(res.body.data.timeZone).toBe(MADRID);
    expect(res.body.data.timeZoneSource).toBe('property');
  });

  it('falls back to the city zone WHERE IT IS SET', async () => {
    // `cities.timezone` is real where it is set and almost never set: the path
    // that creates a city during ordinary address resolution
    // (`addressService#upsertCity`) does not write it, and only `seedGeo`'s six
    // hand-written Spanish cities and an explicit admin create do. So it earns
    // a fallback and could not be the basis.
    const { propertyId, cityId } = await seedListing();
    await getDb().update(cities).set({ timezone: MADRID }).where(eq(cities.id, cityId));

    const res = await availability(propertyId);
    expect(res.body.data.timeZone).toBe(MADRID);
    expect(res.body.data.timeZoneSource).toBe('city');
  });

  it('says so when nobody has told it, rather than picking the server clock', async () => {
    const { propertyId } = await seedListing();
    const res = await availability(propertyId);
    expect(res.body.data.timeZone).toBe('UTC');
    // The honest half: a client can SEE that this is a convention and not a
    // fact about the home, and say so.
    expect(res.body.data.timeZoneSource).toBe('fallback');
  });

  it('ignores a stored zone the engine does not recognise', async () => {
    // Written by hand, or by a build that predates the validation. It must not
    // make every slot query throw.
    const { propertyId } = await seedListing();
    await getDb()
      .update(properties)
      .set({ viewingTimezone: 'Mars/Olympus' })
      .where(eq(properties.id, propertyId));

    const res = await availability(propertyId);
    expect(res.status).toBe(200);
    expect(res.body.data.timeZone).toBe('UTC');
  });
});

describe('the public slot list', () => {
  it('is reachable with NO session at all', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);

    const res = await availability(propertyId, 14);
    expect(res.status).toBe(200);
    expect(res.body.data.published).toBe(true);
    expect(res.body.data.slots.length).toBeGreaterThan(0);
  });

  it('publishes NOTHING when the owner has published nothing', async () => {
    // The whole point. An empty schedule yields an empty list, so the screen
    // says the owner has not published times rather than inventing thirteen.
    const { propertyId } = await seedListing();
    const res = await availability(propertyId);
    expect(res.status).toBe(200);
    expect(res.body.data.published).toBe(false);
    expect(res.body.data.slots).toEqual([]);
    expect(res.body.data.windows).toEqual([]);
  });

  it('carries no requester, no owner and no viewing id', async () => {
    // Asserted on the serialized body rather than on a field list, so a new
    // column added to the response cannot smuggle one of these through.
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const slot = (await availability(propertyId)).body.data.slots[0];
    await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: slot.date, time: slot.time, modality: slot.modality, message: 'secret note' });

    const body = JSON.stringify((await availability(propertyId)).body);
    expect(body).not.toContain(VISITOR);
    expect(body).not.toContain(OWNER);
    expect(body).not.toContain('secret note');
    expect(body).not.toContain('requesterOxyUserId');
  });

  it('drops a slot once somebody holds it, and keeps the rest of the evening', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);

    const before = (await availability(propertyId)).body.data.slots;
    const taken = before[0];
    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: taken.date, time: taken.time, modality: taken.modality });
    expect(res.status).toBe(201);

    const after = (await availability(propertyId)).body.data.slots;
    expect(after.map((s: { startsAt: string }) => s.startsAt)).not.toContain(taken.startsAt);
    // And it did not take the whole day with it.
    expect(after.length).toBe(before.length - 1);
  });

  it('refuses to publish slots for an external listing', async () => {
    // External listings have no in-app viewing at all, so the refusal is stated
    // BEFORE somebody picks a time rather than after.
    const { propertyId } = await seedListing({
      isExternal: true,
      oxyUserId: null,
      // `properties_external_source_url_check` — an external listing is a copy
      // of somebody else's ad and has to say whose.
      source: 'idealista',
      sourceId: 'ext-1',
      sourceUrl: 'https://www.idealista.com/inmueble/1/',
    });
    const res = await availability(propertyId);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXTERNAL_PROPERTY');
  });
});

describe('a request must be a slot that was actually offered', () => {
  it('accepts an offered slot and takes the window\'s length and modality', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);

    const video = (await availability(propertyId)).body.data.slots.find(
      (slot: { modality: string }) => slot.modality === 'video',
    );
    expect(video).toBeDefined();

    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: video.date, time: video.time, modality: 'video' });
    expect(res.status).toBe(201);
    expect(res.body.data.modality).toBe('video');
    // The Thursday window carves hour-long visits; the request did not say so
    // and must not be able to.
    expect(res.body.data.durationMinutes).toBe(60);
    expect(res.body.data.timeZone).toBe(MADRID);
    expect(res.body.data.time).toBe(video.time);

    const [row] = await getDb().select().from(viewingRequests);
    expect(row.durationMinutes).toBe(60);
    expect(row.modality).toBe('video');
  });

  it('refuses a time the owner never offered', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const offered = (await availability(propertyId)).body.data.slots[0];

    // Same day, an hour the schedule does not cover.
    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: offered.date, time: '03:00', modality: 'in_person' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_NOT_OFFERED');
    expect(await getDb().select().from(viewingRequests)).toHaveLength(0);
  });

  it('refuses the right time in the WRONG modality', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const inPerson = (await availability(propertyId)).body.data.slots.find(
      (slot: { modality: string }) => slot.modality === 'in_person',
    );

    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: inPerson.date, time: inPerson.time, modality: 'video' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_NOT_OFFERED');
  });

  it('keeps the free-form path for a listing with NO published schedule', async () => {
    // Deliberate, and argued in `viewingAvailabilityController`'s header:
    // refusing every request on every listing nobody had configured yet would
    // take a working feature away from the whole catalogue to enforce a rule
    // nobody had had the chance to state.
    const { propertyId } = await seedListing();
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: day, time: '11:00' });
    expect(res.status).toBe(201);
    expect(res.body.data.durationMinutes).toBe(30);
    expect(res.body.data.modality).toBe('in_person');
  });

  it('refuses an unknown modality on the request', async () => {
    const { propertyId } = await seedListing();
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: day, time: '11:00', modality: 'in_the_metaverse' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MODALITY');
  });

  it('anchors the civil time in the PROPERTY zone, not the server or the device', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const slot = (await availability(propertyId)).body.data.slots[0];

    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: slot.date, time: slot.time, modality: slot.modality });
    expect(res.status).toBe(201);

    // The stored instant is exactly the one the slot list advertised, whatever
    // zone this test process happens to run in.
    const [row] = await getDb().select().from(viewingRequests);
    expect(row.scheduledAt.toISOString()).toBe(new Date(slot.startsAt).toISOString());
  });
});

describe('the owner answers in their own words', () => {
  async function pendingRequest(propertyId: string): Promise<string> {
    const slot = (await availability(propertyId)).body.data.slots[0];
    const res = await request(buildApi(VISITOR))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: slot.date, time: slot.time, modality: slot.modality });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  it('records a decline with a reason, and re-reads it from the table', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const id = await pendingRequest(propertyId);

    const res = await request(buildApi(OWNER))
      .post(`/api/viewings/${id}/decline`)
      .send({ response: 'Sorry, it went yesterday — I can show you the studio upstairs.' });
    expect(res.status).toBe(200);
    expect(res.body.data.ownerResponse).toContain('studio upstairs');

    const [row] = await getDb()
      .select()
      .from(viewingRequests)
      .where(eq(viewingRequests.id, id));
    expect(row.status).toBe('declined');
    expect(row.ownerResponse).toContain('studio upstairs');
  });

  it('records an approval with a reason', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const id = await pendingRequest(propertyId);

    const res = await request(buildApi(OWNER))
      .post(`/api/viewings/${id}/approve`)
      .send({ response: 'See you then — the buzzer is 3B.' });
    expect(res.status).toBe(200);
    expect(res.body.data.ownerResponse).toContain('3B');
  });

  it('lets a decline carry no words at all', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const id = await pendingRequest(propertyId);

    const res = await request(buildApi(OWNER)).post(`/api/viewings/${id}/decline`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.ownerResponse).toBeNull();
  });

  it('will not let the REQUESTER write the owner\'s answer', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const id = await pendingRequest(propertyId);

    const res = await request(buildApi(VISITOR))
      .post(`/api/viewings/${id}/decline`)
      .send({ response: 'the owner definitely said yes' });
    expect(res.status).toBe(403);

    // Re-read: a refusal that answered 403 and wrote anyway would pass every
    // assertion about the response.
    const [row] = await getDb()
      .select()
      .from(viewingRequests)
      .where(eq(viewingRequests.id, id));
    expect(row.status).toBe('pending');
    expect(row.ownerResponse).toBeNull();
  });

  it('will not let a requester cancelling attribute words to the owner', async () => {
    const { propertyId } = await seedListing();
    await publishSchedule(propertyId);
    const id = await pendingRequest(propertyId);

    const res = await request(buildApi(VISITOR))
      .post(`/api/viewings/${id}/cancel`)
      .send({ response: 'the owner said it is fine' });
    expect(res.status).toBe(200);

    const [row] = await getDb()
      .select()
      .from(viewingRequests)
      .where(eq(viewingRequests.id, id));
    expect(row.cancelledBy).toBe('requester');
    expect(row.ownerResponse).toBeNull();
  });
});

/**
 * Two people, one half hour — forced, not hoped for.
 *
 * MUTATION TARGET. Turning `findOverlappingViewing` back into the equality it
 * replaced (`eq(viewingRequests.scheduledAt, scheduledAt)`) leaves every other
 * case in this file green and turns this one red with a 201 and two overlapping
 * appointments in the table.
 *
 * It deliberately runs against a listing with NO published schedule, so that
 * `findOverlappingViewing` is the ONLY thing standing between the two requests.
 * With a schedule the slot generator's own busy-interval filter would refuse
 * the second request as well — a second implementation of the same rule, which
 * would keep the case green against the mutated one and make it measure
 * nothing.
 */
describe('a half hour cannot be given away twice', () => {
  /** A fixed future civil day, read as UTC — the fallback zone these listings get. */
  function freeFormSlot(hour: number, minute = 0): { date: string; time: string; at: Date } {
    const day = new Date(Date.now() + 9 * 86_400_000).toISOString().slice(0, 10);
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return { date: day, time, at: new Date(`${day}T${time}:00Z`) };
  }

  it('refuses a request that OVERLAPS a conflict committed after it looked', async () => {
    const { propertyId } = await seedListing();
    const wanted = freeFormSlot(11);

    // Fifteen minutes earlier and sixty minutes long, so it runs across the
    // time being asked for WITHOUT sharing its starting instant. The old rule
    // compared instants and would see nothing here at all.
    const overlapping = new Date(wanted.at.getTime() - 15 * 60_000);

    let markTaken: () => void = () => undefined;
    const taken = new Promise<void>((resolve) => {
      markTaken = resolve;
    });
    let release: () => void = () => undefined;
    const mayCommit = new Promise<void>((resolve) => {
      release = resolve;
    });

    const holder = getDb().transaction(async (tx) => {
      // The lock FIRST, then the conflicting row — so by the time the racing
      // request arrives it faces a row it cannot see behind a lock it must
      // either respect or ignore.
      await tx
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, propertyId))
        .for('update');
      await tx.insert(viewingRequests).values({
        propertyId,
        requesterOxyUserId: 'oxy-viewer-a',
        ownerOxyUserId: OWNER,
        scheduledAt: overlapping,
        durationMinutes: 60,
        modality: 'in_person',
        status: 'pending',
      });
      markTaken();
      await mayCommit;
    });
    await taken;

    const racing = (async () =>
      request(buildApi('oxy-viewer-b'))
        .post(`/api/properties/${propertyId}/viewings`)
        .send({ date: wanted.date, time: wanted.time }))();

    // Long enough for the racing request to reach the lock and stop there.
    await new Promise((resolve) => setTimeout(resolve, 150));
    release();
    await holder;

    const res = await racing;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIME_CONFLICT');
    expect(await getDb().select().from(viewingRequests)).toHaveLength(1);
  });

  it('PERMITS a request that merely abuts one — the rule is an overlap', async () => {
    // The permit half. A refusal written with `>=` would pass the case above
    // and quietly refuse every legitimate back-to-back viewing, which is the
    // failure an owner notices and nobody debugs.
    const { propertyId } = await seedListing();
    const first = freeFormSlot(11);
    const second = freeFormSlot(11, 30);

    expect(
      (
        await request(buildApi('oxy-viewer-a'))
          .post(`/api/properties/${propertyId}/viewings`)
          .send({ date: first.date, time: first.time })
      ).status,
    ).toBe(201);
    expect(
      (
        await request(buildApi('oxy-viewer-b'))
          .post(`/api/properties/${propertyId}/viewings`)
          .send({ date: second.date, time: second.time })
      ).status,
    ).toBe(201);

    expect(await getDb().select().from(viewingRequests)).toHaveLength(2);
  });

  it('refuses an overlap even when both requests are sequential', async () => {
    // The plain, non-interleaved case, so a failure in the case above can be
    // told apart from the rule simply not existing.
    const { propertyId } = await seedListing();
    const first = freeFormSlot(11);
    const straddling = freeFormSlot(11, 15);

    expect(
      (
        await request(buildApi('oxy-viewer-a'))
          .post(`/api/properties/${propertyId}/viewings`)
          .send({ date: first.date, time: first.time })
      ).status,
    ).toBe(201);

    const res = await request(buildApi('oxy-viewer-b'))
      .post(`/api/properties/${propertyId}/viewings`)
      .send({ date: straddling.date, time: straddling.time });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TIME_CONFLICT');
    expect(await getDb().select().from(viewingRequests)).toHaveLength(1);
  });
});
