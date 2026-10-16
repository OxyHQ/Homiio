/**
 * Homiio's side of Oxy's capability authority: verifying a ticket LIVE,
 * recording what a ticket did, and registering the catalogue.
 *
 * All three authenticate to Oxy as Homiio itself through `oxyService`
 * (`services/oxy.ts`): in ECS the task role attests (oxy ADR 0026) and no
 * secret exists anywhere; elsewhere a configured key pair does. The Homiio
 * application needs these Oxy service scopes, granted to the attested
 * workload binding:
 *
 *  - `catalogs:write` plus the application capability `catalog:homiio` —
 *    registering this catalogue (`POST /capabilities/catalogs/register`);
 *  - `capabilities:read` — live ticket introspection
 *    (`POST /capabilities/tickets/introspect`);
 *  - `capability-audit:write` — the audit record of every internal call
 *    (`POST /capabilities/audit`).
 *
 * The public `/mcp` lane's token introspection (`/auth/mcp/oauth/introspect`)
 * needs no scope beyond a live service principal: Oxy answers only for a
 * resource the calling application registered, which the catalogue
 * registration above is.
 */

import type { KeyObject } from 'node:crypto';
import {
  type AppCapabilityCatalog,
  type CapabilityCatalogBinding,
  type CapabilityTicketClaims,
  auditResultSchema,
} from '@oxy.so/contracts';
import { createLiveCapabilityTicketVerifier, createOxyJwksKeyResolver } from '@oxy.so/core/server';
import { postOxyServiceJson, registerCapabilityCatalog } from '@oxy.so/mcp';
import type { z } from 'zod';

import config from '../config';
import { oxyService } from '../services/oxy';

type AuditResult = z.infer<typeof auditResultSchema>;
type Introspection = Awaited<ReturnType<typeof oxyService.agency.introspectCapabilityTicket>>;

/** Tickets are compact JWS; anything longer is not one of Oxy's. */
const MAX_TICKET_LENGTH = 32_768;

export type TicketVerifier = (
  ticket: string,
  options: { signal: AbortSignal },
) => Promise<CapabilityTicketClaims>;

export interface TicketVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  readonly resolveKey: (keyId: string) => Promise<KeyObject | undefined>;
  readonly introspect: (ticket: string, options: { signal: AbortSignal }) => Promise<Introspection>;
}

function ticketKeyId(ticket: string): string {
  const header = JSON.parse(Buffer.from(ticket.split('.')[0] ?? '', 'base64url').toString('utf8'));
  const kid = (header as { kid?: unknown }).kid;
  if (typeof kid !== 'string' || kid.length === 0 || kid.length > 256) {
    throw new Error('Capability ticket has no key id');
  }
  return kid;
}

/**
 * Signature, issuer, audience and TTL locally, then Oxy's LIVE decision.
 *
 * The untrusted `kid` only selects which of Oxy's published keys to try; the
 * common verifier checks the original signed bytes. A ticket Oxy no longer
 * stands behind — revoked authority, a withdrawn ceiling — answers inactive
 * and is refused, however valid its signature.
 */
export function createTicketVerifier(options: TicketVerifierOptions): TicketVerifier {
  return async (ticket, { signal }) => {
    signal.throwIfAborted();
    if (ticket.length > MAX_TICKET_LENGTH) throw new Error('Capability ticket exceeds size bound');
    const kid = ticketKeyId(ticket);
    const key = await options.resolveKey(kid);
    const verify = createLiveCapabilityTicketVerifier({
      issuer: options.issuer,
      audience: options.audience,
      resolvePublicKey: (requested) => (requested === kid ? key : undefined),
      introspect: async (token, request) => {
        const result = await options.introspect(token, request);
        return result.decision?.allowed === true ? result : { ...result, active: false };
      },
    });
    return verify(ticket, { signal });
  };
}

export interface CapabilityAuditInput {
  readonly ticket: string;
  readonly result: AuditResult;
  readonly rollbackSupported: boolean;
  readonly idempotencyKey?: string;
}

export type CapabilityAuditor = (input: CapabilityAuditInput) => Promise<void>;

const serviceToken = {
  getServiceToken: () => oxyService.serviceToken(),
  invalidateServiceToken: () => oxyService.invalidateServiceToken(),
};

/** The verifier, auditor and registration bound to Homiio's Oxy authority. */
export function oxyCapabilityAuthority(catalog: AppCapabilityCatalog) {
  const oxyApiUrl = config.oxy.baseURL.replace(/\/+$/, '');
  const resolveKey = createOxyJwksKeyResolver({
    jwksUrl: `${oxyApiUrl}/capabilities/.well-known/jwks.json`,
  });

  const verifyTicket = createTicketVerifier({
    issuer: oxyApiUrl,
    audience: catalog.audience,
    resolveKey,
    introspect: (ticket, request) => oxyService.agency.introspectCapabilityTicket(ticket, request),
  });

  const audit: CapabilityAuditor = async (input) => {
    await postOxyServiceJson(
      {
        ticket: input.ticket,
        result: auditResultSchema.parse(input.result),
        rollback: { supported: input.rollbackSupported, attempted: false },
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      },
      { ...serviceToken, endpoint: `${oxyApiUrl}/capabilities/audit` },
    );
  };

  const register = (): Promise<CapabilityCatalogBinding> =>
    registerCapabilityCatalog(catalog, { ...serviceToken, oxyApiUrl, timeoutMs: 15_000 });

  return { oxyApiUrl, verifyTicket, audit, register, ...serviceToken };
}
