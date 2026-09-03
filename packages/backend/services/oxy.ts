import { OxyServices } from '@oxyhq/core';
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
export const SINDI_OXY_OWNER_ACCOUNT_ID = '01a0646a-078f-72ea-8759-86326484a7e0';

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
 * signature and delegation grant itself.
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
