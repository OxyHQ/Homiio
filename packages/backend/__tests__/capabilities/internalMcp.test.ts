/**
 * `/_oxy/mcp` over real HTTP: what it refuses, and that what it admits acts as
 * the ticket's effective account and is audited.
 *
 * Tickets are signed here with a throwaway Ed25519 key through the same
 * `issueCapabilityTicket` Oxy uses, and verified by the production
 * `createTicketVerifier` with that key and a stubbed live introspection — so
 * every refusal below goes through the code that runs in ECS.
 */

import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import express, { type Express } from 'express';
import request from 'supertest';
import type { CapabilityCatalogBinding } from '@oxy.so/contracts';
import { issueCapabilityTicket } from '@oxy.so/core/server';
import { capabilityCatalogDigest } from '@oxy.so/mcp';
import { uuidv7 } from '@oxy.so/db';

import {
  createTicketVerifier,
  type CapabilityAuditInput,
} from '../../capabilities/capabilityAuthority';
import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import {
  createHomiioInternalMcp,
  createHomiioInternalMcpReceiver,
} from '../../capabilities/homiio-internal-mcp';
import { creditCheckoutSession, findBillingByOxyUserId } from '../../db/billing/billingRepository';

const ISSUER = 'https://api.oxy.so';
const HOST = 'api.homiio.com';
const KEY_ID = 'test-key';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const binding: CapabilityCatalogBinding = {
  registrationId: 'reg-homiio-test',
  version: HOMIIO_CAPABILITY_CATALOG.version,
  digest: capabilityCatalogDigest(HOMIIO_CAPABILITY_CATALOG),
};

type Introspect = Parameters<typeof createTicketVerifier>[0]['introspect'];

let introspection: 'allow' | 'deny' = 'allow';
const audits: CapabilityAuditInput[] = [];

function verifierFor(key: KeyObject = publicKey) {
  const introspect: Introspect = async (ticket) => {
    // The live check answers from Oxy's own state; here, from the test's.
    const claims = JSON.parse(Buffer.from(ticket.split('.')[1] ?? '', 'base64url').toString());
    return introspection === 'allow'
      ? { active: true, claims, decision: { allowed: true, reason: 'ceiling' } }
      : { active: true, claims, decision: { allowed: false, reason: 'revoked' } };
  };
  return createTicketVerifier({
    issuer: ISSUER,
    audience: HOMIIO_CAPABILITY_CATALOG.audience,
    resolveKey: async (kid) => (kid === KEY_ID ? key : undefined),
    introspect,
  });
}

function buildApp(): Express {
  const internal = createHomiioInternalMcp({
    binding,
    verifyTicket: verifierFor(),
    audit: async (input) => {
      audits.push(input);
    },
  });
  const app = express();
  app.all(internal.mcpPath, (req, res) => {
    void internal.handleMcp(req, res);
  });
  return app;
}

interface TicketOverrides {
  tool?: string;
  capabilities?: string[];
  audience?: string;
  account?: string;
  resourceId?: string;
  resourceType?: string;
  ttlSeconds?: number;
  now?: Date;
  catalog?: CapabilityCatalogBinding;
}

function ticketFor(account: string, overrides: TicketOverrides = {}): string {
  const tool = overrides.tool ?? 'readFileEntitlement';
  const catalogTool = HOMIIO_CAPABILITY_CATALOG.tools.find((entry) => entry.name === tool);
  const effective = overrides.account ?? account;
  return issueCapabilityTicket(
    {
      aud: overrides.audience ?? HOMIIO_CAPABILITY_CATALOG.audience,
      sub: 'agent-sindi',
      runId: 'run-1',
      executionAuthorization: { kind: 'direct_request', id: 'ea-1' },
      coordinator: { applicationId: 'alia', credentialId: 'alia-cred' },
      catalog: overrides.catalog ?? binding,
      requesterAccountId: account,
      ownerAccountId: account,
      actor: { type: 'agent', accountId: 'agent-sindi' },
      resource: {
        appId: 'homiio',
        effectiveAccountId: effective,
        resourceType: overrides.resourceType ?? 'homiio_account',
        resourceId: overrides.resourceId ?? effective,
      },
      tool,
      capabilities: overrides.capabilities ?? catalogTool?.requiredCapabilities ?? ['x'],
      limits: [],
      autonomy: 'execute_on_request',
    } as Parameters<typeof issueCapabilityTicket>[0],
    {
      privateKey,
      keyId: KEY_ID,
      issuer: ISSUER,
      ttlSeconds: overrides.ttlSeconds ?? 120,
      ...(overrides.now ? { now: overrides.now } : {}),
    },
  );
}

function callTool(
  app: Express,
  ticket: string | undefined,
  name: string,
  args: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  let req = request(app)
    .post('/_oxy/mcp')
    .set('Host', HOST)
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
  if (ticket) req = req.set('Authorization', `Capability ${ticket}`);
  for (const [key, value] of Object.entries(headers)) req = req.set(key, value);
  return req.send({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name, arguments: args },
  });
}

beforeEach(() => {
  introspection = 'allow';
  audits.length = 0;
});

describe('/_oxy/mcp refuses', () => {
  it('a request without a capability ticket (401)', async () => {
    const res = await callTool(buildApp(), undefined, 'readFileEntitlement');
    expect(res.status).toBe(401);
  });

  it('a request sent to another host (421)', async () => {
    const res = await request(buildApp())
      .post('/_oxy/mcp')
      .set('Host', 'mcp.homiio.com')
      .set('Authorization', `Capability ${ticketFor(uuidv7())}`)
      .send({});
    expect(res.status).toBe(421);
  });

  it('a ticket issued for another audience', async () => {
    const res = await callTool(
      buildApp(),
      ticketFor(uuidv7(), { audience: 'oxy-mention-api' }),
      'readFileEntitlement',
    );
    expect(res.status).toBe(403);
  });

  it('an expired ticket', async () => {
    const res = await callTool(
      buildApp(),
      ticketFor(uuidv7(), { now: new Date(Date.now() - 10 * 60 * 1000), ttlSeconds: 60 }),
      'readFileEntitlement',
    );
    expect(res.status).toBe(403);
  });

  it('a ticket Oxy no longer stands behind (live introspection)', async () => {
    introspection = 'deny';
    const res = await callTool(buildApp(), ticketFor(uuidv7()), 'readFileEntitlement');
    expect(res.status).toBe(403);
  });

  it('a ticket bound to another catalogue registration', async () => {
    const res = await callTool(
      buildApp(),
      ticketFor(uuidv7(), { catalog: { ...binding, digest: 'f'.repeat(64) } }),
      'readFileEntitlement',
    );
    expect(res.status).toBe(403);
  });

  it('a ticket signed by a key Oxy does not publish', async () => {
    const other = generateKeyPairSync('ed25519');
    const internal = createHomiioInternalMcp({
      binding,
      verifyTicket: verifierFor(other.publicKey),
      audit: async () => undefined,
    });
    const app = express();
    app.all(internal.mcpPath, (req, res) => {
      void internal.handleMcp(req, res);
    });
    const res = await callTool(app, ticketFor(uuidv7()), 'readFileEntitlement');
    expect(res.status).toBe(403);
  });

  it('a ticket whose resource is not the account root of its effective account', async () => {
    const res = await callTool(
      buildApp(),
      ticketFor(uuidv7(), { resourceId: uuidv7() }),
      'readFileEntitlement',
    );
    // Refused inside the tool call: the transport answers a JSON-RPC result
    // flagged as an error, and nothing ran.
    expect(res.body.result?.isError).toBe(true);
    expect(audits).toHaveLength(0);
  });

  it('a tool the ticket was not issued for', async () => {
    const account = uuidv7();
    const res = await callTool(
      buildApp(),
      ticketFor(account, { tool: 'readFileEntitlement' }),
      'consumeFileCredit',
      {},
      { 'Idempotency-Key': 'k-1' },
    );
    // Only the ticket's own tool is registered on this request's server.
    expect(res.body.result?.isError).toBe(true);
    expect(JSON.stringify(res.body.result.content)).toContain('not found');
    expect(await findBillingByOxyUserId(account)).toBeNull();
  });

  it('a required-idempotency tool without a key', async () => {
    const account = uuidv7();
    const res = await callTool(
      buildApp(),
      ticketFor(account, { tool: 'consumeFileCredit' }),
      'consumeFileCredit',
    );
    expect(res.body.result?.isError).toBe(true);
    expect(await findBillingByOxyUserId(account)).toBeNull();
  });
});

describe('/_oxy/mcp admits', () => {
  it('a live ticket, acting as its effective account, and audits it', async () => {
    const account = uuidv7();
    await creditCheckoutSession({
      oxyUserId: account,
      sessionId: `cs_${uuidv7()}`,
      product: 'file',
    });
    const res = await callTool(buildApp(), ticketFor(account), 'readFileEntitlement');
    expect(res.status).toBe(200);
    expect(res.body.result.isError).toBeFalsy();
    expect(res.body.result.structuredContent).toMatchObject({
      available: true,
      plusActive: false,
      fileCredits: 1,
    });
    expect(audits).toEqual([
      expect.objectContaining({ result: { status: 'succeeded' }, rollbackSupported: false }),
    ]);
  });

  it('spends a file credit once per idempotency key', async () => {
    const account = uuidv7();
    await creditCheckoutSession({
      oxyUserId: account,
      sessionId: `cs_${uuidv7()}`,
      product: 'file',
    });
    await creditCheckoutSession({
      oxyUserId: account,
      sessionId: `cs_${uuidv7()}`,
      product: 'file',
    });
    const app = buildApp();
    const ticket = ticketFor(account, { tool: 'consumeFileCredit' });
    const first = await callTool(
      app,
      ticket,
      'consumeFileCredit',
      {},
      { 'Idempotency-Key': 'turn-1' },
    );
    const retry = await callTool(
      app,
      ticket,
      'consumeFileCredit',
      {},
      { 'Idempotency-Key': 'turn-1' },
    );
    expect(first.body.result.structuredContent).toEqual({ consumed: true, remaining: 1 });
    expect(retry.body.result.structuredContent).toEqual({ consumed: true, remaining: 1 });
    expect((await findBillingByOxyUserId(account))?.fileCredits).toBe(1);
    expect(audits.map((entry) => entry.idempotencyKey)).toEqual(['turn-1', 'turn-1']);
  });

  it('answers NO_CREDITS as a tool error, audited as failed', async () => {
    const account = uuidv7();
    const res = await callTool(
      buildApp(),
      ticketFor(account, { tool: 'consumeFileCredit' }),
      'consumeFileCredit',
      {},
      { 'Idempotency-Key': 'turn-2' },
    );
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.structuredContent.error).toMatchObject({
      code: 'NO_CREDITS',
      status: 402,
    });
    expect(audits[0]?.result).toEqual({ status: 'failed', code: 'capability_execution_failed' });
  });
});

describe('the receiver', () => {
  it('registers once and answers 503 until a registration binds', async () => {
    let clock = 0;
    let refuse = true;
    let registrations = 0;
    const receiver = createHomiioInternalMcpReceiver({
      register: async () => {
        registrations += 1;
        if (refuse) throw new Error('insufficient_service_scope');
        return binding;
      },
      verifyTicket: verifierFor(),
      audit: async () => undefined,
      now: () => clock,
    });
    const app = express();
    app.all(receiver.path, (req, res) => {
      void receiver.handle(req, res);
    });

    const unbound = await callTool(app, ticketFor(uuidv7()), 'readFileEntitlement');
    expect(unbound.status).toBe(503);
    clock = 10_000;
    expect(await receiver.bound()).toBeUndefined();
    expect(registrations).toBe(1);

    refuse = false;
    clock = 30_001;
    const [first, second] = await Promise.all([receiver.bound(), receiver.bound()]);
    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(registrations).toBe(2);
    const bound = await callTool(app, ticketFor(uuidv7()), 'readFileEntitlement');
    expect(bound.status).toBe(200);
  });

  it('stays unbound when the registration is not this catalogue', async () => {
    const receiver = createHomiioInternalMcpReceiver({
      register: async () => ({ ...binding, digest: 'f'.repeat(64) }),
      verifyTicket: verifierFor(),
      audit: async () => undefined,
    });
    expect(await receiver.bound()).toBeUndefined();
  });
});
