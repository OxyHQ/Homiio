/**
 * Escalation-tier tests: the composed runtime, the ladder escalating all the way
 * to the managed tier, the managed-service client, and the Playwright pool — all
 * with mocks/fakes. NO real browser and NO live portal hits, so this runs in CI
 * without Playwright installed.
 */

import {
  createListingFetchRuntime,
  createManagedFetcher,
  createBrowserFetcher,
  ManagedFetcher,
  PlaywrightBrowserPool,
  PlaywrightSessionPool,
  fetchListingViaLadder,
  HostRateLimiter,
  InMemoryProviderMetrics,
  type PlaywrightModule,
  type UrlFetcher,
} from '@homiio/listing-providers';

const noDelay = { rateLimiter: new HostRateLimiter(0), maxRetries: 0 };
const BIG_OK_HTML = `<!doctype html><html><body>${'<p>ok</p>'.repeat(80)}</body></html>`;

const originalFetch = global.fetch;
afterEach(() => {
  (global as { fetch: typeof originalFetch }).fetch = originalFetch;
  jest.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* createListingFetchRuntime — tiers attach only when provided                */
/* -------------------------------------------------------------------------- */

describe('createListingFetchRuntime', () => {
  it('omits fetchViaBrowser/fetchViaManaged when no tiers are provided', () => {
    const { runtime } = createListingFetchRuntime();
    expect(runtime.fetchViaBrowser).toBeUndefined();
    expect(runtime.fetchViaManaged).toBeUndefined();
  });

  it('attaches only the provided tiers and shutdown closes them', async () => {
    const browserClose = jest.fn(async () => undefined);
    const managedClose = jest.fn(async () => undefined);
    const browser: UrlFetcher = { fetch: async () => '<browser/>', close: browserClose };
    const managed: UrlFetcher = { fetch: async () => '<managed/>', close: managedClose };

    const { runtime, shutdown } = createListingFetchRuntime({ browser, managed });
    expect(typeof runtime.fetchViaBrowser).toBe('function');
    expect(typeof runtime.fetchViaManaged).toBe('function');
    await expect(runtime.fetchViaBrowser?.('https://x/')).resolves.toBe('<browser/>');
    await expect(runtime.fetchViaManaged?.('https://x/')).resolves.toBe('<managed/>');

    await shutdown();
    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(managedClose).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Ladder escalates HTTP → browser → managed                                  */
/* -------------------------------------------------------------------------- */

describe('fetchListingViaLadder — managed rung', () => {
  it('escalates past a blocked HTTP + browser to the managed tier', async () => {
    // HTTP tier: bare 403 (forbidden). Browser tier: DataDome challenge body.
    (global as { fetch: unknown }).fetch = jest.fn(async () => ({ status: 403, text: async () => 'Forbidden' }));
    const runtime = createListingFetchRuntime({
      browser: { fetch: async () => '<html>datadome captcha-delivery</html>' },
      managed: { fetch: async () => BIG_OK_HTML },
    }).runtime;
    const metrics = new InMemoryProviderMetrics();

    const result = await fetchListingViaLadder(runtime, 'https://portal.example/deep', {
      provider: 'idealista',
      metrics,
      ...noDelay,
    });

    expect(result.tier).toBe('managed');
    const snapshot = metrics.snapshot('idealista');
    expect(snapshot?.attempts).toBe(3);
    expect(snapshot?.forbidden).toBe(1);
    expect(snapshot?.challenge).toBe(1);
    expect(snapshot?.success).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* ManagedFetcher — request shape + auth modes                                */
/* -------------------------------------------------------------------------- */

describe('ManagedFetcher', () => {
  it('sends the key as a header and the target as the url query param', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    (global as { fetch: unknown }).fetch = jest.fn(async (url: string, opts: { headers: Record<string, string> }) => {
      calls.push({ url, headers: opts.headers });
      return { ok: true, status: 200, text: async () => '<html>ok</html>' };
    });

    const fetcher = new ManagedFetcher({ endpoint: 'https://managed.test/fetch', apiKey: 'secret-key' });
    const html = await fetcher.fetch('https://portal.example/listing/1?x=2');

    expect(html).toBe('<html>ok</html>');
    const parsed = new URL(calls[0].url);
    expect(parsed.origin + parsed.pathname).toBe('https://managed.test/fetch');
    expect(parsed.searchParams.get('url')).toBe('https://portal.example/listing/1?x=2');
    expect(calls[0].headers['X-Api-Key']).toBe('secret-key');
  });

  it('sends the key as a query param when keyParam is configured', async () => {
    let requestedUrl = '';
    (global as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
      requestedUrl = url;
      return { ok: true, status: 200, text: async () => 'ok' };
    });

    const fetcher = new ManagedFetcher({
      endpoint: 'https://managed.test/',
      apiKey: 'k123',
      keyParam: 'api_key',
      urlParam: 'target',
      extraParams: { render: 'true' },
    });
    await fetcher.fetch('https://portal.example/x');

    const parsed = new URL(requestedUrl);
    expect(parsed.searchParams.get('target')).toBe('https://portal.example/x');
    expect(parsed.searchParams.get('api_key')).toBe('k123');
    expect(parsed.searchParams.get('render')).toBe('true');
  });

  it('throws on a non-2xx managed response', async () => {
    (global as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }));
    const fetcher = new ManagedFetcher({ endpoint: 'https://managed.test/fetch' });
    await expect(fetcher.fetch('https://portal.example/x')).rejects.toThrow(/Managed fetch failed/);
  });

  it('createManagedFetcher returns undefined without an endpoint', () => {
    expect(createManagedFetcher(undefined)).toBeUndefined();
    expect(createManagedFetcher({ endpoint: '' })).toBeUndefined();
    expect(createManagedFetcher({ endpoint: 'https://managed.test/' })).toBeInstanceOf(ManagedFetcher);
  });
});

/* -------------------------------------------------------------------------- */
/* PlaywrightBrowserPool — orchestration against a fake Playwright module      */
/* -------------------------------------------------------------------------- */

interface FakeCounters {
  launches: number;
  contexts: number;
  closes: number;
  gotos: string[];
}

function fakePlaywright(html: string): { module: PlaywrightModule; counters: FakeCounters } {
  const counters: FakeCounters = { launches: 0, contexts: 0, closes: 0, gotos: [] };
  const module: PlaywrightModule = {
    chromium: {
      launch: async () => {
        counters.launches += 1;
        return {
          isConnected: () => true,
          close: async () => undefined,
          newContext: async () => {
            counters.contexts += 1;
            return {
              close: async () => {
                counters.closes += 1;
              },
              newPage: async () => ({
                route: async () => undefined,
                goto: async (url: string) => {
                  counters.gotos.push(url);
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

describe('PlaywrightBrowserPool', () => {
  it('launches once, uses an isolated context per fetch, and closes each context', async () => {
    const { module, counters } = fakePlaywright('<html>rendered</html>');
    const pool = new PlaywrightBrowserPool(module, { maxConcurrency: 2 });

    const a = await pool.fetch('https://portal.example/a');
    const b = await pool.fetch('https://portal.example/b');

    expect(a).toBe('<html>rendered</html>');
    expect(b).toBe('<html>rendered</html>');
    expect(counters.launches).toBe(1); // shared browser
    expect(counters.contexts).toBe(2); // isolated per fetch
    expect(counters.closes).toBe(2); // each context torn down
    expect(counters.gotos).toEqual(['https://portal.example/a', 'https://portal.example/b']);

    await pool.close();
  });

  it('rejects fetch after close', async () => {
    const { module } = fakePlaywright('<html/>');
    const pool = new PlaywrightBrowserPool(module, {});
    await pool.close();
    await expect(pool.fetch('https://portal.example/x')).rejects.toThrow(/closed/);
  });
});

/* -------------------------------------------------------------------------- */
/* createBrowserFetcher — env/availability gating                             */
/* -------------------------------------------------------------------------- */

describe('createBrowserFetcher', () => {
  it('returns undefined when disabled', async () => {
    expect(await createBrowserFetcher({ enabled: false })).toBeUndefined();
  });

  it('returns a pool when an injected Playwright module is provided', async () => {
    const { module } = fakePlaywright('<html/>');
    const fetcher = await createBrowserFetcher({ enabled: true, playwright: module });
    expect(fetcher).toBeInstanceOf(PlaywrightBrowserPool);
  });

  it('returns undefined and logs when Playwright cannot be loaded', async () => {
    const logs: string[] = [];
    // Prefer an explicit miss: createBrowserFetcher with playwright:null is not
    // supported, so when the host has Playwright installed this may return a
    // pool. Assert the contract either way — missing → undefined + log; present → pool.
    const fetcher = await createBrowserFetcher({ enabled: true, onLog: (m) => logs.push(m) });
    if (fetcher === undefined) {
      expect(logs.some((m) => m.includes('Playwright'))).toBe(true);
    } else {
      expect(fetcher).toBeInstanceOf(PlaywrightBrowserPool);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Headed launch gating — the `headed` option flips Chromium's headless flag   */
/* for BOTH the browser-fetch pool and the warmed-session pool. Default OFF →   */
/* headless (current behaviour); true → headless:false (DataDome/Kasada tier).  */
/* -------------------------------------------------------------------------- */

/**
 * Structural view of the fake page the recording module hands back. Typed so the
 * launch/context literals stay excess-property clean against browser.ts's narrow
 * `PwPage`, while still carrying every method the session-pool warm path needs at
 * runtime (`url`/`waitForTimeout`/`request`/`evaluate`).
 */
interface RecordingPage {
  url(): string;
  goto(url: string, options: { timeout: number; waitUntil: string }): Promise<unknown>;
  content(): Promise<string>;
  waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  route(pattern: string, handler: (route: unknown) => void | Promise<void>): Promise<void>;
  request: {
    get(url: string, opts?: unknown): Promise<{ status(): number; text(): Promise<string> }>;
    post(url: string, opts?: unknown): Promise<{ status(): number; text(): Promise<string> }>;
  };
  evaluate(fn: unknown, arg: unknown): Promise<{ status: number; body: string }>;
}

// >512 bytes so warmBrowserPage does not treat it as an unresolved DataDome body,
// and carries the default content selector so the warm poll resolves immediately.
const WARM_HTML = `<html><body>${'x'.repeat(520)}<article class="item">ok</article></body></html>`;

function makeRecordingPage(): RecordingPage {
  const ok = async () => ({ status: () => 200, text: async () => '{"items":[]}' });
  return {
    url: () => 'https://portal.example/search/',
    goto: async () => undefined,
    content: async () => WARM_HTML,
    waitForSelector: async () => undefined,
    waitForTimeout: async () => undefined,
    route: async () => undefined,
    request: { get: ok, post: ok },
    evaluate: async () => ({ status: 200, body: '{}' }),
  };
}

/** A fake Playwright module that records the `headless` flag of every launch. */
function recordingPlaywright(): { module: PlaywrightModule; launchedHeadless: boolean[] } {
  const launchedHeadless: boolean[] = [];
  const module: PlaywrightModule = {
    chromium: {
      launch: async (options) => {
        launchedHeadless.push(options.headless);
        return {
          isConnected: () => true,
          close: async () => undefined,
          newContext: async () => ({
            close: async () => undefined,
            newPage: async () => makeRecordingPage(),
          }),
        };
      },
    },
  };
  return { module, launchedHeadless };
}

describe('PlaywrightBrowserPool — headed gating', () => {
  it('launches headless:false when headed is true', async () => {
    const { module, launchedHeadless } = recordingPlaywright();
    const pool = new PlaywrightBrowserPool(module, { headed: true });
    await pool.fetch('https://portal.example/a');
    expect(launchedHeadless).toEqual([false]);
    await pool.close();
  });

  it('launches headless:true when headed is false or unset', async () => {
    const unset = recordingPlaywright();
    const unsetPool = new PlaywrightBrowserPool(unset.module, {});
    await unsetPool.fetch('https://portal.example/a');
    expect(unset.launchedHeadless).toEqual([true]);
    await unsetPool.close();

    const explicit = recordingPlaywright();
    const explicitPool = new PlaywrightBrowserPool(explicit.module, { headed: false });
    await explicitPool.fetch('https://portal.example/a');
    expect(explicit.launchedHeadless).toEqual([true]);
    await explicitPool.close();
  });
});

describe('PlaywrightSessionPool — headed gating', () => {
  it('launches headless:false when headed is true', async () => {
    const { module, launchedHeadless } = recordingPlaywright();
    const pool = new PlaywrightSessionPool(module, { headed: true, challengeWaitMs: 1_000 });
    const session = await pool.openSession({ warmUrl: 'https://portal.example/search/' });
    expect(launchedHeadless).toEqual([false]);
    await session.close();
    await pool.close();
  });

  it('launches headless:true when headed is false or unset', async () => {
    const { module, launchedHeadless } = recordingPlaywright();
    const pool = new PlaywrightSessionPool(module, { challengeWaitMs: 1_000 });
    const session = await pool.openSession({ warmUrl: 'https://portal.example/search/' });
    expect(launchedHeadless).toEqual([true]);
    await session.close();
    await pool.close();
  });
});
