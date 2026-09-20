/**
 * The direct-first ladder: don't pay for residential bandwidth you don't need.
 *
 * The residential proxy is metered and search pages are enormous — 1.9 MB for a
 * Habitaclia results page, 1.0 MB for a Fotocasa one — and discovery walks up
 * to 100 of them per city, across 68 Spanish cities, four times a day. Routing
 * all of it through residential bandwidth is tens of gigabytes daily, which is
 * the most likely reason the account emptied itself and took the whole pipeline
 * down with it.
 *
 * Every assertion below is about the SAFETY of the saving rather than the
 * saving itself. A cheaper path that silently drops pages would be far worse
 * than an expensive one, so what is pinned is: a refused direct attempt always
 * falls back, the fallback returns the proxy's answer and not the refusal, and
 * nothing changes at all when no proxy is configured.
 */

import * as proxyModule from '@homiio/listing-providers/proxy';
import { createListingFetchRuntime } from '@homiio/listing-providers';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

const PROXY = { server: 'http://gw.example:1000', username: 'u', password: 'p' };

/**
 * Runtime whose proxied fetch is a stub, so a test can tell the two paths
 * apart: anything reaching `proxied` was billed, anything reaching `direct`
 * was free.
 */
function runtimeWith(options: {
  direct: (url: string) => { status: number; body: string } | Error;
  proxied: (url: string) => { status: number; body: string } | Error;
  withProxy?: boolean;
}) {
  const calls = { direct: 0, proxied: 0 };

  // `global.fetch` is the UNPROXIED path; the spy on `createProxiedFetch` is the
  // billed one. Counting them separately is the whole point — a test that only
  // checked the returned body could not tell a free request from a paid one.
  global.fetch = (async (url: RequestInfo | URL) => {
    calls.direct += 1;
    const result = options.direct(String(url));
    if (result instanceof Error) throw result;
    return new Response(result.body, { status: result.status });
  }) as typeof fetch;

  jest.spyOn(proxyModule, 'createProxiedFetch').mockResolvedValue((async (url: RequestInfo | URL) => {
    calls.proxied += 1;
    const result = options.proxied(String(url));
    if (result instanceof Error) throw result;
    return new Response(result.body, { status: result.status });
  }) as never);

  const { runtime } = createListingFetchRuntime(
    options.withProxy === false ? {} : { proxy: PROXY },
  );

  return { runtime, calls };
}

describe('fetchHttp direct-first ladder', () => {
  it('keeps a good direct response and never touches the proxy', async () => {
    process.env.LISTING_HTTP_DIRECT_FIRST = 'true';
    const { runtime, calls } = runtimeWith({
      direct: () => ({ status: 200, body: '<html>listings</html>' }),
      proxied: () => ({ status: 200, body: 'BILLED' }),
    });

    const result = await runtime.fetchHttp('https://portal.test/search');

    expect(result.body).toBe('<html>listings</html>');
    expect(calls.proxied).toBe(0);
  });

  it('falls back to the proxy on a refusing status, and returns the proxy answer', async () => {
    // The fallback must yield the PROXY's response. Returning the 403 would
    // turn a cost optimisation into silent data loss — every blocked page read
    // as an empty city, which is the exact failure this pipeline has been
    // repeatedly bitten by.
    process.env.LISTING_HTTP_DIRECT_FIRST = 'true';
    const { runtime, calls } = runtimeWith({
      direct: () => ({ status: 403, body: 'Access denied' }),
      proxied: () => ({ status: 200, body: '<html>listings</html>' }),
    });

    const result = await runtime.fetchHttp('https://portal.test/search');

    expect(result.status).toBe(200);
    expect(result.body).toBe('<html>listings</html>');
    expect(calls.direct).toBe(1);
    expect(calls.proxied).toBe(1);
  });

  it('falls back when the direct attempt throws', async () => {
    process.env.LISTING_HTTP_DIRECT_FIRST = 'true';
    const { runtime, calls } = runtimeWith({
      direct: () => new Error('ECONNRESET'),
      proxied: () => ({ status: 200, body: 'ok' }),
    });

    await expect(runtime.fetchHttp('https://portal.test/search')).resolves.toMatchObject({
      body: 'ok',
    });
    expect(calls.proxied).toBe(1);
  });

  it('falls back on a 200 that the caller recognises as a block page', async () => {
    // A soft block is invisible to a status check. Without the predicate the
    // cheap attempt would be accepted and the provider would escalate to the
    // BROWSER tier — more expensive than the proxy it was trying to avoid.
    process.env.LISTING_HTTP_DIRECT_FIRST = 'true';
    const { runtime, calls } = runtimeWith({
      direct: () => ({ status: 200, body: 'Pardon Our Interruption' }),
      proxied: () => ({ status: 200, body: '<html>listings</html>' }),
    });

    const result = await runtime.fetchHttp('https://portal.test/search', {
      isChallenge: (body) => body.includes('Pardon Our Interruption'),
    });

    expect(result.body).toBe('<html>listings</html>');
    expect(calls.proxied).toBe(1);
  });

  it('goes straight to the proxy when the ladder is switched off', async () => {
    process.env.LISTING_HTTP_DIRECT_FIRST = 'false';
    const { runtime, calls } = runtimeWith({
      direct: () => ({ status: 200, body: 'FREE' }),
      proxied: () => ({ status: 200, body: 'BILLED' }),
    });

    const result = await runtime.fetchHttp('https://portal.test/search');

    expect(result.body).toBe('BILLED');
    expect(calls.direct).toBe(0);
  });

  it('changes nothing when no proxy is configured', async () => {
    // Most markets run without one. The ladder must be inert there rather than
    // doubling every request.
    process.env.LISTING_HTTP_DIRECT_FIRST = 'true';
    const { runtime, calls } = runtimeWith({
      direct: () => ({ status: 200, body: 'FREE' }),
      proxied: () => ({ status: 200, body: 'BILLED' }),
      withProxy: false,
    });

    const result = await runtime.fetchHttp('https://portal.test/search');

    expect(result.body).toBe('FREE');
    expect(calls.direct).toBe(1);
    expect(calls.proxied).toBe(0);
  });
});
