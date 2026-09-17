import { OxyServices } from '@oxy.so/core';
import config from '../config';

/**
 * The outbound, service-authenticated Oxy SDK instance owned by Homiio.
 *
 * This is deliberately separate from the session verifier in `server.ts`:
 * configuring service auth must not change the credential lane used to verify
 * incoming user sessions. A provider credential never reaches this process;
 * Kaana owns those in its encrypted database.
 */
export const oxyService = new OxyServices({ baseURL: config.oxy.baseURL });
const sindiOxyService = new OxyServices({ baseURL: config.oxy.baseURL });

export const SINDI_OXY_APPLICATION_ID = '6a2f851751b784a86fd0e922';
export const SINDI_OXY_SERVICE_CREDENTIAL_ID = '01a0648e-ad3f-7608-aa8b-c07bfef6cf73';
// The Homiio PROJECT account that owns application 6a2f851751b784a86fd0e922 —
// Oxy signs `ownerAccountId` from `applications.owner_account_id`. Oxy's
// native-product bootstrap ADOPTED this existing project rather than minting
// the planned `01a0646a-078f-72ea-…` account, so pinning the planned id made
// every Sindi token fail this canary in production. Source of truth:
// OxyHQServices `packages/api/src/config/nativeProductAgents.ts` (homiio.project.id).
export const SINDI_OXY_OWNER_ACCOUNT_ID = '6a50444ce8026582b949089d';

if (config.oxy.serviceApiKey && config.oxy.serviceApiSecret) {
  oxyService.configureServiceAuth(config.oxy.serviceApiKey, config.oxy.serviceApiSecret);
}

if (config.alia.sindiServiceApiKey && config.alia.sindiServiceApiSecret) {
  sindiOxyService.configureServiceAuth(
    config.alia.sindiServiceApiKey,
    config.alia.sindiServiceApiSecret,
  );
}

/**
 * Pin the signed attribution tuple returned by Oxy before the token can leave
 * Homiio. This is a defence-in-depth/canary check: Alia still verifies the JWT
 * signature itself, and the requester assertion that names the person.
 */
export function assertCanonicalSindiServiceToken(token: string): string {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) throw new Error('missing payload');
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      appId?: unknown;
      credentialId?: unknown;
      ownerAccountId?: unknown;
      scopes?: unknown;
      exp?: unknown;
    };
    const scopes = Array.isArray(payload.scopes) ? payload.scopes : [];
    const requiredScopes = ['inference:invoke', 'acting-as:offline'];
    if (
      payload.appId !== SINDI_OXY_APPLICATION_ID ||
      payload.credentialId !== SINDI_OXY_SERVICE_CREDENTIAL_ID ||
      payload.ownerAccountId !== SINDI_OXY_OWNER_ACCOUNT_ID ||
      scopes.length !== requiredScopes.length ||
      requiredScopes.some((scope) => !scopes.includes(scope)) ||
      typeof payload.exp !== 'number' ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw new Error('unexpected attribution tuple');
    }
    return token;
  } catch {
    throw new Error('Oxy minted a token for an unexpected Sindi service identity');
  }
}

export async function getCanonicalSindiServiceToken(): Promise<string> {
  return assertCanonicalSindiServiceToken(await sindiOxyService.getServiceToken());
}

/**
 * What Oxy answered a Sindi requester-assertion mint with, checked.
 *
 * ADR 0025 (OxyHQServices): a signed-in person reaches Sindi without any
 * consent grant because Homiio trades their LIVE session with Oxy for a
 * one-use, two-minute assertion naming Sindi. The person's bearer goes to Oxy
 * only — this is the one place the backend sends it anywhere — and Alia gets
 * the Sindi service token plus this assertion.
 *
 * The same canary discipline as the service token: before the assertion can
 * leave Homiio, its claims must name exactly the pinned application,
 * credential, agent and the requester this request verified. Alia and Oxy
 * verify it cryptographically and live; this catches a misconfiguration here.
 */
export function assertCanonicalSindiRequesterAssertion(
  grant: unknown,
  expected: { requesterAccountId: string; agentId: string },
): string {
  try {
    const record = grant as {
      assertion?: unknown;
      requesterAccountId?: unknown;
      agentId?: unknown;
    };
    if (typeof record?.assertion !== 'string') throw new Error('missing assertion');
    const payloadPart = record.assertion.split('.')[1];
    if (!payloadPart) throw new Error('missing payload');
    const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      aud?: unknown;
      sub?: unknown;
      azp?: unknown;
      cid?: unknown;
      agentId?: unknown;
      exp?: unknown;
    };
    if (
      record.requesterAccountId !== expected.requesterAccountId ||
      record.agentId !== expected.agentId ||
      claims.aud !== 'alia' ||
      claims.sub !== expected.requesterAccountId ||
      claims.azp !== SINDI_OXY_APPLICATION_ID ||
      claims.cid !== SINDI_OXY_SERVICE_CREDENTIAL_ID ||
      claims.agentId !== expected.agentId ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= Date.now()
    ) {
      throw new Error('unexpected requester assertion');
    }
    return record.assertion;
  } catch {
    throw new Error('Oxy minted a requester assertion for an unexpected Sindi identity');
  }
}

/** Why a mint did not produce an assertion, as far as chat needs to know. */
export class SindiRequesterAssertionError extends Error {
  constructor(readonly kind: 'refused' | 'unavailable') {
    super(kind === 'refused' ? 'Oxy refused the requester assertion' : 'Requester assertions are unavailable');
    this.name = 'SindiRequesterAssertionError';
  }
}

/**
 * Mint a Sindi requester assertion for the person on this request. One per
 * chat turn and never cached: Oxy consumes it on first use.
 */
export async function mintSindiRequesterAssertion(input: {
  subjectToken: string;
  requesterAccountId: string;
  agentId: string;
}): Promise<string> {
  let grant: unknown;
  try {
    grant = await sindiOxyService.mintRequesterAssertion({
      agentId: input.agentId,
      subjectToken: input.subjectToken,
    });
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    throw new SindiRequesterAssertionError(status === 401 || status === 403 ? 'refused' : 'unavailable');
  }
  return assertCanonicalSindiRequesterAssertion(grant, input);
}

