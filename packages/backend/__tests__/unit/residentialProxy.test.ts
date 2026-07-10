/**
 * Residential-proxy wiring: asset blocking, Playwright proxy options, HTTP proxy
 * gating, and media ingest staying direct by default. No live portal hits.
 */

import * as proxyModule from '@homiio/listing-providers/proxy';
import {
  BLOCKED_BROWSER_RESOURCE_TYPES,
  PlaywrightBrowserPool,
  createListingFetchRuntime,
  createListingFetchRuntimeFromEnv,
  parseResidentialProxyUrl,
  toPlaywrightProxy,
  withStickySessionUsername,
  type PlaywrightModule,
} from '@homiio/listing-providers';
import {
  createRemoteImageFetcherFromEnv,
  fetchRemoteImage,
  fetchRemoteImageWithProxyFallback,
} from '../../services/ingestion/ExternalMediaIngest';

const PROXY_URL = 'http://mylogin:mypass@gw.dataimpulse.com:823';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function mockFetchResponse(body: string, extra?: { proxy?: string }) {
  return {
    ok: true,
    status: 200,
    text: async () => body,
    json: async () => JSON.parse(body.startsWith('{') ? body : '{}'),
    headers: { get: () => null },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    ...extra,
  };
}

afterEach(() => {
  (global as { fetch: typeof originalFetch }).fetch = originalFetch;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Proxy URL parsing                                                          */
/* -------------------------------------------------------------------------- */


describe('maskProxyUrl', () => {
  it('redacts userinfo from proxy URLs for safe logging', () => {
    expect(proxyModule.maskProxyUrl('http://user:pass@host:823')).toBe('http://***:***@host:823/');
  });

  it('returns empty string for missing input', () => {
    expect(proxyModule.maskProxyUrl(undefined)).toBe('');
  });
});

describe('parseResidentialProxyUrl', () => {
  it('parses user:pass@host:port into server + credentials', () => {
    const config = parseResidentialProxyUrl(PROXY_URL);
    expect(config).toEqual({
      server: 'http://gw.dataimpulse.com:823',
      username: 'mylogin',
      password: 'mypass',
    });
  });

  it('returns undefined for empty or credential-less URLs', () => {
    expect(parseResidentialProxyUrl(undefined)).toBeUndefined();
    expect(parseResidentialProxyUrl('http://gw.dataimpulse.com:823')).toBeUndefined();
  });
});

describe('withStickySessionUsername', () => {
  it('appends DataImpulse-compatible -session-<id> suffix', () => {
    expect(withStickySessionUsername('mylogin', 'abc123')).toBe('mylogin-session-abc123');
  });
});

describe('toPlaywrightProxy', () => {
  it('maps config to Playwright proxy options', () => {
    const config = parseResidentialProxyUrl(PROXY_URL);
    expect(config).toBeDefined();
    if (!config) return;
    expect(toPlaywrightProxy(config)).toEqual({
      server: 'http://gw.dataimpulse.com:823',
      username: 'mylogin',
      password: 'mypass',
    });
    expect(toPlaywrightProxy(config, 'sess1').username).toBe('mylogin-session-sess1');
  });
});

/* -------------------------------------------------------------------------- */
/* PlaywrightBrowserPool — asset blocking + proxy context                     */
/* -------------------------------------------------------------------------- */

interface FakeRouteCall {
  resourceType: string;
  action: 'abort' | 'continue';
}

interface FakeCounters {
  launches: number;
  contexts: Array<{ proxy?: { server: string; username?: string; password?: string } }>;
  closes: number;
  gotos: Array<{ url: string; waitUntil: string }>;
  routes: FakeRouteCall[];
}

function fakePlaywrightWithRoutes(html: string): { module: PlaywrightModule; counters: FakeCounters } {
  const counters: FakeCounters = {
    launches: 0,
    contexts: [],
    closes: 0,
    gotos: [],
    routes: [],
  };
  const module: PlaywrightModule = {
    chromium: {
      launch: async () => {
        counters.launches += 1;
        return {
          isConnected: () => true,
          close: async () => undefined,
          newContext: async (options) => {
            counters.contexts.push({ proxy: options.proxy });
            return {
              close: async () => {
                counters.closes += 1;
              },
              newPage: async () => ({
                route: async (_pattern: string, handler: (route: {
                  request: () => { resourceType: () => string };
                  abort: () => Promise<void>;
                  continue: () => Promise<void>;
                }) => void | Promise<void>) => {
                  for (const type of ['document', 'image', 'stylesheet', 'script', 'font']) {
                    let action: 'abort' | 'continue' = 'continue';
                    await handler({
                      request: () => ({ resourceType: () => type }),
                      abort: async () => {
                        action = 'abort';
                      },
                      continue: async () => {
                        action = 'continue';
                      },
                    });
                    counters.routes.push({ resourceType: type, action });
                  }
                },
                goto: async (url: string, opts: { waitUntil: string }) => {
                  counters.gotos.push({ url, waitUntil: opts.waitUntil });
                  return null;
                },
                content: async () => html,
              }),
            };
          },
        };
      },
    },
  };
  return { module, counters };
}

describe('PlaywrightBrowserPool — residential proxy + asset blocking', () => {
  it('passes proxy into context and aborts heavy asset types when blockAssets is on', async () => {
    const config = parseResidentialProxyUrl(PROXY_URL);
    expect(config).toBeDefined();
    if (!config) return;

    const { module, counters } = fakePlaywrightWithRoutes('<html>ok</html>');
    const pool = new PlaywrightBrowserPool(module, {
      proxy: config,
      blockAssets: true,
      stickyProxySession: true,
    });

    await pool.fetch('https://portal.example/listing/1');

    expect(counters.contexts).toHaveLength(1);
    expect(counters.contexts[0].proxy?.server).toBe('http://gw.dataimpulse.com:823');
    expect(counters.contexts[0].proxy?.username).toMatch(/^mylogin-session-/);
    expect(counters.gotos[0].waitUntil).toBe('domcontentloaded');

    const aborted = counters.routes
      .filter((r) => BLOCKED_BROWSER_RESOURCE_TYPES.has(r.resourceType))
      .map((r) => r.action);
    expect(aborted.every((a) => a === 'abort')).toBe(true);
    expect(counters.routes.find((r) => r.resourceType === 'document')?.action).toBe('continue');
    expect(counters.routes.find((r) => r.resourceType === 'script')?.action).toBe('continue');

    await pool.close();
  });

  it('uses load when asset blocking is off', async () => {
    const { module, counters } = fakePlaywrightWithRoutes('<html/>');
    const pool = new PlaywrightBrowserPool(module, { blockAssets: false });
    await pool.fetch('https://portal.example/x');
    expect(counters.gotos[0].waitUntil).toBe('load');
    await pool.close();
  });
});

/* -------------------------------------------------------------------------- */
/* HTTP runtime — proxy only when LISTING_HTTP_USE_PROXY=true                 */
/* -------------------------------------------------------------------------- */

describe('createListingFetchRuntimeFromEnv — HTTP proxy gating', () => {
  it('does not proxy HTTP fetches unless LISTING_HTTP_USE_PROXY=true', async () => {
    process.env.LISTING_RESIDENTIAL_PROXY_URL = PROXY_URL;
    delete process.env.LISTING_HTTP_USE_PROXY;
    process.env.LISTING_BROWSER_ENABLED = 'false';

    const calls: string[] = [];
    (global as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return mockFetchResponse('{"ok":true}');
    });

    const { runtime } = await createListingFetchRuntimeFromEnv();
    await runtime.fetchJson('https://portal.example/api');

    expect(calls).toEqual(['https://portal.example/api']);
  });

  it('routes HTTP through proxied fetch when LISTING_HTTP_USE_PROXY=true', async () => {
    process.env.LISTING_RESIDENTIAL_PROXY_URL = PROXY_URL;
    process.env.LISTING_HTTP_USE_PROXY = 'true';
    process.env.LISTING_BROWSER_ENABLED = 'false';

    const directFetch = jest.fn();
    (global as { fetch: typeof originalFetch }).fetch = directFetch;
    const proxiedCalls: string[] = [];
    const proxiedFetch = jest.fn(async (url: string) => {
      proxiedCalls.push(String(url));
      return mockFetchResponse('html');
    });
    jest.spyOn(proxyModule, 'createProxiedFetch').mockResolvedValue(proxiedFetch);

    const { runtime } = await createListingFetchRuntimeFromEnv();
    await runtime.fetchText('https://portal.example/page');

    expect(proxiedCalls).toEqual(['https://portal.example/page']);
    expect(directFetch).not.toHaveBeenCalled();
  });
});

describe('createListingFetchRuntime — explicit HTTP proxy option', () => {
  it('uses createProxiedFetch when proxy config is provided', async () => {
    const config = parseResidentialProxyUrl(PROXY_URL);
    expect(config).toBeDefined();
    if (!config) return;

    const proxiedFetch = jest.fn(async () => mockFetchResponse('ok'));
    jest.spyOn(proxyModule, 'createProxiedFetch').mockResolvedValue(proxiedFetch);

    const { runtime } = createListingFetchRuntime({ proxy: config });
    await runtime.fetchText('https://portal.example/x');

    expect(proxyModule.createProxiedFetch).toHaveBeenCalledWith(config);
    expect(proxiedFetch).toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* ExternalMediaIngest — direct by default, optional proxy fallback           */
/* -------------------------------------------------------------------------- */

describe('ExternalMediaIngest — media proxy policy', () => {
  it('uses direct fetch by default (no proxy env)', async () => {
    delete process.env.LISTING_RESIDENTIAL_PROXY_URL;
    delete process.env.LISTING_MEDIA_PROXY_FALLBACK;

    const fetcher = createRemoteImageFetcherFromEnv();
    expect(fetcher).toBe(fetchRemoteImage);

    const calls: Array<{ url: string; proxy?: string }> = [];
    (global as { fetch: unknown }).fetch = jest.fn(
      async (url: string, init?: RequestInit & { proxy?: string }) => {
        calls.push({ url, proxy: init?.proxy });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'image/png' },
          arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        };
      },
    );

    await fetcher('https://cdn.portal.example/photo.jpg');
    expect(calls).toHaveLength(1);
    expect(calls[0].proxy).toBeUndefined();
  });

  it('retries via proxy only after direct fetch fails when fallback is enabled', async () => {
    const config = parseResidentialProxyUrl(PROXY_URL);
    expect(config).toBeDefined();
    if (!config) return;

    let directAttempts = 0;
    (global as { fetch: unknown }).fetch = jest.fn(async () => {
      directAttempts += 1;
      return {
        ok: false,
        status: 403,
        headers: { get: () => null },
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });

    const proxiedFetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    }));
    jest.spyOn(proxyModule, 'createProxiedFetch').mockResolvedValue(proxiedFetch);

    const result = await fetchRemoteImageWithProxyFallback('https://cdn.portal.example/p.jpg', config);
    expect(result.mimetype).toBe('image/jpeg');
    expect(directAttempts).toBe(1);
    expect(proxiedFetch).toHaveBeenCalledTimes(1);
  });
});
