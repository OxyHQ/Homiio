import { afterAll, expect, it } from 'bun:test';
import { OxyServer } from '@oxy.so/core/server';
import { homiioTeamForOxyService, SERVICE_AUDIENCE } from '../src/server';

const requests: Request[] = [];
const TOKEN = `e30.${Buffer.from(JSON.stringify({ type: 'service', authority: 'first_party', exp: Math.floor(Date.now() / 1000) + 300 })).toString('base64url')}.signature`;
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
it('uses shared receiver-bound workload transport while retaining resource capability denial', async () => {
  const original = globalThis.fetch;
  const oxy = new OxyServer({
    baseURL: issuer.url.origin,
    workloadCredentials: async () => ({
      AccessKeyId: 'ASIA_FIXTURE',
      SecretAccessKey: 'fixture',
      Token: 'fixture-session',
    }),
  });
  globalThis.fetch = (async (input, init) => {
    const req = new Request(input, init);
    if (new URL(req.url).hostname !== 'api.homiio.com') return original(input, init);
    requests.push(req);
    expect(req.headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(req.headers.get('x-homiio-team-operation')).toBe('revoked-capability');
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    await expect(
      homiioTeamForOxyService(oxy).read('operation', 'revoked-capability'),
    ).rejects.toThrow('unavailable');
    expect(requests).toHaveLength(1);
  } finally {
    oxy.dispose();
    globalThis.fetch = original;
  }
});
