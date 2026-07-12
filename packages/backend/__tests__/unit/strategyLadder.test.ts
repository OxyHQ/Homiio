/**
 * Shared fetch-ladder test (pure — no DB, no real network).
 *
 * Verifies the plan's escalation + observability contract in one place, so no
 * provider re-implements it: the ladder walks HTTP → browser → managed, ESCALATES
 * past an anti-bot block, records one metric per attempt (success / 403 /
 * challenge / latency), and throws {@link ChallengeError} when every available
 * tier is blocked. `global.fetch` (the HTTP tier) is mocked; the browser/managed
 * tiers are the runtime's optional methods.
 */

import {
  fetchListingViaLadder,
  ChallengeError,
  HostRateLimiter,
  InMemoryProviderMetrics,
} from '@homiio/listing-providers';
import type { FetchRuntime } from '@homiio/listing-providers';

const BIG_OK_HTML = `<!doctype html><html><body>${'<p>ok</p>'.repeat(80)}</body></html>`;

/** A DataDome block served with HTTP 200 (captcha host + interstitial text). */
const DATADOME_200_WALL =
  `<!doctype html><html><head><title></title></head><body>` +
  `<h1>Please enable JS and disable any ad blocker to access this site</h1>` +
  `<script src="https://ct.captcha-delivery.com/c.js"></script>` +
  `</body></html>`;

/**
 * A good SERP that embeds a PASSIVE DataDome sensor + reCAPTCHA site key (exactly
 * what a live Otodom results page carries) — must classify `success`, never a
 * challenge, so the browser tier is never invoked.
 */
const GOOD_SERP_WITH_SENSOR =
  `<!doctype html><html><body>` +
  `<script>window.__cmp={"purposes":{"datadome":["C0001"]}};` +
  `window.__CONFIG__={"googleReCaptchaApiKey":"6Ld4ejwhatever"};</script>` +
  `${'<article data-cy="listing-item">flat</article>'.repeat(30)}` +
  `</body></html>`;

/** Minimal runtime; `fetchViaBrowser`/`fetchViaManaged` added per test. */
function baseRuntime(extra: Partial<FetchRuntime> = {}): FetchRuntime {
  return {
    fetchHttp: async (url, init) => {
      const response = await fetch(url, {
        signal: init?.signal,
        redirect: 'follow',
        headers: init?.headers,
      });
      return { status: response.status, body: await response.text() };
    },
    fetchJson: async () => ({}),
    fetchText: async () => '',
    loadFixture: async () => ({}) as never,
    ...extra,
  };
}

function mockFetch(status: number, body: string): void {
  (global as { fetch: unknown }).fetch = jest.fn(async () => ({
    status,
    text: async () => body,
  }));
}

const originalFetch = global.fetch;
afterEach(() => {
  (global as { fetch: typeof originalFetch }).fetch = originalFetch;
  jest.restoreAllMocks();
});

const noDelay = { rateLimiter: new HostRateLimiter(0), maxRetries: 0 };

describe('fetchListingViaLadder', () => {
  it('returns the HTTP tier and records a success metric on 200', async () => {
    mockFetch(200, BIG_OK_HTML);
    const metrics = new InMemoryProviderMetrics();
    const result = await fetchListingViaLadder(baseRuntime(), 'https://portal.example/x', {
      provider: 'idealista',
      metrics,
      ...noDelay,
    });

    expect(result.tier).toBe('http');
    expect(result.status).toBe(200);
    const snapshot = metrics.snapshot('idealista');
    expect(snapshot?.attempts).toBe(1);
    expect(snapshot?.success).toBe(1);
    expect(snapshot?.challengeRate).toBe(0);
  });

  it('escalates past a 403 to the browser tier and records both attempts', async () => {
    // Bare 403 (no anti-bot marker in the body) → classified `forbidden`, not `challenge`.
    mockFetch(403, 'Forbidden');
    const metrics = new InMemoryProviderMetrics();
    const runtime = baseRuntime({ fetchViaBrowser: async () => BIG_OK_HTML });

    const result = await fetchListingViaLadder(runtime, 'https://portal.example/y', {
      provider: 'fotocasa',
      metrics,
      ...noDelay,
    });

    expect(result.tier).toBe('browser');
    const snapshot = metrics.snapshot('fotocasa');
    expect(snapshot?.attempts).toBe(2);
    expect(snapshot?.forbidden).toBe(1);
    expect(snapshot?.success).toBe(1);
  });

  it('throws ChallengeError when every available tier is blocked', async () => {
    // HTTP is a bare 403 (forbidden); the browser tier then hits an anti-bot wall.
    mockFetch(403, 'Forbidden');
    const metrics = new InMemoryProviderMetrics();
    // Browser tier returns a DataDome challenge body → classified as challenge.
    const runtime = baseRuntime({ fetchViaBrowser: async () => DATADOME_200_WALL });

    await expect(
      fetchListingViaLadder(runtime, 'https://portal.example/z', {
        provider: 'idealista',
        metrics,
        ...noDelay,
      }),
    ).rejects.toBeInstanceOf(ChallengeError);

    const snapshot = metrics.snapshot('idealista');
    expect(snapshot?.forbidden).toBe(1);
    expect(snapshot?.challenge).toBe(1);
    expect(snapshot?.challengeRate).toBe(1);
  });

  it('escalates a DataDome 200 challenge (HTTP tier) to the browser tier', async () => {
    // The wall is served with HTTP 200 — only the anti-bot markers reveal it, so
    // the ladder must escalate to the (now-live) browser tier rather than ingest
    // it as an empty page. This is the otodom/GB regression the fix targets.
    mockFetch(200, DATADOME_200_WALL);
    const metrics = new InMemoryProviderMetrics();
    const browser = jest.fn(async () => BIG_OK_HTML);
    const runtime = baseRuntime({ fetchViaBrowser: browser });

    const result = await fetchListingViaLadder(runtime, 'https://otodom.pl/x', {
      provider: 'otodom',
      metrics,
      ...noDelay,
    });

    expect(result.tier).toBe('browser');
    expect(result.html).toBe(BIG_OK_HTML);
    expect(browser).toHaveBeenCalledTimes(1);
    const snapshot = metrics.snapshot('otodom');
    expect(snapshot?.challenge).toBe(1); // HTTP 200 wall classified as challenge
    expect(snapshot?.success).toBe(1); // browser tier cleared it
  });

  it('keeps a good SERP with a passive sensor + reCAPTCHA key on the HTTP tier', async () => {
    // A real Otodom SERP embeds a `"datadome"` consent category and a
    // `googleReCaptchaApiKey`; those must NOT be mistaken for a challenge, so the
    // slow browser tier is never touched.
    mockFetch(200, GOOD_SERP_WITH_SENSOR);
    const browser = jest.fn(async () => BIG_OK_HTML);
    const runtime = baseRuntime({ fetchViaBrowser: browser });

    const result = await fetchListingViaLadder(runtime, 'https://otodom.pl/y', {
      provider: 'otodom',
      ...noDelay,
    });

    expect(result.tier).toBe('http');
    expect(result.html).toBe(GOOD_SERP_WITH_SENSOR);
    expect(browser).not.toHaveBeenCalled();
  });

  it('throws ChallengeError when only HTTP is available and it is blocked', async () => {
    mockFetch(429, 'Too Many Requests');
    await expect(
      fetchListingViaLadder(baseRuntime(), 'https://portal.example/rl', {
        provider: 'fotocasa',
        ...noDelay,
      }),
    ).rejects.toBeInstanceOf(ChallengeError);
  });
});
