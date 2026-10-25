/**
 * Call a catalogue tool the way both MCP lanes do, minus the transport.
 *
 * Runs `HOMIIO_INVOCATION_HANDLERS[name]` — the wrapped handler, so the
 * effective-account rule, idempotency receipts and the wire shape are all in
 * play — with a principal whose active account is `accountId`. The transport
 * itself (ticket verification, OAuth introspection, schema parsing) is covered
 * by `__tests__/capabilities/internalMcp.test.ts` and `externalMcp.test.ts`.
 */

import type { InvocationContext } from '@oxy.so/mcp';

import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { HOMIIO_INVOCATION_HANDLERS } from '../../capabilities/homiio.handlers';

export interface ToolCallOptions {
  readonly idempotencyKey?: string;
  /** Simulate a ticket rather than an OAuth connection. */
  readonly lane?: 'oauth' | 'capability';
}

export interface ToolCallResult {
  readonly isError: boolean;
  readonly structuredContent: Record<string, unknown>;
  /** `structuredContent.error` when the call failed. */
  readonly error?: { code: string; message: string; status: number };
}

function principalFor(accountId: string, lane: 'oauth' | 'capability', tool: string) {
  if (lane === 'oauth') {
    return {
      kind: 'oauth' as const,
      subject: accountId,
      clientId: 'test-client',
      originAccountId: accountId,
      activeAccountId: accountId,
      scopes: [],
      resource: 'https://mcp.homiio.com',
    };
  }
  return {
    kind: 'capability' as const,
    claims: {
      iss: 'https://api.oxy.so',
      aud: HOMIIO_CAPABILITY_CATALOG.audience,
      sub: 'agent-account',
      jti: 'test-ticket',
      iat: 1,
      exp: 2,
      runId: 'run',
      executionAuthorization: { kind: 'direct_request' as const, id: 'auth' },
      coordinator: { applicationId: 'alia', credentialId: 'cred' },
      requesterAccountId: accountId,
      ownerAccountId: accountId,
      actor: { type: 'agent' as const, accountId: 'agent-account' },
      resource: {
        appId: 'homiio',
        effectiveAccountId: accountId,
        resourceType: 'homiio_account',
        resourceId: accountId,
      },
      tool,
      capabilities: ['x'],
      limits: [],
      autonomy: 'autonomous' as const,
    },
  };
}

export async function callTool(
  name: string,
  accountId: string,
  input: Record<string, unknown> = {},
  options: ToolCallOptions = {},
): Promise<ToolCallResult> {
  const tool = HOMIIO_CAPABILITY_CATALOG.tools.find((entry) => entry.name === name);
  const handler = HOMIIO_INVOCATION_HANDLERS[name];
  if (!tool || !handler) throw new Error(`No catalogue tool named ${name}`);
  const headers: Record<string, string> = {
    authorization: `Bearer fixture-${options.lane ?? 'oauth'}-${accountId}`,
  };
  if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
  const context = {
    appId: 'homiio',
    tool,
    principal: principalFor(accountId, options.lane ?? 'oauth', name),
    request: { requestInfo: { headers }, signal: new AbortController().signal },
  } as unknown as InvocationContext;
  const result = await handler(input, context);
  const structuredContent = (result.structuredContent ?? {}) as Record<string, unknown>;
  return {
    isError: result.isError === true,
    structuredContent,
    ...(result.isError === true
      ? { error: structuredContent.error as ToolCallResult['error'] }
      : {}),
  };
}
