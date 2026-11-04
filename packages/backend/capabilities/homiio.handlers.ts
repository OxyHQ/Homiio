/**
 * The catalogue's handlers, as both MCP lanes call them.
 *
 * Each tool's handler (`handlers/<domain>.ts`) calls a domain use case
 * (`domain/*`) — never HTTP, never an Express controller. This module adds the
 * three things every tool shares:
 *
 *  1. **The effective account**, taken from the verified principal and from
 *     nowhere else: a capability ticket's `resource.effectiveAccountId` on the
 *     internal lane, the OAuth connection's `activeAccountId` on the public
 *     one. Input never names an account, and there is no Express session here
 *     for `requireSessionOxyUserId` to read.
 *  2. **Idempotency.** An effectful tool called with an `Idempotency-Key` runs
 *     through `effectReceipts.ts`, so a retry replays the stored result. The
 *     internal transport already refuses a `required` tool without a key.
 *  3. **The wire shape.** The result passes through `renameWireIds` and a JSON
 *     round trip, the same two steps `res.json` applies behind
 *     `serializeWireIds`, so a tool returns byte-for-byte what the route
 *     returns. A domain refusal (`AppError`) becomes an MCP error result
 *     carrying its code and status; anything else is logged and answers a
 *     generic internal error, never its message.
 */

import type { CatalogTool, InvocationPrincipal } from '@oxy.so/contracts';
import { type ExternalMcpDocumentProof, readCapabilityAuthorization } from '@oxy.so/core/server';
import { extractBearerToken, type InvocationContext, type InvocationHandlers } from '@oxy.so/mcp';

import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import { renameWireIds } from '../middlewares/wireIds';
import type { DocumentRequester } from '../services/files/requester';
import { runWithEffectReceipt } from './effectReceipts';
import { HOMIIO_CAPABILITY_CATALOG } from './homiio.catalog';
import { HOMIIO_TOOL_HANDLERS } from './handlers/all';
import type { HomiioToolHandler, HomiioToolHandlers, ToolResult } from './handlers/context';

type ToolOutcome = Awaited<ReturnType<InvocationHandlers[string]>>;

/** The ONE place a lane's principal becomes the account a tool acts as. */
export function effectiveAccountOf(principal: InvocationPrincipal): string {
  return principal.kind === 'capability'
    ? principal.claims.resource.effectiveAccountId
    : principal.activeAccountId;
}

export function idempotencyKeyOf(context: InvocationContext): string | undefined {
  const header = context.request.requestInfo?.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length > 0 ? key : undefined;
}

type ExternalDocumentTool = ExternalMcpDocumentProof['tool'];

/** The OAuth-lane tools Oxy accepts a connection token for, to store a person's document. */
const EXTERNAL_DOCUMENT_TOOLS: Readonly<Record<ExternalDocumentTool, true>> = {
  uploadLeaseDocument: true,
  submitApplication: true,
  addApplicationDocuments: true,
};

function isExternalDocumentTool(name: string): name is ExternalDocumentTool {
  return Object.hasOwn(EXTERNAL_DOCUMENT_TOOLS, name);
}

/** The value of the request's single `Authorization` header, if it has exactly one. */
export function authorizationOf(context: InvocationContext): string | undefined {
  const header = context.request.requestInfo?.headers?.authorization;
  if (Array.isArray(header)) return header.length === 1 ? header[0] : undefined;
  return typeof header === 'string' ? header : undefined;
}

/**
 * The proof Oxy Files needs to store a document in the person's account, in the
 * credential each lane really carries: the internal lane's
 * `Authorization: Capability <ticket>` (the ticket is the requester proof), the
 * OAuth lane's `Bearer <connection token>` for the document tools Oxy accepts it
 * on. The transport verified both before the handler ran.
 */
function fileRequesterOf(
  context: InvocationContext,
  tool: CatalogTool,
): DocumentRequester | undefined {
  if (context.principal.kind === 'capability') {
    const ticket = readCapabilityAuthorization(authorizationOf(context));
    return ticket ? { kind: 'own', proof: { capabilityTicket: ticket } } : undefined;
  }
  const name = tool.name;
  if (!isExternalDocumentTool(name)) return undefined;
  const token = extractBearerToken({ authorization: authorizationOf(context) });
  return token ? { kind: 'external', proof: { connectionToken: token, tool: name } } : undefined;
}

/** What `res.json` would have put on the wire for this value. */
export function toWire(result: ToolResult): Record<string, unknown> {
  return JSON.parse(JSON.stringify(renameWireIds(result))) as Record<string, unknown>;
}

function errorOutcome(code: string, message: string, status: number): ToolOutcome {
  return {
    isError: true,
    content: [{ type: 'text', text: `${code}: ${message}` }],
    structuredContent: { error: { code, message, status } },
  };
}

function toolErrorOutcome(tool: CatalogTool, error: unknown): ToolOutcome {
  if (error instanceof AppError) {
    return errorOutcome(error.code ?? 'REQUEST_FAILED', error.message, error.statusCode);
  }
  logger.error('Capability tool failed', {
    tool: tool.name,
    error: error instanceof Error ? error.message : String(error),
  });
  return errorOutcome('INTERNAL_ERROR', 'The tool failed unexpectedly.', 500);
}

export function wrapHomiioToolHandler(
  tool: CatalogTool,
  handler: HomiioToolHandler,
): InvocationHandlers[string] {
  return async (input, context) => {
    const accountId = effectiveAccountOf(context.principal);
    const idempotencyKey = tool.effect === 'read' ? undefined : idempotencyKeyOf(context);
    try {
      if (tool.idempotency === 'required' && idempotencyKey === undefined) {
        throw new AppError(
          'This tool requires an Idempotency-Key',
          400,
          'IDEMPOTENCY_KEY_REQUIRED',
        );
      }
      const run = async () =>
        toWire(
          await handler(input, {
            accountId,
            tool,
            fileRequester: fileRequesterOf(context, tool),
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
          }),
        );
      const structuredContent =
        idempotencyKey === undefined
          ? await run()
          : await runWithEffectReceipt({ accountId, tool: tool.name, idempotencyKey, input }, run);
      return { structuredContent };
    } catch (error) {
      return toolErrorOutcome(tool, error);
    }
  };
}

/** Wrap every catalogue tool, refusing a tool without a handler or a stray handler. */
export function buildHomiioInvocationHandlers(
  tools: readonly CatalogTool[] = HOMIIO_CAPABILITY_CATALOG.tools,
  handlers: HomiioToolHandlers = HOMIIO_TOOL_HANDLERS,
): InvocationHandlers {
  const names = new Set(tools.map((tool) => tool.name));
  const stray = Object.keys(handlers).filter((name) => !names.has(name));
  if (stray.length > 0) throw new Error(`Handlers without a catalogue tool: ${stray.join(', ')}`);
  return Object.fromEntries(
    tools.map((tool) => {
      const handler = handlers[tool.name];
      if (!handler) throw new Error(`Catalogue tool without a handler: ${tool.name}`);
      return [tool.name, wrapHomiioToolHandler(tool, handler)];
    }),
  );
}

export const HOMIIO_INVOCATION_HANDLERS: InvocationHandlers = buildHomiioInvocationHandlers();
