import {
  SINDI_OXY_APPLICATION_ID,
  SINDI_OXY_OWNER_ACCOUNT_ID,
  SINDI_OXY_SERVICE_CREDENTIAL_ID,
  assertCanonicalSindiRequesterAssertion,
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

  it('pins the adopted Homiio project account Oxy actually signs, not the planned one', () => {
    expect(SINDI_OXY_OWNER_ACCOUNT_ID).toBe('6a50444ce8026582b949089d');
    expect(() =>
      assertCanonicalSindiServiceToken(
        token({ ...canonical, ownerAccountId: '01a0646a-078f-72ea-8759-86326484a7e0' }),
      ),
    ).toThrow('unexpected Sindi service identity');
  });

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

describe('Sindi requester assertion canary (ADR 0025)', () => {
  const agentId = '01a0646a-078f-7514-9800-9f43ceed7df8';
  const requesterAccountId = '6981c9178fcdefaf81988ffb';
  const claims = {
    iss: 'https://api.oxy.so',
    aud: 'alia',
    sub: requesterAccountId,
    jti: '6f1f0c52-6b0c-4a4f-9d44-6a4a5d3b2c11',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 120,
    azp: SINDI_OXY_APPLICATION_ID,
    cid: SINDI_OXY_SERVICE_CREDENTIAL_ID,
    agentId,
  };
  const grant = (payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    assertion: token(payload),
    expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
    requesterAccountId,
    agentId,
    ...overrides,
  });

  it('passes an assertion naming exactly Sindi, the Sindi credential and this requester', () => {
    const value = grant(claims);
    expect(assertCanonicalSindiRequesterAssertion(value, { requesterAccountId, agentId })).toBe(value.assertion);
  });

  it.each([
    ['another requester', grant({ ...claims, sub: '69b2d3df5d12f58c9800d651' })],
    ['a response naming another requester', grant(claims, { requesterAccountId: '69b2d3df5d12f58c9800d651' })],
    ['another agent', grant({ ...claims, agentId: '01a0646a-078f-7642-95ef-439952f4f3f9' })],
    ['another application', grant({ ...claims, azp: '6a2f851751b784a86fd0e934' })],
    ['another credential', grant({ ...claims, cid: '01a0648b-8d74-7240-adba-80707fdfdf9c' })],
    ['another audience', grant({ ...claims, aud: 'syra' })],
    ['an expired assertion', grant({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 })],
    ['no assertion at all', { requesterAccountId, agentId }],
  ])('refuses %s before it can leave Homiio', (_label, value) => {
    expect(() => assertCanonicalSindiRequesterAssertion(value, { requesterAccountId, agentId })).toThrow(
      'unexpected Sindi identity',
    );
  });
});
