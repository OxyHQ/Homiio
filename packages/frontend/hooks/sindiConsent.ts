import type { OAuthConsentResult, OxyContextState } from '@oxyhq/services';

export const SERVICE_ACTING_AS_UNAUTHORIZED = 'SERVICE_ACTING_AS_UNAUTHORIZED' as const;

export const SINDI_OAUTH_SCOPES = ['inference:invoke', 'acting-as:offline'] as const;

export const SINDI_WEB_CONSENT_REDIRECT_URI = 'https://homiio.com' as const;
export const SINDI_NATIVE_CONSENT_REDIRECT_URI = 'homiio://oauth/consent' as const;

export type SindiConsentPlatform = 'web' | 'native';

export class SindiConsentRequiredError extends Error {
  readonly code = SERVICE_ACTING_AS_UNAUTHORIZED;

  constructor() {
    super('Sindi needs your permission to continue');
    this.name = 'SindiConsentRequiredError';
  }
}

export function consentRedirectUri(platform: SindiConsentPlatform): string {
  return platform === 'web' ? SINDI_WEB_CONSENT_REDIRECT_URI : SINDI_NATIVE_CONSENT_REDIRECT_URI;
}

/**
 * Starts consent only from the caller's explicit UI gesture. The failed chat
 * request is replayed exactly once, and only after Oxy reports consented.
 */
export async function requestSindiConsentAndRetry(
  client: Pick<OxyContextState, 'requestOAuthConsent'>,
  platform: SindiConsentPlatform,
  retry: () => Promise<unknown>,
): Promise<OAuthConsentResult['status']> {
  const result = await client.requestOAuthConsent({
    redirectUri: consentRedirectUri(platform),
    scopes: SINDI_OAUTH_SCOPES,
  });
  if (result.status === 'consented') await retry();
  return result.status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Match the backend's exact allowlisted condition; no trim or fallback. */
export async function responseRequiresSindiConsent(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const value = (await response.clone().json()) as unknown;
    return isRecord(value) && value.code === SERVICE_ACTING_AS_UNAUTHORIZED;
  } catch {
    return false;
  }
}
