/**
 * `mcp.homiio.oxy.so/mcp` over real HTTP: the OAuth challenge, the host
 * check, the protected-resource metadata, which tools are public, and that a
 * call acts as the connection's ACTIVE account.
 *
 * Oxy's introspection is the injected `fetch`; everything after it is the
 * production service.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { uuidv7 } from '@oxy.so/db';

import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { createHomiioMcpHttpService } from '../../capabilities/homiio-mcp-http';
import { mountCapabilityLanes } from '../../capabilities/mount';
import { createHomiioInternalMcpReceiver } from '../../capabilities/homiio-internal-mcp';

const RESOURCE = 'https://mcp.homiio.oxy.so';
const HOST = 'mcp.homiio.oxy.so';
const ISSUER = 'https://api.oxy.so';
const METADATA_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;

/** The token Oxy answers for, and the connection it belongs to. */
let introspected: Record<string, unknown> | null = null;

const fetchStub: typeof fetch = async (input) => {
  const url = String(input);
  if (!url.endsWith('/auth/mcp/oauth/introspect')) throw new Error(`unexpected fetch ${url}`);
  return new Response(JSON.stringify(introspected ?? { active: false }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

function scopes(): string[] {
  return [
    ...new Set(
      HOMIIO_CAPABILITY_CATALOG.tools
        .filter((tool) => tool.exposure.includes('mcp'))
        .flatMap((tool) => tool.requiredCapabilities),
    ),
  ];
}

function liveToken(account: string, connection?: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  introspected = {
    active: true,
    iss: ISSUER,
    sub: account,
    aud: HOMIIO_CAPABILITY_CATALOG.audience,
    resource: RESOURCE,
    client_id: 'claude',
    scope: scopes().join(' '),
    jti: uuidv7(),
    iat: now,
    exp: now + 600,
    account_id: account,
    ...(connection ? { connection } : {}),
  };
}

function buildApp(): Express {
  const app = express();
  mountCapabilityLanes(app, {
    internal: createHomiioInternalMcpReceiver({
      register: async () => {
        throw new Error('not under test');
      },
      verifyTicket: async () => {
        throw new Error('not under test');
      },
      audit: async () => undefined,
    }),
    external: createHomiioMcpHttpService({
      authorizationServer: ISSUER,
      fetch: fetchStub,
      getServiceToken: async () => 'service-token',
    }),
  });
  // Anything a later middleware would do must never be reached by MCP.
  app.use(express.json());
  return app;
}

function rpc(app: Express, method: string, params: Record<string, unknown>, host = HOST) {
  return request(app)
    .post('/mcp')
    .set('Host', host)
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .set('Authorization', 'Bearer opaque-token')
    .send({ jsonrpc: '2.0', id: 1, method, params });
}

beforeEach(() => {
  introspected = null;
});

describe('mcp.homiio.oxy.so/mcp', () => {
  it('answers 401 with the protected-resource metadata URL when there is no token', async () => {
    const res = await request(buildApp())
      .post('/mcp')
      .set('Host', HOST)
      .set('Accept', 'application/json, text/event-stream')
      .send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain(`resource_metadata="${METADATA_URL}"`);
  });

  it('answers 401 for a token Oxy reports inactive', async () => {
    const res = await rpc(buildApp(), 'tools/list', {});
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
  });

  it('answers 421 when the request reaches another host, such as the API', async () => {
    liveToken(uuidv7());
    const res = await rpc(buildApp(), 'tools/list', {}, 'api.homiio.com');
    expect(res.status).toBe(421);
  });

  it('serves its protected-resource metadata on its own host only', async () => {
    const app = buildApp();
    const res = await request(app).get('/.well-known/oauth-protected-resource').set('Host', HOST);
    expect(res.status).toBe(200);
    expect(res.body.resource).toBe(RESOURCE);
    expect(res.body.authorization_servers).toEqual([ISSUER]);
    expect([...res.body.scopes_supported].sort()).toEqual(scopes().sort());

    const wrongHost = await request(app)
      .get('/.well-known/oauth-protected-resource')
      .set('Host', 'api.homiio.com');
    expect(wrongHost.status).toBe(421);
  });

  it('lists exactly the mcp-exposed tools: no finance, no feature gates', async () => {
    liveToken(uuidv7());
    const res = await rpc(buildApp(), 'tools/list', {});
    expect(res.status).toBe(200);
    const listed = (res.body.result.tools as { name: string }[]).map((tool) => tool.name).sort();
    const expected = HOMIIO_CAPABILITY_CATALOG.tools
      .filter((tool) => tool.exposure.includes('mcp'))
      .map((tool) => tool.name)
      .sort();
    expect(listed).toEqual(expected);
    expect(listed).not.toContain('readFileEntitlement');
    expect(listed).not.toContain('consumeFileCredit');
    for (const tool of HOMIIO_CAPABILITY_CATALOG.tools) {
      if (tool.effect === 'financial') expect(listed).not.toContain(tool.name);
    }
  });

  it('does not serve an internal-only tool', async () => {
    liveToken(uuidv7());
    const res = await rpc(buildApp(), 'tools/call', { name: 'consumeFileCredit', arguments: {} });
    expect(res.body.result?.isError).toBe(true);
  });
});

describe('acting as the connection’s active account', () => {
  it('serves the active member of a multi-account connection, not the token’s own', async () => {
    const origin = uuidv7();
    const active = uuidv7();
    liveToken(origin, {
      connection_id: uuidv7(),
      origin_account_id: origin,
      active_account_id: active,
      accounts: [
        { account_id: origin, is_origin: true, linked_at: new Date().toISOString() },
        { account_id: active, is_origin: false, linked_at: new Date().toISOString() },
      ],
    });
    const res = await rpc(buildApp(), 'tools/call', { name: 'getMyProfile', arguments: {} });
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeFalsy();
    expect(res.body.result.structuredContent.data.oxyUserId).toBe(active);
  });

  it('ignores an account named in the input', async () => {
    const account = uuidv7();
    liveToken(account);
    const res = await rpc(buildApp(), 'tools/call', {
      name: 'getMyProfile',
      arguments: { oxyUserId: uuidv7() },
    });
    // The schema refuses unknown input outright; nothing runs as anyone else.
    expect(res.body.result?.isError ?? res.body.error).toBeTruthy();
  });
});
