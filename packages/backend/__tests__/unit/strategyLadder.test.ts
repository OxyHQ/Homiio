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

/** Minimal runtime; `fetchViaBrowser`/`fetchViaManaged` added per test. */
function baseRuntime(extra: Partial<FetchRuntime> = {}): FetchRuntime {
  return {
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
    const runtime = baseRuntime({ fetchViaBrowser: async () => '<html>datadome captcha-delivery</html>' });

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
