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
import type { InvocationContext, InvocationHandlers } from '@oxy.so/mcp';

import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import { renameWireIds } from '../middlewares/wireIds';
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

function idempotencyKeyOf(context: InvocationContext): string | undefined {
  const header = context.request.requestInfo?.headers?.['idempotency-key'];
  const value = Array.isArray(header) ? (header.length === 1 ? header[0] : undefined) : header;
  const key = typeof value === 'string' ? value.trim() : '';
  return key.length > 0 ? key : undefined;
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
