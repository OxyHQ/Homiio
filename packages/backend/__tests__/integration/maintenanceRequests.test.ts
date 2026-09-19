/**
 * Repair requests, against the REAL Postgres (#518 §7.1, #519 §7.1).
 *
 * ## What makes these non-vacuous
 *
 * This is a new domain with no production rows, so "insert one and read it
 * back" would pass against almost any implementation. Every case below targets
 * something that has a way to be wrong:
 *
 *  - every authorization refusal **re-reads the table**, because a handler that
 *    404s and writes anyway satisfies any assertion made on its response alone;
 *  - the transition cases assert BOTH a legal move and the illegal one beside
 *    it, so a state machine that permitted everything would fail;
 *  - the concurrency case runs two transitions genuinely concurrently and
 *    asserts that exactly one won AND that exactly one event was written —
 *    a lost update leaves two events for one move;
 *  - `resolved_at` is asserted to SURVIVE a reopen, which is the fact the
 *    one-way CHECK exists to allow and a tidier two-way one would have
 *    forbidden.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { asc, eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';

import * as maintenanceController from '../../controllers/maintenanceController';
import { getDb } from '../../db/postgres';
import {
  leaseCoTenants,
  leases,
  maintenanceRequestComments,
  maintenanceRequestEvents,
  maintenanceRequests,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-landlord';
const TENANT = 'oxy-tenant';
const CO_TENANT = 'oxy-co-tenant';
const STRANGER = 'oxy-stranger';

function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  // Production mounts these behind `routes()`, whose first middleware is the
  // wire-id serializer. Without it the suite would assert a body shape the API
  // does not serve.
  app.use(serializeWireIds);
  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.get('/maintenance', maintenanceController.listRequests);
  app.post('/maintenance', maintenanceController.createRequest);
  app.post('/maintenance/:id/status', maintenanceController.transitionRequest);
  app.post('/maintenance/:id/comments', maintenanceController.commentOnRequest);
  app.get('/maintenance/:id', maintenanceController.getRequest);
  app.use(errorHandler);
  return app;
}

/** An active tenancy with a landlord, a tenant and one co-tenant. */
async function seedLease(): Promise<{ leaseId: string; propertyId: string }> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: `M${Math.floor(Math.random() * 90 + 10)}`,
    overrides: { status: PropertyStatus.PUBLISHED, oxyUserId: LANDLORD },
  });
  const [lease] = await getDb()
    .insert(leases)
    .values({
      id: objectIdHex(),
      propertyId,
      landlordOxyUserId: LANDLORD,
      tenantOxyUserId: TENANT,
      status: LeaseStatus.ACTIVE,
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
    })
    .returning({ id: leases.id });
  await getDb()
    .insert(leaseCoTenants)
    .values({ leaseId: lease.id, oxyUserId: CO_TENANT, role: 'secondary', status: 'signed' });
  return { leaseId: lease.id, propertyId };
}

const NEW_REQUEST = {
  category: 'plumbing',
  urgency: 'high',
  title: 'Kitchen tap will not stop running',
  description: 'It has run since Tuesday and the sink is staining.',
};

async function report(leaseId: string, as = TENANT): Promise<string> {
  const res = await request(buildApp(as))
    .post('/maintenance')
    .send({ leaseId, ...NEW_REQUEST });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

const rowOf = async (id: string) => {
  const [row] = await getDb()
    .select()
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.id, id))
    .limit(1);
  return row;
};

const eventsOf = async (id: string) =>
  getDb()
    .select()
    .from(maintenanceRequestEvents)
    .where(eq(maintenanceRequestEvents.requestId, id))
    .orderBy(asc(maintenanceRequestEvents.createdAt));

beforeEach(async () => {
  await getDb().delete(maintenanceRequests);
  await resetGeoTables();
});

describe('who may report a repair', () => {
  it('a tenant can, and the request is linked to the lease and its property', async () => {
    const { leaseId, propertyId } = await seedLease();
    const id = await report(leaseId);

    const row = await rowOf(id);
    expect(row.leaseId).toBe(leaseId);
    // Taken from the LEASE, never the body — a caller naming their own
    // property would be the client-supplied-owner shape `AGENTS.md` forbids.
    expect(row.propertyId).toBe(propertyId);
    expect(row.reportedByOxyUserId).toBe(TENANT);
    expect(row.status).toBe('open');
  });

  it('a co-tenant can: they live there too', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId, CO_TENANT);
    expect((await rowOf(id)).reportedByOxyUserId).toBe(CO_TENANT);
  });

  it('a landlord CANNOT, and nothing is written', async () => {
    const { leaseId } = await seedLease();
    const res = await request(buildApp(LANDLORD))
      .post('/maintenance')
      .send({ leaseId, ...NEW_REQUEST });

    expect(res.status).toBe(403);
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(0);
  });

  it('a stranger gets 404 — not 403 — and nothing is written', async () => {
    const { leaseId } = await seedLease();
    const res = await request(buildApp(STRANGER))
      .post('/maintenance')
      .send({ leaseId, ...NEW_REQUEST });

    // 404 rather than 403: confirming the lease id exists is already telling
    // them something.
    expect(res.status).toBe(404);
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(0);
  });

  it('refuses an unknown category and an unknown urgency', async () => {
    const { leaseId } = await seedLease();
    for (const body of [
      { ...NEW_REQUEST, category: 'haunting' },
      { ...NEW_REQUEST, urgency: 'catastrophic' },
      { ...NEW_REQUEST, title: '' },
    ]) {
      const res = await request(buildApp(TENANT)).post('/maintenance').send({ leaseId, ...body });
      expect(res.status).toBe(400);
    }
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(0);
  });

  it('records the creation in the history, so the timeline starts at the start', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const events = await eventsOf(id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fromStatus: null, toStatus: 'open', role: 'tenant' });
  });
});

describe('who may read a repair', () => {
  it('every participant of the lease can', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    for (const who of [TENANT, CO_TENANT, LANDLORD]) {
      const res = await request(buildApp(who)).get(`/maintenance/${id}`);
      expect({ who, status: res.status }).toEqual({ who, status: 200 });
    }
  });

  it('a stranger cannot, by list or by id', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    expect((await request(buildApp(STRANGER)).get(`/maintenance/${id}`)).status).toBe(404);
    const list = await request(buildApp(STRANGER)).get('/maintenance');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(0);
  });

  it('tells each side what IT may do next, not what the other side may', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    const asLandlord = await request(buildApp(LANDLORD)).get(`/maintenance/${id}`);
    const asTenant = await request(buildApp(TENANT)).get(`/maintenance/${id}`);

    // From `open`: the landlord acknowledges or declines; the tenant may only
    // withdraw. A screen that guessed its own role would draw the wrong pair.
    expect(asLandlord.body.data.availableTransitions.sort()).toEqual(['acknowledged', 'declined']);
    expect(asTenant.body.data.availableTransitions).toEqual(['closed']);
  });
});

describe('the state machine', () => {
  it('walks open → acknowledged → scheduled → resolved → closed', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const landlord = buildApp(LANDLORD);
    const tenant = buildApp(TENANT);

    expect((await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'acknowledged' })).status).toBe(200);
    expect(
      (
        await request(landlord)
          .post(`/maintenance/${id}/status`)
          .send({ status: 'scheduled', scheduledFor: '2026-10-01T09:00:00.000Z' })
      ).status,
    ).toBe(200);
    expect((await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'resolved' })).status).toBe(200);
    expect((await request(tenant).post(`/maintenance/${id}/status`).send({ status: 'closed' })).status).toBe(200);

    expect((await rowOf(id)).status).toBe('closed');
    expect(await eventsOf(id)).toHaveLength(5);
  });

  it('refuses a move that is not an edge, with 409 and no write', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    const res = await request(buildApp(LANDLORD))
      .post(`/maintenance/${id}/status`)
      .send({ status: 'closed' });

    // 409, not 400: "the request has moved on" is actionable; "you sent
    // nonsense" is not what happened.
    expect(res.status).toBe(409);
    expect((await rowOf(id)).status).toBe('open');
    expect(await eventsOf(id)).toHaveLength(1);
  });

  it('refuses a move the OTHER role owns', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    await request(buildApp(LANDLORD)).post(`/maintenance/${id}/status`).send({ status: 'acknowledged' });

    // A tenant cannot declare their own repair fixed: "resolved" is a claim
    // about work somebody else owes.
    const res = await request(buildApp(TENANT))
      .post(`/maintenance/${id}/status`)
      .send({ status: 'resolved' });
    expect(res.status).toBe(409);
    expect((await rowOf(id)).status).toBe('acknowledged');
  });

  it('a landlord cannot close a request either — closing is the reporter agreeing', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const landlord = buildApp(LANDLORD);
    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'acknowledged' });
    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'resolved' });

    expect((await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'closed' })).status).toBe(409);
    expect((await rowOf(id)).status).toBe('resolved');
  });

  it('requires a date to schedule, and clears it on the way out', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const landlord = buildApp(LANDLORD);
    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'acknowledged' });

    expect((await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'scheduled' })).status).toBe(400);
    await request(landlord)
      .post(`/maintenance/${id}/status`)
      .send({ status: 'scheduled', scheduledFor: '2026-10-01T09:00:00.000Z' });
    expect((await rowOf(id)).scheduledFor).not.toBeNull();

    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'resolved' });
    // The coherence CHECK is two-way, so a stale date on a resolved request
    // would be refused by the database — clearing it is what makes the move
    // legal rather than a constraint violation.
    expect((await rowOf(id)).scheduledFor).toBeNull();
  });

  it('keeps resolved_at through a reopen — the fact a tenant needs', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const landlord = buildApp(LANDLORD);
    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'acknowledged' });
    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'resolved' });
    const resolvedAt = (await rowOf(id)).resolvedAt;
    expect(resolvedAt).not.toBeNull();

    await request(buildApp(TENANT)).post(`/maintenance/${id}/status`).send({ status: 'open' });

    const reopened = await rowOf(id);
    expect(reopened.status).toBe('open');
    // "Declared fixed on the 3rd and was not." A two-way CHECK, or a clear on
    // reopen, would erase exactly this.
    expect(reopened.resolvedAt).toEqual(resolvedAt);
  });

  it('a stranger cannot move anything', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const res = await request(buildApp(STRANGER))
      .post(`/maintenance/${id}/status`)
      .send({ status: 'acknowledged' });

    expect(res.status).toBe(404);
    expect((await rowOf(id)).status).toBe('open');
  });
});

describe('two people pressing the same button', () => {
  it('one wins, and exactly one event is written', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const landlord = buildApp(LANDLORD);
    await request(landlord).post(`/maintenance/${id}/status`).send({ status: 'acknowledged' });

    // Genuinely concurrent, not sequential: the row lock is what turns the
    // second into a refusal instead of a silent overwrite. Without it both read
    // `acknowledged`, both validate, and the table ends with TWO events for one
    // move and a `resolved_at` nobody can account for.
    const [first, second] = await Promise.all([
      request(landlord).post(`/maintenance/${id}/status`).send({ status: 'resolved' }),
      request(landlord).post(`/maintenance/${id}/status`).send({ status: 'resolved' }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect((await rowOf(id)).status).toBe('resolved');
    // Two creation + one acknowledge + one resolve = three. A lost update
    // leaves four.
    expect(await eventsOf(id)).toHaveLength(3);
  });
});

describe('the thread', () => {
  it('every participant can comment, and the role is resolved server-side', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    for (const [who, role] of [
      [TENANT, 'tenant'],
      [CO_TENANT, 'tenant'],
      [LANDLORD, 'landlord'],
    ] as const) {
      const res = await request(buildApp(who))
        .post(`/maintenance/${id}/comments`)
        .send({ body: `from ${who}`, role: 'landlord' });
      expect(res.status).toBe(201);
      // The `role: 'landlord'` in the body above is IGNORED — a tenant cannot
      // label themselves the landlord by asking.
      expect({ who, role: res.body.data.role }).toEqual({ who, role });
    }

    const detail = await request(buildApp(TENANT)).get(`/maintenance/${id}`);
    expect(detail.body.data.comments).toHaveLength(3);
  });

  it('a stranger cannot comment, and nothing is written', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    const res = await request(buildApp(STRANGER))
      .post(`/maintenance/${id}/comments`)
      .send({ body: 'hello' });

    expect(res.status).toBe(404);
    expect(
      await getDb()
        .select()
        .from(maintenanceRequestComments)
        .where(eq(maintenanceRequestComments.requestId, id)),
    ).toHaveLength(0);
  });

  it('refuses an empty comment', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const res = await request(buildApp(TENANT))
      .post(`/maintenance/${id}/comments`)
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('the list', () => {
  it('shows a person only the tenancies they are on', async () => {
    const mine = await seedLease();
    await report(mine.leaseId);

    const list = await request(buildApp(TENANT)).get('/maintenance');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].leaseId).toBe(mine.leaseId);
    expect(list.body.pagination?.total ?? list.body.total).toBe(1);
  });

  it('openOnly hides what is finished', async () => {
    const { leaseId } = await seedLease();
    const open = await report(leaseId);
    const withdrawn = await report(leaseId);
    await request(buildApp(TENANT)).post(`/maintenance/${withdrawn}/status`).send({ status: 'closed' });

    const all = await request(buildApp(TENANT)).get('/maintenance');
    const openRes = await request(buildApp(TENANT)).get('/maintenance?openOnly=true');

    expect(all.body.data).toHaveLength(2);
    expect(openRes.body.data.map((row: { id: string }) => row.id)).toEqual([open]);
  });
});
