import { afterAll, afterEach, expect, it } from 'bun:test';
import { OxyServer } from '@oxy.so/core/server';
import * as root from '../dist/index.js';
import { homiioTeamForOxyService, SERVICE_AUDIENCE } from '../dist/server.js';

const CAPABILITY = 'operation-capability';
const TOKEN = `e30.${Buffer.from(JSON.stringify({ type: 'service', authority: 'first_party', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')}.signature`;
const OPERATION = {
  id: 'operation-1',
  caseId: 'case-1',
  ownerAccountId: 'owner',
  action: 'open',
  targetAccountIds: ['member', 'owner'] as string[],
  teamReferenceHash: 'a'.repeat(64),
  finalized: false,
} as const;
const issuer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname.endsWith('/challenge'))
      return Response.json({ nonce: 'fixture' });
    const body = await req.json();
    expect(body.protocolVersion).toBe(2);
    expect(body.audience).toBe(SERVICE_AUDIENCE);
    return Response.json({ token: TOKEN, expiresIn: 300 });
  },
});
afterAll(() => issuer.stop(true));

const original = globalThis.fetch;
const servers: OxyServer[] = [];
afterEach(() => {
  globalThis.fetch = original;
  for (const oxy of servers.splice(0)) oxy.dispose();
});

/** A workload OxyServer whose Homiio requests are answered by `homiio`. */
function reader(homiio: (req: Request) => Response) {
  const requests: Request[] = [];
  const oxy = new OxyServer({
    baseURL: issuer.url.origin,
    workloadCredentials: async () => ({
      AccessKeyId: 'ASIA_FIXTURE',
      SecretAccessKey: 'fixture',
      Token: 'fixture-session',
    }),
  });
  servers.push(oxy);
  globalThis.fetch = (async (input, init) => {
    const req = new Request(input, init);
    if (new URL(req.url).hostname !== 'api.homiio.com') return original(input, init);
    requests.push(req);
    return homiio(req);
  }) as typeof fetch;
  return { team: homiioTeamForOxyService(oxy), requests };
}

it('offers no unauthenticated operation read: the root client only begins and finalizes', () => {
  expect(Object.getOwnPropertyNames(root.HomiioTeamClient.prototype)).not.toContain('read');
});

it('sends the service token AND the operation capability to the read route', async () => {
  const { team, requests } = reader(() => Response.json(OPERATION));
  expect(await team.read('operation-1', CAPABILITY)).toEqual(OPERATION);
  expect(requests).toHaveLength(1);
  const [req] = requests;
  expect(req.method).toBe('POST');
  expect(req.url).toBe('https://api.homiio.com/api/v1/team-chat/operations/read');
  expect(req.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
  expect(req.headers.get('x-homiio-team-operation')).toBe(CAPABILITY);
  expect(await req.json()).toEqual({ operationId: 'operation-1' });
});

it('throws for every refusal: unknown operation, missing service identity, outage', async () => {
  for (const status of [401, 403, 404, 503]) {
    const { team } = reader(() => new Response(null, { status }));
    await expect(team.read('operation-1', CAPABILITY)).rejects.toThrow('unavailable');
  }
});

it('refuses a response that is not a team operation', async () => {
  const { team } = reader(() => Response.json({ id: 1 }));
  await expect(team.read('operation-1', CAPABILITY)).rejects.toThrow();
});
