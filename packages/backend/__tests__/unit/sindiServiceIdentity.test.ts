import crypto from 'node:crypto';

import {
  SINDI_OXY_APPLICATION_ID,
  SINDI_OXY_OWNER_ACCOUNT_ID,
  SINDI_OXY_SERVICE_CREDENTIAL_ID,
  SINDI_OXY_TASK_ROLE_ARN,
  SINDI_OXY_WORKLOAD_ATTESTATION_ID,
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

  /**
   * The attestation path (oxy ADR 0026). The pair is gone from the task
   * definition and the same token arrives attributed to the task ROLE instead
   * of to a credential. Everything else about the token is unchanged.
   */
  describe('the same identity arriving by workload attestation', () => {
    const attested = { ...canonical, credentialId: SINDI_OXY_WORKLOAD_ATTESTATION_ID };

    /**
     * The handle is pinned by DERIVATION, from the same canonical subject and
     * the same formula Oxy mints it with — so this fails if either the role or
     * the formula moves, rather than the canary silently pinning a value the
     * mint no longer produces.
     */
    it('is the handle Oxy derives from the canonical task role, not one observed once', () => {
      const derived = `wl_${crypto
        .createHash('sha256')
        .update(SINDI_OXY_TASK_ROLE_ARN)
        .digest('hex')
        .slice(0, 24)}`;
      expect(SINDI_OXY_WORKLOAD_ATTESTATION_ID).toBe(derived);
      expect(SINDI_OXY_WORKLOAD_ATTESTATION_ID).toBe('wl_f28159178c5e993eb03b8cc1');
      expect(SINDI_OXY_TASK_ROLE_ARN).toBe('arn:aws:iam::237343248947:role/oxy-homiio-task');
    });

    it('accepts a token attributed to the Homiio task role', () => {
      const value = token(attested);
      expect(assertCanonicalSindiServiceToken(value)).toBe(value);
    });

    /**
     * The point of the canary, under the new path. A `wl_` prefix is not a
     * passphrase: only THIS role's handle is Sindi.
     */
    it.each([
      ['another service\'s task role', 'wl_d61be5cd068abb658ed4d193'],
      ['a handle one character off', 'wl_f28159178c5e993eb03b8cc2'],
      ['an unprefixed digest', 'f28159178c5e993eb03b8cc1'],
      ['the prefix alone', 'wl_'],
      ['an empty credential', ''],
    ])('refuses a token attested to %s', (_label, credentialId) => {
      expect(() => assertCanonicalSindiServiceToken(token({ ...canonical, credentialId }))).toThrow(
        'unexpected Sindi service identity',
      );
    });

    it.each([
      ['another application', { ...attested, appId: '6a2f851751b784a86fd0e923' }],
      ['another owner account', { ...attested, ownerAccountId: '69b2d3df5d12f58c9800d651' }],
      ['a dropped privileged scope', { ...attested, scopes: ['inference:invoke'] }],
      ['a widened scope set', { ...attested, scopes: ['inference:invoke', 'acting-as:offline', 'user:read'] }],
      ['an expired token', { ...attested, exp: Math.floor(Date.now() / 1000) - 1 }],
    ])('still enforces every other claim on an attested token: %s', (_label, payload) => {
      expect(() => assertCanonicalSindiServiceToken(token(payload))).toThrow(
        'unexpected Sindi service identity',
      );
    });
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

  it('passes an assertion whose cid is the Homiio task role handle', () => {
    const value = grant({ ...claims, cid: SINDI_OXY_WORKLOAD_ATTESTATION_ID });
    expect(assertCanonicalSindiRequesterAssertion(value, { requesterAccountId, agentId })).toBe(value.assertion);
  });

  it.each([
    ['another service\'s task role handle', grant({ ...claims, cid: 'wl_d61be5cd068abb658ed4d193' })],
    ['a handle one character off', grant({ ...claims, cid: 'wl_f28159178c5e993eb03b8cc2' })],
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
