import express from 'express';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import type { TeamSnapshot } from '@oxy.so/allo-sdk';
import evictionRoutes from '../../routes/evictions';
import { getDb, closePostgres } from '../../db/postgres';
import {
  evictionCases,
  evictionCaseCollaborators,
  evictionTeamChats,
  evictionTeamChatOperations,
} from '../../db/schema';
import { changeCollaborator, getCaseTeam } from '../../db/evictions/collaboratorRepository';
import {
  beginTeamOperation,
  finalizeTeamOperation,
  readTeamOperation,
} from '../../db/evictions/teamChatRepository';
import { errorHandler } from '../../middlewares/errorHandler';
jest.mock('../../services/oxy', () => {
  const { OxyServer } = jest.requireActual('@oxy.so/core/server');
  const oxyService = new OxyServer({
    baseURL: 'https://fixture.oxy.test',
    workloadCredentials: async () => ({ AccessKeyId: 'fixture', SecretAccessKey: 'fixture' }),
  });
  jest
    .spyOn(oxyService.users, 'get')
    .mockImplementation(async (id: unknown) => ({ id: String(id) }));
  return { oxyService };
});
const originalFetch = globalThis.fetch;
let snapshot: TeamSnapshot | null = null;
let offline = false;
function app(actor = 'owner') {
  const server = express();
  server.use(express.json());
  server.use((req, _res, next) => {
    Reflect.set(req, 'user', { id: actor });
    Reflect.set(req, 'userId', actor);
    next();
  });
  server.use('/evictions', evictionRoutes());
  server.use(errorHandler);
  return server;
}
async function fixture() {
  const res = await request(app())
    .post('/evictions')
    .send({
      title: 'Personal case',
      description: 'Private content stays in Homiio',
      location: { label: 'Barcelona', coordinates: [2.17, 41.38], city: 'Barcelona' },
      scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      householdAuthorizedExact: true,
      exactAddress: 'PRIVATE ADDRESS',
    });
  expect(res.status).toBe(201);
  return res.body.data.eviction.id as string;
}
beforeAll(() => {
  process.env.HOMIIO_TEAM_CHAT_KEY = 'a'.repeat(64);
});
beforeEach(async () => {
  snapshot = null;
  offline = false;
  await getDb().delete(evictionCases);
  globalThis.fetch = jest.fn(async (url, init) => {
    const req = new Request(url, init);
    if (req.url === 'https://fixture.oxy.test/auth/service-token/workload/challenge')
      return Response.json({ nonce: 'fixture' });
    if (req.url === 'https://fixture.oxy.test/auth/service-token/workload') {
      const body = await req.json();
      expect(body.protocolVersion).toBe(2);
      expect(body.audience).toBe('oxy-service:6a2f851751b784a86fd0e92b');
      return Response.json({
        token: `e30.${Buffer.from(JSON.stringify({ type: 'service', authority: 'first_party', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')}.signature`,
        expiresIn: 300,
      });
    }
    expect(req.url).toBe('https://api.allo.you/v1/team-access/snapshot');
    expect(req.headers.get('x-allo-team-capability')).toHaveLength(43);
    expect(req.headers.get('authorization')).toMatch(/^Bearer /);
    if (offline) throw new TypeError('fetch failed: Allo offline');
    return Response.json(snapshot ?? { error: { code: 'not_found', message: 'Not found' } }, {
      status: snapshot ? 200 : 404,
    });
  }) as typeof fetch;
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.HOMIIO_TEAM_CHAT_KEY;
  await closePostgres();
});
function remote(
  op: Awaited<ReturnType<typeof beginTeamOperation>>,
  members = op.operation.targetAccountIds,
): TeamSnapshot {
  return {
    conversationId: 'opaque-allo-conversation',
    sourceReference: op.operation.caseId,
    ownerAccountId: op.operation.ownerAccountId,
    operationId: op.operation.id,
    memberAccountIds: [...members].sort(),
    epoch: 1,
    frozen: true,
  };
}
it('reserves one opaque encrypted reference and resumes concurrent creation without exposing its grant in team DTOs', async () => {
  const id = await fixture();
  const [first, second] = await Promise.all([
    beginTeamOperation(id, 'owner', { action: 'open' }),
    beginTeamOperation(id, 'owner', { action: 'open' }),
  ]);
  expect(first).toEqual(second);
  const [stored] = await getDb()
    .select()
    .from(evictionTeamChats)
    .where(eq(evictionTeamChats.caseId, id));
  expect(stored.referenceCiphertext).not.toContain(first.teamReference);
  expect(JSON.stringify(stored)).not.toMatch(/Personal case|PRIVATE ADDRESS|opaque-allo/);
  expect(JSON.stringify(await getCaseTeam(id, 'owner'))).not.toContain(first.teamReference);
  await expect(finalizeTeamOperation(first.operation.id, 'owner')).rejects.toThrow();
  await expect(readTeamOperation(first.operation.id, 'wrong')).rejects.toThrow();
  await expect(beginTeamOperation(id, 'stranger', { action: 'open' })).rejects.toThrow();
  snapshot = remote(first);
  await finalizeTeamOperation(first.operation.id, 'owner');
  expect((await readTeamOperation(first.operation.id, first.capability)).finalized).toBe(true);
  // The response from local commit/release can be lost. Reopening returns the same operation.
  expect((await beginTeamOperation(id, 'owner', { action: 'open' })).operation.id).toBe(
    first.operation.id,
  );
  expect((await finalizeTeamOperation(first.operation.id, 'owner')).finalized).toBe(true);
});
it('commits removal only after frozen matching Allo membership; failed and stale remote proofs leave access unchanged', async () => {
  const id = await fixture();
  await changeCollaborator({ caseId: id, actorOxyUserId: 'owner', oxyUserId: 'editor', add: true });
  const create = await beginTeamOperation(id, 'owner', { action: 'open' });
  snapshot = remote(create);
  await finalizeTeamOperation(create.operation.id, 'owner');
  snapshot.frozen = false;
  const remove = await beginTeamOperation(id, 'owner', { action: 'remove', oxyUserId: 'editor' });
  await expect(
    changeCollaborator({ caseId: id, actorOxyUserId: 'owner', oxyUserId: 'editor', add: false }),
  ).rejects.toThrow();
  await expect(finalizeTeamOperation(remove.operation.id, 'stranger')).rejects.toThrow();
  await expect(finalizeTeamOperation(remove.operation.id, 'owner')).rejects.toThrow();
  snapshot = remote(remove, ['owner', 'editor']);
  await expect(finalizeTeamOperation(remove.operation.id, 'owner')).rejects.toThrow();
  offline = true;
  await expect(finalizeTeamOperation(remove.operation.id, 'owner')).rejects.toMatchObject({
    code: 'NETWORK_ERROR',
    status: 0,
  });
  expect((await getCaseTeam(id, 'editor'))?.canEdit).toBe(true);
  const [pending] = await getDb()
    .select()
    .from(evictionTeamChatOperations)
    .where(eq(evictionTeamChatOperations.id, remove.operation.id));
  expect(pending.finalized).toBe(false);
  offline = false;
  snapshot = remote(remove);
  snapshot.frozen = false;
  await expect(finalizeTeamOperation(remove.operation.id, 'owner')).rejects.toThrow();
  snapshot.frozen = true;
  await finalizeTeamOperation(remove.operation.id, 'owner');
  expect(await getCaseTeam(id, 'editor')).toBeUndefined();
  expect(
    await getDb()
      .select()
      .from(evictionCaseCollaborators)
      .where(eq(evictionCaseCollaborators.caseId, id)),
  ).toHaveLength(0);
  expect((await finalizeTeamOperation(remove.operation.id, 'owner')).finalized).toBe(true);
});
