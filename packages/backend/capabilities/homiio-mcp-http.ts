/**
 * `mcp.homiio.com/mcp` — Homiio's public MCP, for any OAuth client (Claude,
 * ChatGPT, …), served by the same process as the API.
 *
 * The shared transport owns the protocol: it answers 421 to a request sent to
 * any other host (so `api.homiio.com/mcp` is refused rather than served), 401
 * with `WWW-Authenticate: Bearer … resource_metadata="…"` to a request without
 * a live token, introspects every token with Oxy, and serves the
 * protected-resource metadata at `/.well-known/oauth-protected-resource`.
 *
 * Homiio owns the rest: the tools are the catalogue's `mcp`-exposed ones, the
 * handlers are the same ones `/_oxy/mcp` runs, and the account a tool acts as
 * is the connection's ACTIVE account — the member of a multi-account
 * connection Oxy selected — never one named in the input. Financial tools and
 * the feature-gate tools are internal-only and absent here.
 */

import { createCatalogMcpHttpServiceWithInvocationPrincipal } from '@oxy.so/mcp';

import config from '../config';
import { logger } from '../middlewares/logging';
import { oxyServiceTransport } from '../services/oxy';
import { HOMIIO_CAPABILITY_CATALOG } from './homiio.catalog';
import { HOMIIO_INVOCATION_HANDLERS } from './homiio.handlers';
import { HOMIIO_MCP_MAX_BODY_BYTES } from './homiio-internal-mcp';

const DEFAULT_ALLOWED_ORIGINS = ['https://chatgpt.com', 'https://claude.ai'] as const;

export function parseHomiioMcpAllowedOrigins(
  configured = process.env.HOMIIO_MCP_ALLOWED_ORIGINS,
): string[] {
  return [
    ...new Set([
      ...DEFAULT_ALLOWED_ORIGINS,
      ...(configured ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ]),
  ];
}

export interface HomiioMcpHttpServiceOptions {
  readonly authorizationServer?: string;
  readonly transport?: { fetch: typeof fetch };
}

export function createHomiioMcpHttpService(options: HomiioMcpHttpServiceOptions = {}) {
  return createCatalogMcpHttpServiceWithInvocationPrincipal({
    catalog: HOMIIO_CAPABILITY_CATALOG,
    handlers: HOMIIO_INVOCATION_HANDLERS,
    authorizationServer: options.authorizationServer ?? config.oxy.baseURL,
    transport: options.transport ?? oxyServiceTransport,
    allowedOrigins: parseHomiioMcpAllowedOrigins(),
    maxBodyBytes: HOMIIO_MCP_MAX_BODY_BYTES,
    authorize: async (_input, context) =>
      context.principal.kind === 'oauth'
        ? { allowed: true, effectiveAccountId: context.principal.activeAccountId }
        : { allowed: false, reason: 'oauth_required' },
    logger: {
      error(message, error) {
        logger.error(message, { error: error instanceof Error ? error.message : String(error) });
      },
    },
    serverName: 'homiio-mcp',
  });
}
