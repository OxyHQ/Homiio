import {
  SINDI_OXY_APPLICATION_ID,
  SINDI_OXY_OWNER_ACCOUNT_ID,
  SINDI_OXY_SERVICE_CREDENTIAL_ID,
  assertCanonicalSindiServiceToken,
} from '../../services/oxy';

function token(payload: Record<string, unknown>): string {
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('Sindi service identity canary', () => {
  const canonical = {
    appId: SINDI_OXY_APPLICATION_ID,
    credentialId: SINDI_OXY_SERVICE_CREDENTIAL_ID,
    ownerAccountId: SINDI_OXY_OWNER_ACCOUNT_ID,
    scopes: ['inference:invoke', 'acting-as:offline'],
    exp: Math.floor(Date.now() / 1000) + 600,
  };

  it('accepts only the exact app, dedicated credential and project owner claims', () => {
    const value = token(canonical);
    expect(assertCanonicalSindiServiceToken(value)).toBe(value);
  });

  it.each([
    { ...canonical, appId: '6a2f851751b784a86fd0e923' },
    { ...canonical, credentialId: '01a0648e-ad3f-7608-aa8b-c07bfef6cf74' },
    { ...canonical, ownerAccountId: '69b2d3df5d12f58c9800d651' },
  ])('rejects a well-shaped but different attribution tuple: %j', (payload) => {
    expect(() => assertCanonicalSindiServiceToken(token(payload))).toThrow(
      'unexpected Sindi service identity',
    );
  });

  it.each([
    { ...canonical, scopes: ['inference:invoke'] },
    { ...canonical, scopes: ['inference:invoke', 'acting-as:offline', 'user:read'] },
    { ...canonical, exp: Math.floor(Date.now() / 1000) - 1 },
  ])('rejects correct ids with missing/extra scope or an expired token: %j', (payload) => {
    expect(() => assertCanonicalSindiServiceToken(token(payload))).toThrow(
      'unexpected Sindi service identity',
    );
  });
});
