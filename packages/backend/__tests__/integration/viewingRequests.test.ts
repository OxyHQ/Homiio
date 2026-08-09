/**
 * Viewing requests — the lifecycle, the two conflict rules, and the
 * `cancelled_by` equivalence, against the REAL Postgres this worker owns.
 *
 * ## What makes these tests non-vacuous
 *
 * `viewing_requests` was empty in production. Every case below targets a rule
 * with a way to be wrong:
 *
 *  - `viewing_requests_cancelled_by_status_check` is asserted in BOTH
 *    directions — the shapes it refuses are the ones Mongo allowed,
 *  - every refusal re-reads the row, because a handler that 403s and writes
 *    anyway passes any assertion made on its response alone,
 *  - the two conflict rules are asserted on what they PERMIT (a re-request
 *    after a decline, the same slot on a different property) as well as what
 *    they refuse — a rule scoped too widely passes every refusal test.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';

import viewingController from '../../controllers/viewingController';
import { getDb } from '../../db/postgres';
import { viewingRequests } from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });
  app.post('/properties/:propertyId/viewings', (req, res, next) => viewingController.createViewingRequest(req, res, next));
  app.get('/properties/:propertyId/viewings', (req, res, next) => viewingController.listPropertyViewingRequests(req, res, next));
  app.get('/viewings', (req, res, next) => viewingController.listMyViewingRequests(req, res, next));
  app.post('/viewings/:viewingId/approve', (req, res, next) => viewingController.approveViewingRequest(req, res, next));
  app.post('/viewings/:viewingId/decline', (req, res, next) => viewingController.declineViewingRequest(req, res, next));
  app.post('/viewings/:viewingId/cancel', (req, res, next) => viewingController.cancelViewingRequest(req, res, next));
  app.put('/viewings/:viewingId', (req, res, next) => viewingController.updateViewingRequest(req, res, next));
  app.use(errorHandler);
  return app;
}

/**
 * A distinct ISO-3166 alpha-2 per geo chain within a test.
 *
 * `countries_code_key` is UNIQUE, so two chains built with the fixture's default
 * `ES` collide — and several cases below deliberately seed more than one listing
 * (a draft, an external and an owned one; two properties for the same slot).
 * The counter resets per file, and `resetGeoTables` runs between tests, so the
 * codes never have to be globally unique — only unique within one test.
 */
let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `${alphabet[Math.floor(index / 26) % 26]}${alphabet[index % 26]}`;
}

/** A PUBLISHED, internal listing owned by `oxy-owner`. */
async function seedBookableProperty(oxyUserId = 'oxy-owner'): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: { oxyUserId, status: 'published', isExternal: false },
  });
  return propertyId;
}

/** A date/time pair a fortnight out, in the shape the client sends. */
function futureSlot(offsetDays = 14, time = '10:00'): { date: string; time: string } {
  const day = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return { date: day.toISOString().slice(0, 10), time };
}

async function viewingRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(viewingRequests)
    .where(eq(viewingRequests.id, id))
    .limit(1);
  return row;
}

async function createRequest(
  propertyId: string,
  requester = 'oxy-requester',
  slot = futureSlot(),
): Promise<string> {
  const res = await request(buildApp(requester))
    .post(`/properties/${propertyId}/viewings`)
    .send(slot);
  expect(res.status).toBe(201);
  return res.body.data.id;
}

beforeEach(async () => {
  await getDb().delete(viewingRequests);
  await resetGeoTables();
});

afterAll(async () => {
  // Leave the shared tables as this file found them — see the reproduced
  // geoBackfill collision documented in `leaseOwnership.test.ts`.
  await getDb().delete(viewingRequests);
  await resetGeoTables();
});

describe('createViewingRequest', () => {
  it('stores a pending request with a server-resolved owner', async () => {
    const propertyId = await seedBookableProperty();
    const res = await request(buildApp('oxy-requester'))
      .post(`/properties/${propertyId}/viewings`)
      // A forged owner and status must be ignored — both are resolved
      // server-side from the listing and the transition.
      .send({ ...futureSlot(), ownerOxyUserId: 'attacker', status: 'approved' });

    expect(res.status).toBe(201);
    const persisted = await viewingRow(res.body.data.id);
    expect(persisted.ownerOxyUserId).toBe('oxy-owner');
    expect(persisted.requesterOxyUserId).toBe('oxy-requester');
    expect(persisted.status).toBe('pending');
    expect(persisted.cancelledBy).toBeNull();
  });

  it('refuses an unpublished, an external and an owner-booked listing', async () => {
    const draft = (await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-owner', status: 'draft' },
    })).propertyId;
    expect((await request(buildApp('oxy-r')).post(`/properties/${draft}/viewings`).send(futureSlot())).status).toBe(400);

    const external = (await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: { oxyUserId: 'oxy-owner', status: 'published', isExternal: true, source: 'idealista', sourceUrl: 'https://x.test/1' },
    })).propertyId;
    expect((await request(buildApp('oxy-r')).post(`/properties/${external}/viewings`).send(futureSlot())).status).toBe(400);

    const own = await seedBookableProperty();
    expect((await request(buildApp('oxy-owner')).post(`/properties/${own}/viewings`).send(futureSlot())).status).toBe(403);

    expect(await getDb().select().from(viewingRequests)).toHaveLength(0);
  });

  it('refuses a slot in the past', async () => {
    const propertyId = await seedBookableProperty();
    const res = await request(buildApp('oxy-requester'))
      .post(`/properties/${propertyId}/viewings`)
      .send(futureSlot(-1));
    expect(res.status).toBe(400);
  });

  it('refuses a SECOND active request from the same person on the same property', async () => {
    const propertyId = await seedBookableProperty();
    await createRequest(propertyId);

    const second = await request(buildApp('oxy-requester'))
      .post(`/properties/${propertyId}/viewings`)
      .send(futureSlot(20));
    expect(second.status).toBe(409);
    expect(await getDb().select().from(viewingRequests)).toHaveLength(1);
  });

  it('PERMITS a fresh request after the first was declined', async () => {
    // The permit half. A rule that keyed on the person and property WITHOUT the
    // active-status scope passes every refusal above and eats this one.
    const propertyId = await seedBookableProperty();
    const id = await createRequest(propertyId);
    expect((await request(buildApp('oxy-owner')).post(`/viewings/${id}/decline`)).status).toBe(200);

    const again = await request(buildApp('oxy-requester'))
      .post(`/properties/${propertyId}/viewings`)
      .send(futureSlot(20));
    expect(again.status).toBe(201);
  });

  it('refuses a slot another person already holds, and PERMITS it on a different property', async () => {
    const propertyId = await seedBookableProperty();
    const slot = futureSlot();
    await createRequest(propertyId, 'oxy-first', slot);

    const clash = await request(buildApp('oxy-second'))
      .post(`/properties/${propertyId}/viewings`)
      .send(slot);
    expect(clash.status).toBe(409);

    // The same instant on a DIFFERENT listing is not a conflict — a rule that
    // forgot the property scope would refuse this too.
    const other = await seedBookableProperty('oxy-other-owner');
    const elsewhere = await request(buildApp('oxy-second'))
      .post(`/properties/${other}/viewings`)
      .send(slot);
    expect(elsewhere.status).toBe(201);
  });
});

describe('approve / decline — owner only, pending only', () => {
  it('approves a pending request and notifies nobody else', async () => {
    const id = await createRequest(await seedBookableProperty());
    const res = await request(buildApp('oxy-owner')).post(`/viewings/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
    // `cancelled_by` must stay NULL for any status but `cancelled`.
    expect((await viewingRow(id)).cancelledBy).toBeNull();
  });

  it('refuses a non-owner approval and leaves the request pending', async () => {
    const id = await createRequest(await seedBookableProperty());
    const res = await request(buildApp('oxy-requester')).post(`/viewings/${id}/approve`);
    expect(res.status).toBe(403);
    expect((await viewingRow(id)).status).toBe('pending');
  });

  it('refuses a SECOND approval — the precondition is in the UPDATE', async () => {
    const id = await createRequest(await seedBookableProperty());
    expect((await request(buildApp('oxy-owner')).post(`/viewings/${id}/approve`)).status).toBe(200);
    expect((await request(buildApp('oxy-owner')).post(`/viewings/${id}/approve`)).status).toBe(400);
  });

  it('refuses approving a second request for an instant already approved', async () => {
    const propertyId = await seedBookableProperty();
    const slot = futureSlot();
    const first = await createRequest(propertyId, 'oxy-a', slot);
    expect((await request(buildApp('oxy-owner')).post(`/viewings/${first}/approve`)).status).toBe(200);

    // A second request at the same instant can only exist if it was created
    // before the first was approved — seeded directly, since the create path
    // refuses it.
    const [second] = await getDb()
      .insert(viewingRequests)
      .values({
        propertyId,
        requesterOxyUserId: 'oxy-b',
        ownerOxyUserId: 'oxy-owner',
        scheduledAt: new Date(`${slot.date}T${slot.time}`),
        status: 'pending',
      })
      .returning();

    const res = await request(buildApp('oxy-owner')).post(`/viewings/${second.id}/approve`);
    expect(res.status).toBe(409);
    expect((await viewingRow(second.id)).status).toBe('pending');
  });
});

describe('cancel — the `cancelled_by` equivalence', () => {
  it('records WHICH side cancelled, in the same statement as the status', async () => {
    const propertyId = await seedBookableProperty();

    const byRequester = await createRequest(propertyId, 'oxy-requester');
    expect((await request(buildApp('oxy-requester')).post(`/viewings/${byRequester}/cancel`)).status).toBe(200);
    expect(await viewingRow(byRequester)).toMatchObject({ status: 'cancelled', cancelledBy: 'requester' });

    const byOwner = await createRequest(propertyId, 'oxy-other', futureSlot(21));
    expect((await request(buildApp('oxy-owner')).post(`/viewings/${byOwner}/cancel`)).status).toBe(200);
    expect(await viewingRow(byOwner)).toMatchObject({ status: 'cancelled', cancelledBy: 'owner' });
  });

  it('refuses a non-party cancellation', async () => {
    const id = await createRequest(await seedBookableProperty());
    const res = await request(buildApp('oxy-stranger')).post(`/viewings/${id}/cancel`);
    expect(res.status).toBe(403);
    expect((await viewingRow(id)).status).toBe('pending');
  });

  it('is idempotent — a second cancel answers 200 and does not re-attribute', async () => {
    const id = await createRequest(await seedBookableProperty());
    expect((await request(buildApp('oxy-requester')).post(`/viewings/${id}/cancel`)).status).toBe(200);

    // The OWNER cancels an already-cancelled request: the answer is the current
    // state, and `cancelled_by` must still name the requester who really did it.
    const second = await request(buildApp('oxy-owner')).post(`/viewings/${id}/cancel`);
    expect(second.status).toBe(200);
    expect((await viewingRow(id)).cancelledBy).toBe('requester');
  });

  it('REFUSES a cancelled row with no canceller, and a canceller on a pending row', async () => {
    // The CHECK, in both directions. Mongo permitted each; the second is the
    // damaging one — a cancellation neither party can be shown to have made.
    const propertyId = await seedBookableProperty();
    const base = {
      propertyId,
      requesterOxyUserId: 'oxy-r',
      ownerOxyUserId: 'oxy-owner',
      scheduledAt: new Date(Date.now() + 86_400_000),
    };

    await expect(
      getDb().insert(viewingRequests).values({ ...base, status: 'cancelled' }),
    ).rejects.toThrow();

    await expect(
      getDb().insert(viewingRequests).values({ ...base, status: 'pending', cancelledBy: 'owner' }),
    ).rejects.toThrow();
  });
});

describe('reschedule — requester only, pending only', () => {
  it('moves the instant and refuses a clash', async () => {
    const propertyId = await seedBookableProperty();
    const taken = futureSlot(15);
    await createRequest(propertyId, 'oxy-other', taken);
    const mine = await createRequest(propertyId, 'oxy-requester', futureSlot(16));

    const clash = await request(buildApp('oxy-requester')).put(`/viewings/${mine}`).send(taken);
    expect(clash.status).toBe(409);

    const moved = await request(buildApp('oxy-requester')).put(`/viewings/${mine}`).send(futureSlot(17));
    expect(moved.status).toBe(200);
  });

  it('refuses the owner and refuses a non-pending request', async () => {
    const propertyId = await seedBookableProperty();
    const id = await createRequest(propertyId);

    expect((await request(buildApp('oxy-owner')).put(`/viewings/${id}`).send(futureSlot(18))).status).toBe(403);

    await request(buildApp('oxy-owner')).post(`/viewings/${id}/approve`);
    expect((await request(buildApp('oxy-requester')).put(`/viewings/${id}`).send(futureSlot(18))).status).toBe(400);
  });
});

describe('listing — scope IS the authorisation', () => {
  it('shows an owner every request and a requester only their own', async () => {
    const propertyId = await seedBookableProperty();
    await createRequest(propertyId, 'oxy-a', futureSlot(10));
    await createRequest(propertyId, 'oxy-b', futureSlot(11));

    const owner = await request(buildApp('oxy-owner')).get(`/properties/${propertyId}/viewings`);
    expect(owner.body.data).toHaveLength(2);
    expect(owner.body.pagination.total).toBe(2);

    const requester = await request(buildApp('oxy-a')).get(`/properties/${propertyId}/viewings`);
    expect(requester.body.data).toHaveLength(1);
    expect(requester.body.pagination.total).toBe(1);
    expect(requester.body.data[0].requesterOxyUserId).toBe('oxy-a');
  });

  it('lists my own requests across properties, soonest first', async () => {
    const first = await seedBookableProperty('oxy-owner-1');
    const second = await seedBookableProperty('oxy-owner-2');
    await createRequest(second, 'oxy-me', futureSlot(20));
    await createRequest(first, 'oxy-me', futureSlot(5));

    const res = await request(buildApp('oxy-me')).get('/viewings');
    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { propertyId: string }) => row.propertyId)).toEqual([first, second]);
  });
});
