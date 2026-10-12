/**
 * The residential-proxy health check, and the cause-chain flattening that makes
 * its verdict readable in CloudWatch.
 *
 * TWO CLIENTS, TWO ERROR SHAPES. `createProxiedFetch` uses Bun's native
 * `fetch({ proxy })` under Bun and undici's `ProxyAgent` under Node, so the
 * worker's RUNTIME decides which shape a refused CONNECT arrives in:
 *
 *   undici: `TypeError: fetch failed` with the status only in the WORDING of an
 *           `AbortError` two `cause` levels down.
 *   Bun:    one `Error: Proxy refused to open a tunnel: 402 Payment Required`
 *           carrying `status`, `statusText` and `headers` as fields.
 *
 * Only undici's was understood once, so a Bun worker read an exhausted balance
 * as a `network` blip and the `listing-proxy-unusable` alarm could never fire.
 *
 * This file proves it twice:
 *
 *  - RECORDED FIXTURES of both shapes (captured from Bun 1.4.3 and undici 8.10.2
 *    tunnelling to a local server answering CONNECT with each status), run on
 *    either runtime, so the classifier is held to BOTH whichever one executes it.
 *  - A LIVE PROBE through the real `createProxiedFetch` against a local CONNECT
 *    server, which exercises whichever client the executing runtime selects —
 *    undici under jest on Node, Bun's native fetch under `bun test`. CI runs
 *    this file both ways, which is the point: a wording change in either client
 *    turns one of them red instead of silencing the alarm. Under jest on Node 22
 *    undici's fetch needs the host realm's `Symbol.dispose`, which
 *    `jest.setupHostRealmSymbols.cjs` provides; without it every live undici
 *    case dies in `removeAbortListener is not a function`, not in the code here.
 */

import { createServer, type Server, type Socket } from 'node:net';
import {
  checkResidentialProxy,
  describeProxyFailure,
  httpUseProxyFromEnv,
  parseResidentialProxyUrl,
  proxyCheckIntervalMinutesFromEnv,
  proxyHealthcheckUrlFromEnv,
  type ResidentialProxyConfig,
} from '@homiio/listing-providers';

/**
 * The real chain undici produces when a proxy refuses CONNECT, captured as
 * described in this file's header. `status` is what the proxy answered with.
 */
function undiciRefusedTunnelError(status: number): Error {
  const inner = Object.assign(new Error(`Proxy response (${status}) !== 200 when HTTP Tunneling`), {
    name: 'AbortError',
    code: 'UND_ERR_ABORTED',
  });
  const middle = Object.assign(new Error('Request was cancelled.'), { cause: inner });
  return Object.assign(new TypeError('fetch failed'), { cause: middle });
}

/** What Bun's native `fetch({ proxy })` throws for the same refusal. */
function bunRefusedTunnelError(status: number, statusText = 'Payment Required'): Error {
  return Object.assign(new Error(`Proxy refused to open a tunnel: ${status} ${statusText}`), {
    status,
    statusText,
    headers: new Headers({ 'content-type': 'text/plain' }),
  });
}

const REFUSED_TUNNEL_SHAPES = [
  ['undici (Node)', undiciRefusedTunnelError],
  ['Bun native fetch', bunRefusedTunnelError],
] as const;

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

  it("reads Bun's structured status, not its wording", () => {
    // Wording a regex would never match: only the fields can carry the status.
    const reworded = Object.assign(new Error('tunnel said no'), {
      status: 402,
      statusText: 'Payment Required',
      headers: new Headers(),
    });

    expect(describeProxyFailure(reworded).proxyStatus).toBe(402);
  });

  it("falls back to Bun's wording should the fields ever go missing", () => {
    const bare = new Error('Proxy refused to open a tunnel: 402 Payment Required');

    expect(describeProxyFailure(bare).proxyStatus).toBe(402);
  });

  it('does not mistake an upstream HTTP error with a numeric status for a refused tunnel', () => {
    // A provider error carrying the PORTAL's status is not the proxy's answer.
    const upstream = Object.assign(new Error('HTTP 403: Forbidden'), { status: 403 });

    expect(describeProxyFailure(upstream).proxyStatus).toBeUndefined();
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
  describe.each(REFUSED_TUNNEL_SHAPES)('a refusal as %s reports it', (_client, refusal) => {
    it('classifies a 402 as billing — the failure no retry can fix', async () => {
      const result = await checkResidentialProxy(PROXY, {
        fetchImpl: () => Promise.reject(refusal(402)),
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
        fetchImpl: () => Promise.reject(refusal(407)),
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('auth');
      expect(result.proxyStatus).toBe(407);
    });

    it.each([403, 502, 503])('classifies a %i as refused, not as a blip', async (status) => {
      const result = await checkResidentialProxy(PROXY, {
        fetchImpl: () => Promise.reject(refusal(status)),
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('refused');
      expect(result.proxyStatus).toBe(status);
    });
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

/**
 * A local stand-in for the residential proxy: answers every CONNECT with
 * `respond`, and records the request line so the test can prove the real
 * client tunnelled THROUGH it rather than failing somewhere before it.
 */
async function startConnectProxy(
  respond: (socket: Socket) => void,
): Promise<{ port: number; requestLines: string[]; close: () => Promise<void> }> {
  const requestLines: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    socket.once('data', (chunk) => {
      requestLines.push(chunk.toString('latin1').split('\r\n')[0] ?? '');
      respond(socket);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    port: address.port,
    requestLines,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function answerConnectWith(status: number, reason: string): (socket: Socket) => void {
  return (socket) => {
    const body = 'out of balance\n';
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\nContent-Type: text/plain\r\n` +
        `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
    );
  };
}

function proxyConfigAt(port: number): ResidentialProxyConfig {
  const config = parseResidentialProxyUrl(`http://user:pass@127.0.0.1:${port}`);
  if (!config) throw new Error('unparseable local proxy URL');
  return config;
}

const RUNTIME_CLIENT =
  typeof process.versions.bun === 'string' ? "Bun's native fetch" : "undici's ProxyAgent";

describe(`checkResidentialProxy through a real CONNECT proxy (${RUNTIME_CLIENT})`, () => {
  // No `fetchImpl`: this is `createProxiedFetch`, so the client under test is
  // the one this runtime would use in the worker. The target is never reached —
  // the proxy refuses the tunnel — so `.invalid` keeps it off the network.
  const TARGET = 'https://homiio-proxy-check.invalid/generate_204';

  it.each([
    [402, 'Payment Required', 'billing'],
    [407, 'Proxy Authentication Required', 'auth'],
    [403, 'Forbidden', 'refused'],
    [502, 'Bad Gateway', 'refused'],
    [503, 'Service Unavailable', 'refused'],
  ] as const)('a CONNECT answered %i %s is %s', async (status, reason, expected) => {
    const proxy = await startConnectProxy(answerConnectWith(status, reason));
    try {
      const result = await checkResidentialProxy(proxyConfigAt(proxy.port), {
        url: TARGET,
        timeoutMs: 10_000,
      });

      expect(proxy.requestLines[0]).toMatch(/^CONNECT homiio-proxy-check\.invalid:443 HTTP\/1\.1$/);
      expect(result).toMatchObject({ ok: false, reason: expected, proxyStatus: status });
    } finally {
      await proxy.close();
    }
  });

  it('a proxy that hangs up without answering is a network blip, with no status', async () => {
    const proxy = await startConnectProxy((socket) => socket.destroy());
    try {
      const result = await checkResidentialProxy(proxyConfigAt(proxy.port), {
        url: TARGET,
        timeoutMs: 10_000,
      });

      expect(proxy.requestLines).toHaveLength(1);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('network');
      expect(result.proxyStatus).toBeUndefined();
    } finally {
      await proxy.close();
    }
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
