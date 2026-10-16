/**
 * Mount both MCP lanes on the Express app, BEFORE every body parser.
 *
 * MCP owns its raw request body, its exact resource host and its auth
 * challenge, so nothing shared may run first: a JSON parser would consume the
 * body (`readJsonBody` refuses a drained stream), CORS and the session
 * middleware would reinterpret the request, and the API rate limiter keys on a
 * session these lanes do not have. They are never on `routes/public.ts` or the
 * authenticated router: their authority is the capability ticket or the OAuth
 * token, verified by the transport, not an Oxy session.
 *
 * `server.ts` starts the registration once the process is serving
 * (`lanes.internal.bound()`), so a failure is in the log the moment the task
 * starts, not when Alia first calls.
 */

import type { Express } from 'express';

import { oxyCapabilityAuthority } from './capabilityAuthority';
import { HOMIIO_CAPABILITY_CATALOG } from './homiio.catalog';
import { createHomiioInternalMcpReceiver } from './homiio-internal-mcp';
import { createHomiioMcpHttpService } from './homiio-mcp-http';

export function mountCapabilityLanes(
  app: Express,
  lanes: {
    internal: ReturnType<typeof createHomiioInternalMcpReceiver>;
    external: ReturnType<typeof createHomiioMcpHttpService>;
  },
): void {
  app.all(lanes.internal.path, (request, response) => {
    void lanes.internal.handle(request, response);
  });
  app.all(lanes.external.protectedResourceMetadataPath, (request, response) => {
    lanes.external.handleProtectedResourceMetadata(request, response);
  });
  app.all(lanes.external.mcpPath, (request, response) => {
    void lanes.external.handleMcp(request, response);
  });
}

/** The production lanes, bound to Homiio's Oxy authority. */
export function createCapabilityLanes() {
  const authority = oxyCapabilityAuthority(HOMIIO_CAPABILITY_CATALOG);
  const internal = createHomiioInternalMcpReceiver({
    register: authority.register,
    verifyTicket: authority.verifyTicket,
    audit: authority.audit,
  });
  return { internal, external: createHomiioMcpHttpService() };
}
