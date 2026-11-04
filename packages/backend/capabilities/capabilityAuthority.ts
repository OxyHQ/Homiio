/** Own catalogue registration, live ticket checks and audit use workload identity.
 * Resource/account/operation checks remain live. OAuth clients keep their grants
 * and scope limits; own execution carries task/requester provenance (Oxy ADR 0049).
 */

import {
  type AppCapabilityCatalog,
  type CapabilityCatalogBinding,
  type CapabilityTicketClaims,
  auditResultSchema,
} from '@oxy.so/contracts';
import {
  type CapabilityTicketKeyResolver,
  createLiveCapabilityTicketVerifier,
  createOxyJwksKeyResolver,
} from '@oxy.so/core/server';
import { postOxyServiceJson, registerCapabilityCatalog } from '@oxy.so/mcp';

import config from '../config';
import { oxyService, oxyServiceTransport } from '../services/oxy';

type AuditResult = ReturnType<typeof auditResultSchema.parse>;
type Introspection = Awaited<ReturnType<typeof oxyService.agency.introspectCapabilityTicket>>;

export type TicketVerifier = (
  ticket: string,
  options: { signal: AbortSignal },
) => Promise<CapabilityTicketClaims>;

export interface TicketVerifierOptions {
  readonly issuer: string;
  readonly audience: string;
  /** The ticket's `kid` → Oxy's published key; `createOxyJwksKeyResolver` in production. */
  readonly resolvePublicKey: CapabilityTicketKeyResolver;
  readonly introspect: (ticket: string, options: { signal: AbortSignal }) => Promise<Introspection>;
}

/**
 * Signature, issuer, audience and TTL locally, then Oxy's LIVE decision — the
 * SDK's verifier, built once. Homiio adds one rule: a ticket Oxy introspects as
 * active but whose DECISION is not `allowed` (a revoked task or external grant)
 * is inactive, however valid its signature.
 */
export function createTicketVerifier(options: TicketVerifierOptions): TicketVerifier {
  return createLiveCapabilityTicketVerifier({
    issuer: options.issuer,
    audience: options.audience,
    resolvePublicKey: options.resolvePublicKey,
    introspect: async (ticket, request) => {
      const result = await options.introspect(ticket, request);
      return result.decision?.allowed === true ? result : { ...result, active: false };
    },
  });
}

export interface CapabilityAuditInput {
  readonly ticket: string;
  readonly result: AuditResult;
  readonly rollbackSupported: boolean;
  readonly idempotencyKey?: string;
}

export type CapabilityAuditor = (input: CapabilityAuditInput) => Promise<void>;

/** The verifier, auditor and registration bound to Homiio's Oxy authority. */
export function oxyCapabilityAuthority(catalog: AppCapabilityCatalog) {
  const oxyApiUrl = config.oxy.baseURL.replace(/\/+$/, '');

  const verifyTicket = createTicketVerifier({
    issuer: oxyApiUrl,
    audience: catalog.audience,
    resolvePublicKey: createOxyJwksKeyResolver({
      jwksUrl: `${oxyApiUrl}/capabilities/.well-known/jwks.json`,
    }),
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
      { transport: oxyServiceTransport, endpoint: `${oxyApiUrl}/capabilities/audit` },
    );
  };

  const register = (): Promise<CapabilityCatalogBinding> =>
    registerCapabilityCatalog(catalog, {
      transport: oxyServiceTransport,
      oxyApiUrl,
      timeoutMs: 15_000,
    });

  return { oxyApiUrl, verifyTicket, audit, register, transport: oxyServiceTransport };
}
