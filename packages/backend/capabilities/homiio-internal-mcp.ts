/**
 * `api.homiio.com/_oxy/mcp` — the catalogue's internal lane, for Alia.
 *
 * Every request carries `Authorization: Capability <ticket>`. The shared
 * transport (`createInternalCatalogMcpHttpService`) verifies the ticket before
 * it reads the body and again before the effect, and refuses one whose
 * audience, app, catalogue binding, tool, capabilities, resource or limits are
 * not this call's. Homiio adds:
 *
 *  - **live verification** (`capabilityAuthority.ts`): signature against
 *    Oxy's JWKS, then Oxy's introspection, so revoked authority stops the call;
 *  - **authorization**: the ticket's resource must be the ACCOUNT ROOT of its
 *    effective account (`homiio_account`, resource id = account id). The
 *    handler then acts as exactly that account (`homiio.handlers.ts`);
 *  - **audit**: each call's outcome is recorded with Oxy. Audit delivery never
 *    turns a committed effect into a failure — the receipt survives a retry;
 *  - for a READ, the ticket is verified once more before the answer leaves, so
 *    authority revoked while the read ran does not release its result.
 *
 * Bound to the catalogue registration THIS process obtains at startup
 * (`registerCapabilityCatalog`), never to a binding copied into config. Until
 * it binds the route answers 503 and a later request retries, so an Oxy outage
 * at boot cannot leave the lane dead for the task's life.
 */

import type { AppCapabilityCatalog, CapabilityCatalogBinding } from '@oxy.so/contracts';
import { createInternalCatalogMcpHttpService, type InvocationHandlers } from '@oxy.so/mcp';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { logger } from '../middlewares/logging';
import type { CapabilityAuditor, TicketVerifier } from './capabilityAuthority';
import { HOMIIO_CAPABILITY_CATALOG } from './homiio.catalog';
import { HOMIIO_INVOCATION_HANDLERS } from './homiio.handlers';

/** Base64 documents ride in tool input (applications, leases, maintenance). */
export const HOMIIO_MCP_MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface HomiioInternalMcpOptions {
  readonly binding: CapabilityCatalogBinding;
  readonly verifyTicket: TicketVerifier;
  readonly audit: CapabilityAuditor;
  readonly catalog?: AppCapabilityCatalog;
  readonly handlers?: InvocationHandlers;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value;
}

export function createHomiioInternalMcp(options: HomiioInternalMcpOptions) {
  const catalog = options.catalog ?? HOMIIO_CAPABILITY_CATALOG;
  const invocationHandlers = options.handlers ?? HOMIIO_INVOCATION_HANDLERS;

  const handlers: InvocationHandlers = Object.fromEntries(
    catalog.tools
      .filter((tool) => tool.exposure.includes('internal'))
      .map((tool) => {
        const handler = invocationHandlers[tool.name];
        if (!handler) throw new Error(`Internal catalogue tool without a handler: ${tool.name}`);
        return [
          tool.name,
          async (input, context) => {
            if (context.principal.kind !== 'capability') {
              throw new Error('Capability principal required');
            }
            const headers = context.request.requestInfo?.headers ?? {};
            const authorization = headerValue(
              headers.authorization as string | string[] | undefined,
            );
            const ticket = authorization?.replace(/^Capability\s+/i, '');
            if (!ticket || ticket === authorization) throw new Error('Verified ticket missing');
            const key = headerValue(headers['idempotency-key'] as string | string[] | undefined);
            const idempotencyKey = key?.trim() || undefined;

            const result = await handler(input, context);

            await options
              .audit({
                ticket,
                result: result.isError
                  ? { status: 'failed', code: 'capability_execution_failed' }
                  : { status: 'succeeded' },
                rollbackSupported: tool.rollback === 'supported',
                ...(idempotencyKey ? { idempotencyKey } : {}),
              })
              .catch((error: unknown) =>
                logger.warn('Capability audit delivery failed', {
                  tool: tool.name,
                  reason: error instanceof Error ? error.name : 'unknown',
                }),
              );
            if (tool.effect === 'read') {
              await options.verifyTicket(ticket, { signal: context.request.signal });
            }
            return result;
          },
        ];
      }),
  );

  return createInternalCatalogMcpHttpService({
    catalog,
    binding: options.binding,
    handlers,
    verifyTicket: options.verifyTicket,
    maxBodyBytes: HOMIIO_MCP_MAX_BODY_BYTES,
    // The input never picks the resource: every Homiio tool acts on the
    // ticket's own account root, and the transport refuses any other.
    resolveResource: (_input, context) => context.principal.claims.resource,
    authorize: async (_input, context) => {
      if (context.principal.kind !== 'capability') {
        return { allowed: false, reason: 'capability_required' };
      }
      const resource = context.principal.claims.resource;
      return resource.resourceType === catalog.accountResourceType &&
        resource.resourceId === resource.effectiveAccountId
        ? { allowed: true, effectiveAccountId: resource.effectiveAccountId }
        : { allowed: false, reason: 'account_resource_mismatch' };
    },
  });
}

type HomiioInternalMcp = ReturnType<typeof createHomiioInternalMcp>;

/** How long a failed registration waits before the next request retries it. */
const REGISTRATION_RETRY_MS = 30_000;

export interface HomiioInternalMcpReceiverOptions {
  readonly register: () => Promise<CapabilityCatalogBinding>;
  readonly verifyTicket: TicketVerifier;
  readonly audit: CapabilityAuditor;
  readonly now?: () => number;
}

/** `/_oxy/mcp`, bound once to this process's catalogue registration. */
export function createHomiioInternalMcpReceiver(options: HomiioInternalMcpReceiverOptions) {
  const now = options.now ?? Date.now;
  let service: HomiioInternalMcp | undefined;
  let pending: Promise<HomiioInternalMcp | undefined> | undefined;
  let retryAt = 0;

  const bound = (): Promise<HomiioInternalMcp | undefined> => {
    if (service) return Promise.resolve(service);
    if (pending) return pending;
    if (now() < retryAt) return Promise.resolve(undefined);
    pending = options
      .register()
      .then((binding) => {
        service = createHomiioInternalMcp({
          binding,
          verifyTicket: options.verifyTicket,
          audit: options.audit,
        });
        logger.info('Homiio internal MCP bound to its catalogue registration', {
          registrationId: binding.registrationId,
          version: binding.version,
        });
        return service;
      })
      .catch((error: unknown) => {
        retryAt = now() + REGISTRATION_RETRY_MS;
        logger.error('Homiio catalogue registration failed; /_oxy/mcp answers 503 until it binds', {
          reason: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  return {
    path: '/_oxy/mcp' as const,
    bound,
    async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
      const internal = await bound();
      if (!internal) {
        request.resume();
        response.statusCode = 503;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Retry-After', String(REGISTRATION_RETRY_MS / 1000));
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Capability catalogue is not registered yet.' },
            id: null,
          }),
        );
        return;
      }
      await internal.handleMcp(request, response);
    },
  };
}
