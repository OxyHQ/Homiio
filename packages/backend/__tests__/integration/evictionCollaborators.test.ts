import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import evictionRoutes from '../../routes/evictions';
import { getDb, closePostgres } from '../../db/postgres';
import {
  evictionCases,
  evictionCaseChanges,
  evictionCaseCollaborators,
  evictionCaseHelpNeeds,
} from '../../db/schema';
import { errorHandler } from '../../middlewares/errorHandler';
import { changeCollaborator, lockCase } from '../../db/evictions/collaboratorRepository';
import {
  updateOwnedEvictionCase,
  findEditableEvictionCase,
} from '../../db/evictions/evictionRepository';
import { resolveExactLocation } from '../../db/evictions/evictionAccessRepository';
import { oxyService } from '../../services/oxy';

jest.mock('../../services/oxy', () => ({
  oxyService: { users: { get: jest.fn(async (id: string) => ({ id })) } },
}));

function app(actor: string) {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    (req as unknown as { user: { id: string }; userId: string }).user = { id: actor };
    (req as unknown as { userId: string }).userId = actor;
    next();
  });
  server.use('/evictions', evictionRoutes());
  server.use(errorHandler);
  return server;
}

async function fixture(authorized = true) {
  const response = await request(app('owner'))
    .post('/evictions')
    .send({
      title: 'A personal case',
      description: 'Help our neighbors',
      location: { label: 'Barcelona', coordinates: [2.17, 41.38], city: 'Barcelona' },
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      householdAuthorizedExact: authorized,
      exactAddress: 'PRIVATE ADDRESS',
    });
  expect(response.status).toBe(201);
  return response.body.data.eviction.id as string;
}
async function add(id: string, actor = 'owner', target = 'editor') {
  return request(app(actor))
    .post(`/evictions/${id}/collaborators`)
    .send({ oxyUserId: target, acknowledgeExactLocationAccess: true });
}

beforeEach(async () => {
  await getDb().delete(evictionCases);
  await getDb().delete(evictionCaseChanges);
  jest.clearAllMocks();
});

it('requires explicit warning acknowledgement and a real Oxy account, without changing personal ownership', async () => {
  const id = await fixture();
  expect(
    (
      await request(app('owner'))
        .post(`/evictions/${id}/collaborators`)
        .send({ oxyUserId: 'editor' })
    ).status,
  ).toBe(400);
  expect((await add(id)).status).toBe(200);
  expect(oxyService.users.get).toHaveBeenCalledWith('editor', { cache: false });
  expect((await add(id)).status).toBe(200);
  const rows = await getDb()
    .select()
    .from(evictionCaseCollaborators)
    .where(eq(evictionCaseCollaborators.caseId, id));
  expect(rows).toHaveLength(1);
  const [owner] = await getDb()
    .select({ id: evictionCases.oxyUserId })
    .from(evictionCases)
    .where(eq(evictionCases.id, id));
  expect(owner.id).toBe('owner');
});

it('allows editing, updates and exact reads; prevents owner replacement, management, deletion and outsider access', async () => {
  const id = await fixture();
  await add(id);
  const edited = await request(app('editor'))
    .put(`/evictions/${id}`)
    .send({
      title: 'Edited',
      exactAddress: 'PRIVATE EDIT',
      oxyUserId: 'editor',
      householdAuthorizedExact: true,
      helpNeeds: [{ type: 'presence', note: 'Please help' }],
    });
  expect(edited.status).toBe(200);
  expect(JSON.stringify(edited.body)).not.toContain('PRIVATE EDIT');
  expect(
    (await request(app('editor')).post(`/evictions/${id}/updates`).send({ message: 'Team update' }))
      .status,
  ).toBe(201);
  const exact = await request(app('editor')).get(`/evictions/${id}/location/exact`);
  expect(exact.status).toBe(200);
  expect(exact.headers['cache-control']).toBe('no-store');
  expect(exact.body.data.exactAddress).toBe('PRIVATE EDIT');
  expect((await add(id, 'editor', 'outsider')).status).toBe(404);
  expect((await request(app('editor')).delete(`/evictions/${id}/collaborators/owner`)).status).toBe(
    404,
  );
  expect((await request(app('owner')).delete(`/evictions/${id}/collaborators/owner`)).status).toBe(
    400,
  );
  expect((await request(app('editor')).delete(`/evictions/${id}`)).status).toBe(404);
  expect((await request(app('outsider')).get(`/evictions/${id}/team`)).status).toBe(404);
  expect((await request(app('outsider')).get(`/evictions/${id}/location/exact`)).status).toBe(403);
  expect(
    (await request(app('outsider')).put(`/evictions/${id}`).send({ title: 'attack' })).status,
  ).toBe(404);
  const audit = await getDb()
    .select()
    .from(evictionCaseChanges)
    .where(eq(evictionCaseChanges.caseId, id));
  expect(
    audit.filter((row) => row.action === 'case_updated').map((row) => row.actorOxyUserId),
  ).toEqual(['editor', 'editor']);
});

it('does not invent household authorization for a collaborator', async () => {
  const id = await fixture(false);
  await add(id);
  expect((await request(app('editor')).get(`/evictions/${id}/location/exact`)).status).toBe(403);
  expect(
    (
      await request(app('editor'))
        .put(`/evictions/${id}`)
        .send({ exactAddress: 'NO', householdAuthorizedExact: true })
    ).status,
  ).toBe(409);
});

it('removal immediately revokes reads, edits, updates and any prior location grant', async () => {
  const id = await fixture();
  await add(id);
  expect(
    (
      await request(app('owner'))
        .post(`/evictions/${id}/location/grants`)
        .send({ granteeOxyUserId: 'editor', purpose: 'accompaniment', hours: 2 })
    ).status,
  ).toBe(201);
  expect((await request(app('owner')).delete(`/evictions/${id}/collaborators/editor`)).status).toBe(
    200,
  );
  expect((await request(app('editor')).get(`/evictions/${id}/location/exact`)).status).toBe(403);
  expect((await request(app('editor')).get(`/evictions/${id}/team`)).status).toBe(404);
  expect(
    (
      await request(app('editor'))
        .put(`/evictions/${id}`)
        .send({ exactAddress: 'attack', helpNeeds: [] })
    ).status,
  ).toBe(404);
  expect(
    (await request(app('editor')).post(`/evictions/${id}/updates`).send({ message: 'attack' }))
      .status,
  ).toBe(404);
});

it('rechecks membership after a concurrent removal while keeping help needs atomic', async () => {
  const id = await fixture();
  await add(id);
  expect(await findEditableEvictionCase(id, 'editor')).toBeDefined();
  await getDb()
    .insert(evictionCaseHelpNeeds)
    .values({ caseId: id, needType: 'presence', note: 'Preserve me' });
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const removal = getDb().transaction(async (tx) => {
    await lockCase(id, tx);
    await tx.delete(evictionCaseCollaborators).where(eq(evictionCaseCollaborators.caseId, id));
    locked();
    await gate;
  });
  await ready;
  const edit = updateOwnedEvictionCase({
    caseId: id,
    oxyUserId: 'editor',
    patch: { locationExactAddress: 'ATTACK' },
    allowCollaborator: true,
    helpNeeds: [],
  });
  const read = resolveExactLocation({ caseId: id, requesterOxyUserId: 'editor' });
  release();
  await removal;
  expect(await edit).toEqual({ outcome: 'not_found' });
  expect((await read).outcome).toBe('denied');
  expect(
    await getDb().select().from(evictionCaseHelpNeeds).where(eq(evictionCaseHelpNeeds.caseId, id)),
  ).toEqual([expect.objectContaining({ note: 'Preserve me' })]);
});

it('serializes an in-flight edit before removal and blocks every later edit', async () => {
  const id = await fixture();
  await add(id);
  let release!: () => void;
  let edited!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    edited = resolve;
  });
  const edit = getDb().transaction(async (tx) => {
    const result = await updateOwnedEvictionCase(
      {
        caseId: id,
        oxyUserId: 'editor',
        patch: { title: 'Before removal' },
        allowCollaborator: true,
      },
      tx,
    );
    edited();
    await gate;
    return result;
  });
  await ready;
  const removal = changeCollaborator({
    caseId: id,
    actorOxyUserId: 'owner',
    oxyUserId: 'editor',
    add: false,
  });
  release();
  expect((await edit).outcome).toBe('updated');
  expect(await removal).toBe('ok');
  expect(
    (
      await updateOwnedEvictionCase({
        caseId: id,
        oxyUserId: 'editor',
        patch: { title: 'After removal' },
        allowCollaborator: true,
      })
    ).outcome,
  ).toBe('not_found');
});

it('retains the creator deletion actor after cascading the case and team', async () => {
  const id = await fixture();
  await add(id);
  expect((await request(app('owner')).delete(`/evictions/${id}`)).status).toBe(200);
  const audit = await getDb()
    .select()
    .from(evictionCaseChanges)
    .where(eq(evictionCaseChanges.caseReference, id));
  expect(audit.find((row) => row.action === 'case_deleted')).toMatchObject({
    actorOxyUserId: 'owner',
    caseId: null,
  });
});

afterAll(async () => {
  await closePostgres();
});

it('preserves the exact coordinates when an editor resubmits the public map seed', async () => {
  const id = await fixture();
  await add(id);
  const [row] = await getDb()
    .select({
      longitude: evictionCases.locationLongitude,
      latitude: evictionCases.locationLatitude,
    })
    .from(evictionCases)
    .where(eq(evictionCases.id, id));
  expect(
    (
      await request(app('editor'))
        .put(`/evictions/${id}`)
        .send({
          title: 'New title',
          location: { label: 'Barcelona', coordinates: [row.longitude, row.latitude] },
        })
    ).status,
  ).toBe(200);
  const exact = await resolveExactLocation({ caseId: id, requesterOxyUserId: 'editor' });
  expect(exact).toMatchObject({
    outcome: 'granted',
    location: { exactCoordinates: [2.17, 41.38] },
  });
});

it('rejects a target that Oxy does not resolve without writing membership', async () => {
  const id = await fixture();
  jest
    .mocked(oxyService.users.get)
    .mockResolvedValueOnce({ id: 'different-account' } as Awaited<
      ReturnType<typeof oxyService.users.get>
    >);
  expect((await add(id)).status).toBe(404);
  expect(
    await getDb()
      .select()
      .from(evictionCaseCollaborators)
      .where(eq(evictionCaseCollaborators.caseId, id)),
  ).toEqual([]);
});
