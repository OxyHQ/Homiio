import type { OAuthConsentResult } from '@oxyhq/services';
import {
  requestSindiConsentAndRetry,
  responseRequiresSindiConsent,
  SERVICE_ACTING_AS_UNAUTHORIZED,
  SINDI_NATIVE_CONSENT_REDIRECT_URI,
  SINDI_OAUTH_SCOPES,
  SINDI_WEB_CONSENT_REDIRECT_URI,
} from '@/hooks/sindiConsent';

function consentClient(result: OAuthConsentResult) {
  const requestOAuthConsent = jest.fn().mockResolvedValue(result);
  return { client: { requestOAuthConsent }, requestOAuthConsent };
}

describe('Sindi explicit OAuth consent', () => {
  it.each([
    ['web', SINDI_WEB_CONSENT_REDIRECT_URI],
    ['native', SINDI_NATIVE_CONSENT_REDIRECT_URI],
  ] as const)(
    'requests exact scopes and the exact %s redirect before retrying',
    async (platform, redirectUri) => {
      const { client, requestOAuthConsent } = consentClient({ status: 'consented' });
      const retry = jest.fn().mockResolvedValue(undefined);

      await expect(requestSindiConsentAndRetry(client, platform, retry)).resolves.toBe('consented');

      expect(requestOAuthConsent).toHaveBeenCalledTimes(1);
      expect(requestOAuthConsent).toHaveBeenCalledWith({
        redirectUri,
        scopes: SINDI_OAUTH_SCOPES,
      });
      expect(retry).toHaveBeenCalledTimes(1);
      expect(requestOAuthConsent.mock.invocationCallOrder[0]).toBeLessThan(
        retry.mock.invocationCallOrder[0],
      );
    },
  );

  it.each([
    { status: 'redirecting', via: 'redirect-mode' },
    { status: 'cancelled' },
    { status: 'timed-out' },
    { status: 'failed', reason: 'exchange-failed' },
    { status: 'unsupported', reason: 'unsupported-platform' },
  ] satisfies OAuthConsentResult[])('does not retry when OAuth returns %s', async (result) => {
    const { client } = consentClient(result);
    const retry = jest.fn().mockResolvedValue(undefined);

    await expect(requestSindiConsentAndRetry(client, 'web', retry)).resolves.toBe(result.status);
    expect(retry).not.toHaveBeenCalled();
  });

  it('does not retry when the OAuth request throws', async () => {
    const client = {
      requestOAuthConsent: jest.fn().mockRejectedValue(new Error('oauth unavailable')),
    };
    const retry = jest.fn().mockResolvedValue(undefined);

    await expect(requestSindiConsentAndRetry(client, 'web', retry)).rejects.toThrow(
      'oauth unavailable',
    );
    expect(retry).not.toHaveBeenCalled();
  });

  it('recognizes only the exact 403 acting-as code', async () => {
    await expect(
      responseRequiresSindiConsent(
        Response.json({ code: SERVICE_ACTING_AS_UNAUTHORIZED }, { status: 403 }),
      ),
    ).resolves.toBe(true);

    const rejected = [
      Response.json({ code: SERVICE_ACTING_AS_UNAUTHORIZED }, { status: 401 }),
      Response.json({ code: ` ${SERVICE_ACTING_AS_UNAUTHORIZED}` }, { status: 403 }),
      Response.json({ code: `${SERVICE_ACTING_AS_UNAUTHORIZED} ` }, { status: 403 }),
      Response.json({ error: SERVICE_ACTING_AS_UNAUTHORIZED }, { status: 403 }),
      Response.json([{ code: SERVICE_ACTING_AS_UNAUTHORIZED }], { status: 403 }),
      new Response('{', { status: 403 }),
    ];
    for (const response of rejected) {
      await expect(responseRequiresSindiConsent(response)).resolves.toBe(false);
    }
  });

  it('inspects a clone and leaves non-consent error bodies readable', async () => {
    const response = Response.json({ code: 'chat_unavailable' }, { status: 503 });

    await expect(responseRequiresSindiConsent(response)).resolves.toBe(false);
    await expect(response.json()).resolves.toEqual({ code: 'chat_unavailable' });
  });

  it('keeps exact scope order and rejects implicit scope/name fallbacks by contract', () => {
    expect(SINDI_OAUTH_SCOPES).toEqual(['inference:invoke', 'acting-as:offline']);
    expect(SINDI_WEB_CONSENT_REDIRECT_URI).toBe('https://homiio.com');
    expect(SINDI_NATIVE_CONSENT_REDIRECT_URI).toBe('homiio://oauth/consent');
    expect(SINDI_OAUTH_SCOPES).not.toContain('user:read');
  });
});
