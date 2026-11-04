import { generateKeyPairSync, sign } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { accountActorChainFromSession } from '@oxy.so/contracts';
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
import { publicApiBodyErrorHandler, publicApiRouter } from '../../routes/publicApi';
import { HOMIIO_APPLICATION_ID, oxyService } from '../../services/oxy';
jest.mock('../../services/oxy', () => {
  const { OxyServer } = jest.requireActual('@oxy.so/core/server');
  const { HOMIIO_APPLICATION_ID } = jest.requireActual('../../services/oxy');
  const oxyService = new OxyServer({
    baseURL: 'https://fixture.oxy.test',
    workloadCredentials: async () => ({ AccessKeyId: 'fixture', SecretAccessKey: 'fixture' }),
    expectedAudience: `oxy-service:${HOMIIO_APPLICATION_ID}`,
  });
  jest
    .spyOn(oxyService.users, 'get')
    .mockImplementation(async (id: unknown) => ({ id: String(id) }));
  return { oxyService, HOMIIO_APPLICATION_ID };
});
/**
 * Oxy stand-in: workload tokens are shaped like Oxy's (EdDSA under a published
 * kid) so `oxyService.middleware.service()` verifies them for real, and each
 * minted token stays live in `/auth/resources/introspect`.
 */
const SERVICE_KID = 'homiio-fixture-key';
const serviceKeys = generateKeyPairSync('ed25519');
const liveServiceTokens = new Map<string, Record<string, unknown>>();
function mintServiceToken(audience: string): string {
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iat,
    exp: iat + 300,
    type: 'service',
    iss: 'oxy-auth',
    aud: audience,
    tier: 'internal',
    authority: 'first_party',
    appId: 'workload-fixture',
    appName: 'Workload fixture',
    credentialId: 'wl_fixture',
    ownerAccountId: 'fixture-owner',
    environment: 'development',
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'EdDSA', typ: 'JWT', kid: SERVICE_KID })}.${encode(claims)}`;
  const token = `${unsigned}.${sign(null, Buffer.from(unsigned), serviceKeys.privateKey).toString('base64url')}`;
  liveServiceTokens.set(token, {
    active: true,
    authority: 'first_party',
    applicationId: claims.appId,
    credentialId: claims.credentialId,
    accountId: claims.ownerAccountId,
    environment: claims.environment,
    audience,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  });
  return token;
}
function audienceOf(token: string | undefined): unknown {
  const payload = token?.replace(/^Bearer /, '').split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString() || '{}').aud;
}
/** A person's session bearer, validated by the fixture's session endpoint. */
const PERSON_BEARER = `e30.${Buffer.from(JSON.stringify({ type: 'user', userId: 'person', sessionId: 'person-session', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.fixture`;
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
      return Response.json({ token: mintServiceToken(body.audience ?? 'oxy-api'), expiresIn: 300 });
    }
    if (req.url === 'https://fixture.oxy.test/.well-known/jwks.json')
      return Response.json({
        keys: [
          {
            ...serviceKeys.publicKey.export({ format: 'jwk' }),
            kid: SERVICE_KID,
            alg: 'EdDSA',
            use: 'sig',
          },
        ],
      });
    if (req.url === 'https://fixture.oxy.test/auth/resources/introspect') {
      const receiver = req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
      if (!liveServiceTokens.has(receiver)) return Response.json({}, { status: 401 });
      const { token } = await req.json();
      return Response.json(liveServiceTokens.get(token) ?? { active: false });
    }
    if (req.url.startsWith('https://fixture.oxy.test/session/validate-header/'))
      return Response.json({
        valid: true,
        sessionId: 'person-session',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        lastActivity: new Date().toISOString(),
        user: { id: 'person', username: 'person', name: { displayName: 'person' } },
        actor: accountActorChainFromSession({ subjectAccountId: 'person' }),
      });
    expect(req.url).toBe('https://api.allo.you/v1/team-access/snapshot');
    expect(req.headers.get('x-allo-team-capability')).toHaveLength(43);
    expect(audienceOf(req.headers.get('authorization') ?? undefined)).toBe(
      'oxy-service:6a2f851751b784a86fd0e92b',
    );
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

it('reads an operation only for an Oxy service caller that also holds its capability', async () => {
  const id = await fixture();
  const op = await beginTeamOperation(id, 'owner', { action: 'open' });
  const api = express();
  api.use(express.json());
  api.use(publicApiBodyErrorHandler);
  api.use('/api/v1', publicApiRouter);
  const read = () => request(api).post('/api/v1/team-chat/operations/read');
  const body = { operationId: op.operation.id };
  // No service identity: refused before the capability is looked at.
  expect((await read().set('x-homiio-team-operation', op.capability).send(body)).status).toBe(401);
  // A person's session is not a service identity.
  expect(
    (
      await read()
        .set('Authorization', `Bearer ${PERSON_BEARER}`)
        .set('x-homiio-team-operation', op.capability)
        .send(body)
    ).status,
  ).toBe(403);
  // A genuine service token minted for another receiver is not Homiio's.
  const elsewhere = await oxyService.serviceTokenFor('oxy-service:6a2f851751b784a86fd0e92b');
  expect(
    (
      await read()
        .set('Authorization', `Bearer ${elsewhere}`)
        .set('x-homiio-team-operation', op.capability)
        .send(body)
    ).status,
  ).toBe(401);
  const token = await oxyService.serviceTokenFor(`oxy-service:${HOMIIO_APPLICATION_ID}`);
  // A service caller without the capability is answered as before.
  const missing = await read().set('Authorization', `Bearer ${token}`).send(body);
  expect(missing.status).toBe(404);
  const wrong = await read()
    .set('Authorization', `Bearer ${token}`)
    .set('x-homiio-team-operation', 'wrong')
    .send(body);
  expect(wrong.status).toBe(404);
  const ok = await read()
    .set('Authorization', `Bearer ${token}`)
    .set('x-homiio-team-operation', op.capability)
    .send(body);
  expect(ok.status).toBe(200);
  expect(ok.body).toEqual(await readTeamOperation(op.operation.id, op.capability));
});
