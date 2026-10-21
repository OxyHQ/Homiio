/**
 * The residential-proxy health check, and the cause-chain flattening that makes
 * its verdict readable in CloudWatch.
 *
 * WHERE THE ERROR SHAPES COME FROM. undici reports a refused CONNECT as a bare
 * `TypeError: fetch failed` with the status buried two `cause` levels down, and
 * `describeProxyFailure` exists only to survive that exact shape. The chains
 * below are not invented: they were captured from a real undici ProxyAgent
 * tunnelling to a local TCP server that answered CONNECT with each status, and
 * transcribed here verbatim.
 *
 * They are a RECORDED FIXTURE rather than a live probe on purpose. Driving
 * undici's `fetch` inside this suite couples it to whichever runtime executes
 * the jest workers, and the two disagree: CI runs them under bun, where
 * `events.removeAbortListener` is missing and undici's fetch throws before
 * reaching any assertion, while a local run gets Node. A test that passes on
 * one machine and fails on the other measures the runtime, not this code.
 *
 * The cost is that an undici upgrade could change the wording without turning
 * anything red here. That is a real gap and the honest bound on what this file
 * proves: re-capture these strings when undici crosses a major, and note the
 * live pipeline surfaces the same failure through the `listing-proxy-unusable`
 * alarm regardless of how the message is worded.
 */

import {
  checkResidentialProxy,
  describeProxyFailure,
  httpUseProxyFromEnv,
  parseResidentialProxyUrl,
  proxyCheckIntervalMinutesFromEnv,
  proxyHealthcheckUrlFromEnv,
} from '@homiio/listing-providers';

/**
 * The real chain undici produces when a proxy refuses CONNECT, captured as
 * described in this file's header. `status` is what the proxy answered with.
 */
function refusedTunnelError(status: number): Error {
  const inner = Object.assign(
    new Error(`Proxy response (${status}) !== 200 when HTTP Tunneling`),
    { name: 'AbortError', code: 'UND_ERR_ABORTED' },
  );
  const middle = Object.assign(new Error('Request was cancelled.'), { cause: inner });
  return Object.assign(new TypeError('fetch failed'), { cause: middle });
}

/** What undici throws when the proxy host itself is unreachable — no status. */
function unreachableProxyError(): Error {
  const inner = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), {
    name: 'Error',
    code: 'ECONNREFUSED',
  });
  return Object.assign(new TypeError('fetch failed'), { cause: inner });
}

const PROXY = parseResidentialProxyUrl('http://user:pass@gw.example:1000')!;

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('describeProxyFailure', () => {
  it('lifts the CONNECT status out of a nested cause chain', () => {
    // Built by assigning `cause` rather than via `new Error(msg, { cause })`:
    // the constructor option needs lib ES2022 and this package does not target
    // it. The shape under test is identical either way.
    const inner = Object.assign(new Error('Proxy response (402) !== 200 when HTTP Tunneling'), {
      name: 'AbortError',
    });
    const middle = Object.assign(new Error('Request was cancelled.'), { cause: inner });
    const outer = Object.assign(new TypeError('fetch failed'), { cause: middle });

    const described = describeProxyFailure(outer);

    expect(described.proxyStatus).toBe(402);
    expect(described.chain[0]).toBe('TypeError: fetch failed');
    expect(described.chain).toHaveLength(3);
  });

  it('reports no status when the failure is not a refused tunnel', () => {
    const described = describeProxyFailure(new TypeError('fetch failed'));

    expect(described.proxyStatus).toBeUndefined();
    expect(described.chain).toEqual(['TypeError: fetch failed']);
  });

  it('terminates on a cyclic cause chain', () => {
    const looped: Error & { cause?: unknown } = new Error('round');
    looped.cause = looped;

    const described = describeProxyFailure(looped);

    expect(described.chain.length).toBeLessThanOrEqual(8);
  });

  it('survives a non-Error thrown value', () => {
    expect(describeProxyFailure('exploded').chain).toEqual(['exploded']);
  });
});

describe('checkResidentialProxy', () => {
  it('classifies a 402 as billing — the failure no retry can fix', async () => {
    const result = await checkResidentialProxy(PROXY, {
      fetchImpl: () => Promise.reject(refusedTunnelError(402)),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('billing');
    expect(result.proxyStatus).toBe(402);
    // The detail is what a responder reads at 3am; it must name the status.
    expect(result.detail).toContain('402');
  });

  it('classifies a 407 as auth', async () => {
    const result = await checkResidentialProxy(PROXY, {
      fetchImpl: () => Promise.reject(refusedTunnelError(407)),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('auth');
    expect(result.proxyStatus).toBe(407);
  });

  it('classifies any other refusal as refused, not as a blip', async () => {
    const result = await checkResidentialProxy(PROXY, {
      fetchImpl: () => Promise.reject(refusedTunnelError(403)),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('refused');
    expect(result.proxyStatus).toBe(403);
  });

  it('classifies an unreachable proxy as network, so a blip never pages anyone', async () => {
    const result = await checkResidentialProxy(PROXY, {
      fetchImpl: () => Promise.reject(unreachableProxyError()),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('network');
    expect(result.proxyStatus).toBeUndefined();
  });

  it('passes on ANY http response, because the tunnel is what is being tested', async () => {
    // A captcha, a redirect or a 500 from the far end all mean the proxy did its
    // job. Treating them as failures would let an unrelated third party's bad
    // day declare Homiio's proxy dead.
    for (const status of [200, 302, 429, 500]) {
      const result = await checkResidentialProxy(PROXY, {
        fetchImpl: async () => new Response('', { status }),
      });
      expect(result.ok).toBe(true);
    }
  });

  it('fails closed when the probe hangs past the timeout', async () => {
    const result = await checkResidentialProxy(PROXY, {
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });

    expect(result.ok).toBe(false);
  });
});

describe('proxy check configuration', () => {
  it('defaults the probe target and honours an override', () => {
    delete process.env.LISTING_PROXY_HEALTHCHECK_URL;
    expect(proxyHealthcheckUrlFromEnv()).toBe('https://www.google.com/generate_204');

    process.env.LISTING_PROXY_HEALTHCHECK_URL = 'https://example.test/ping';
    expect(proxyHealthcheckUrlFromEnv()).toBe('https://example.test/ping');
  });

  it('re-checks every 30 minutes by default, because a boot-only check would have missed the outage', () => {
    delete process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES;
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(30);
  });

  it('allows disabling with 0 and ignores nonsense', () => {
    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = '0';
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(0);

    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = 'soon';
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(30);

    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = '-5';
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(30);
  });

  it('refuses an interval that setInterval would turn into a probe flood', () => {
    // A JS timer delay is a signed 32-bit millisecond count. 40000 minutes is
    // 2.4e9 ms, which Node does not wait for — it fires on the next tick, so
    // "check every 27 days" becomes a check every millisecond, hammering the
    // proxy and burning the metered balance whose exhaustion started all this.
    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = '40000';
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(30);

    const maxSafe = Math.floor(2_147_483_647 / 60_000);
    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = String(maxSafe);
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(maxSafe);
    expect(maxSafe * 60_000).toBeLessThanOrEqual(2_147_483_647);

    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = String(maxSafe + 1);
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(30);
  });

  it('refuses values that parseInt would silently truncate', () => {
    // `parseInt` reads '30min' as 30 and '30.9' as 30, quietly accepting input
    // whose author meant something else.
    for (const raw of ['30min', '30.9', ' ', 'NaN', 'Infinity']) {
      process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = raw;
      expect(proxyCheckIntervalMinutesFromEnv()).toBe(30);
    }

    // Anything `Number` reads as a whole number in range IS accepted, however
    // it was spelled — 1e3 is 1000 minutes and 0x10 is 16. Asserted so the
    // boundary is a decision on the record rather than an accident of `Number`,
    // and so a future switch to a stricter parser has to face these two cases.
    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = '1e3';
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(1000);

    process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES = '0x10';
    expect(proxyCheckIntervalMinutesFromEnv()).toBe(16);
  });
});

describe('when the proxy is configured but nothing routes through it', () => {
  /**
   * The worker gates its checks on `httpUseProxyFromEnv() || runtime.fetchViaBrowser`.
   * This pins the half that is a pure env read; the other half is a property of
   * the constructed runtime, which `residentialProxy.test.ts` already covers.
   *
   * Why it matters: a proxy URL can be present for the optional media fallback
   * while every listing fetch goes direct. Alarming on a credential nothing
   * depends on is how an alert channel stops being read — the same reasoning
   * that keeps transient network failures silent.
   */
  it('does not treat a mere credential as proof the proxy is in use', () => {
    process.env.LISTING_RESIDENTIAL_PROXY_URL = 'http://user:pass@gw.example:823';

    delete process.env.LISTING_HTTP_USE_PROXY;
    expect(httpUseProxyFromEnv()).toBe(false);

    process.env.LISTING_HTTP_USE_PROXY = 'false';
    expect(httpUseProxyFromEnv()).toBe(false);

    process.env.LISTING_HTTP_USE_PROXY = 'true';
    expect(httpUseProxyFromEnv()).toBe(true);
  });
});
