/**
 * The residential-proxy health check, and the cause-chain flattening that makes
 * its verdict readable in CloudWatch.
 *
 * The 402 cases run against a REAL TCP server speaking a real refused CONNECT,
 * not a hand-thrown error object. That matters more than it looks: the entire
 * point of `describeProxyFailure` is to survive the specific shape undici wraps
 * a tunnelling failure in, and a fabricated `new Error('Proxy response (402)')`
 * would pass while proving nothing about that shape. If undici ever restructures
 * its error chain, these tests fail here rather than in production six weeks
 * later.
 */

import net from 'node:net';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import {
  checkResidentialProxy,
  describeProxyFailure,
  parseResidentialProxyUrl,
  proxyCheckIntervalMinutesFromEnv,
  proxyHealthcheckUrlFromEnv,
} from '@homiio/listing-providers';

/**
 * A proxy that answers every CONNECT with one status and hangs up — which is
 * exactly what Evomi did for two months on an exhausted balance.
 */
function startRefusingProxy(status: number, reason: string): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\n\r\n`);
        socket.end();
      });
      socket.on('error', () => {});
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function proxyConfigFor(server: net.Server) {
  const address = server.address() as net.AddressInfo;
  const config = parseResidentialProxyUrl(`http://user:pass@127.0.0.1:${address.port}`);
  if (!config) throw new Error('test proxy URL failed to parse');
  return config;
}

/**
 * A `fetch` tunnelling through `server` on a REAL undici ProxyAgent — the same
 * dispatcher `createProxiedFetch` builds in production.
 *
 * Injected rather than letting `checkResidentialProxy` build its own only
 * because `createProxiedFetch` resolves undici through a dynamic import with a
 * variable specifier, which jest's module registry does not serve (it works
 * under plain node, and is the path the live worker fetches through today).
 * What these tests exist to pin — undici's real nested error chain surviving
 * `describeProxyFailure` — is fully exercised either way.
 */
function undiciFetchVia(port: number) {
  const dispatcher = new ProxyAgent(`http://user:pass@127.0.0.1:${port}`);
  const impl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    undiciFetch(input as string, { ...init, dispatcher } as never) as unknown as Promise<Response>;
  return { impl, close: () => dispatcher.close() };
}

function portOf(server: net.Server): number {
  return (server.address() as net.AddressInfo).port;
}

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
    const server = await startRefusingProxy(402, 'Payment Required');
    const proxied = undiciFetchVia(portOf(server));
    try {
      const result = await checkResidentialProxy(proxyConfigFor(server), {
        timeoutMs: 5000,
        fetchImpl: proxied.impl,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('billing');
      expect(result.proxyStatus).toBe(402);
      // The detail is what a responder reads at 3am; it must name the status.
      expect(result.detail).toContain('402');
    } finally {
      await proxied.close();
      await closeServer(server);
    }
  });

  it('classifies a 407 as auth', async () => {
    const server = await startRefusingProxy(407, 'Proxy Authentication Required');
    const proxied = undiciFetchVia(portOf(server));
    try {
      const result = await checkResidentialProxy(proxyConfigFor(server), {
        timeoutMs: 5000,
        fetchImpl: proxied.impl,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('auth');
      expect(result.proxyStatus).toBe(407);
    } finally {
      await proxied.close();
      await closeServer(server);
    }
  });

  it('classifies any other refusal as refused, not as a blip', async () => {
    const server = await startRefusingProxy(403, 'Forbidden');
    const proxied = undiciFetchVia(portOf(server));
    try {
      const result = await checkResidentialProxy(proxyConfigFor(server), {
        timeoutMs: 5000,
        fetchImpl: proxied.impl,
      });

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.reason).toBe('refused');
      expect(result.proxyStatus).toBe(403);
    } finally {
      await proxied.close();
      await closeServer(server);
    }
  });

  it('classifies an unreachable proxy as network, so a blip never pages anyone', async () => {
    const server = await startRefusingProxy(402, 'Payment Required');
    const config = proxyConfigFor(server);
    const proxied = undiciFetchVia(portOf(server));
    await closeServer(server);

    const result = await checkResidentialProxy(config, {
      timeoutMs: 5000,
      fetchImpl: proxied.impl,
    });
    await proxied.close();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('network');
    expect(result.proxyStatus).toBeUndefined();
  });

  it('passes on ANY http response, because the tunnel is what is being tested', async () => {
    // A captcha, a redirect or a 500 from the far end all mean the proxy did its
    // job. Treating them as failures would let an unrelated third party's bad
    // day declare Homiio's proxy dead.
    const config = parseResidentialProxyUrl('http://user:pass@proxy.invalid:1000')!;

    for (const status of [200, 302, 429, 500]) {
      const result = await checkResidentialProxy(config, {
        fetchImpl: async () => new Response('', { status }),
      });
      expect(result.ok).toBe(true);
    }
  });

  it('fails closed when the probe hangs past the timeout', async () => {
    const config = parseResidentialProxyUrl('http://user:pass@proxy.invalid:1000')!;

    const result = await checkResidentialProxy(config, {
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
});
