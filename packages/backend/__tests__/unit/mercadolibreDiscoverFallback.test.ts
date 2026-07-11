/**
 * MercadoLibre discover HTTP fallback (AR / MX).
 *
 * Regression for the prod symptom "enabled provider ingests ZERO with no error
 * / no skip logs". The shared `createMercadolibreProvider.discover` preferred a
 * warm browser session and, when the browser tier was present-but-degraded
 * (prod's broken residential-proxy auth) OR returned a challenge, it yielded
 * zero refs and NEVER fell back to the HTTP ladder — even for AR/MX where cold
 * HTTP is a verified path (`requireBrowserSession: false`).
 *
 * These tests use REAL captured cold-HTTP SERP markup (2026-07, `poly-card`
 * anchors, no `__PRELOADED_STATE__`) to prove:
 *   1. the discover parser still resolves refs against current markup, and
 *   2. discover falls back to the HTTP ladder when the browser session throws.
 * A `requireBrowserSession: true` provider (PE) must NOT fall back.
 */

import {
  MercadolibreArProvider,
  MercadolibreMxProvider,
  MercadolibrePeProvider,
  parseMercadolibreArSearch,
  parseMercadolibreMxSearch,
  MERCADOLIBRE_AR_FIXTURE_LIVE_SERP_HTML,
  MERCADOLIBRE_MX_FIXTURE_LIVE_SERP_HTML,
  type DiscoverJob,
  type ExternalListingRef,
  type FetchHttpResult,
  type FetchRuntime,
} from '@homiio/listing-providers';

/**
 * Minimal runtime whose `fetchHttp` returns `body` and whose (optional)
 * `openBrowserSession` rejects — simulating a degraded browser tier (prod's
 * `ERR_PROXY_AUTH_UNSUPPORTED`). `fetchViaBrowser` / `fetchViaManaged` are absent
 * so the shared ladder only exercises the HTTP tier.
 */
function makeRuntime(body: string, withBrowser: boolean): FetchRuntime {
  const runtime: FetchRuntime = {
    fetchHttp: (): Promise<FetchHttpResult> => Promise.resolve({ status: 200, body }),
    fetchJson: <T = unknown>(): Promise<T> => Promise.reject(new Error('fetchJson unused')),
    fetchText: (): Promise<string> => Promise.resolve(body),
    loadFixture: <T = unknown>(): Promise<T> => Promise.reject(new Error('no fixtures')),
  };
  if (withBrowser) {
    runtime.openBrowserSession = () => Promise.reject(new Error('ERR_PROXY_AUTH_UNSUPPORTED'));
  }
  return runtime;
}

async function collectRefs(job: DiscoverJob): Promise<ExternalListingRef[]> {
  const provider =
    job.provider === 'mercadolibre_ar'
      ? new MercadolibreArProvider()
      : job.provider === 'mercadolibre_mx'
        ? new MercadolibreMxProvider()
        : new MercadolibrePeProvider();
  const refs: ExternalListingRef[] = [];
  for await (const ref of provider.discover(job)) refs.push(ref);
  return refs;
}

describe('MercadoLibre discover — live SERP markup still parses', () => {
  it('AR: resolves refs from real poly-card anchors (no __PRELOADED_STATE__)', () => {
    const refs = parseMercadolibreArSearch(MERCADOLIBRE_AR_FIXTURE_LIVE_SERP_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual([
      'MLA-1877732195',
      'MLA-1877733073',
      'MLA-1879142141',
      'MLA-3578126424',
    ]);
    // Tracking `#…&amp;…` fragment is stripped from the canonical url.
    expect(refs[0]?.url.includes('#')).toBe(false);
    expect(refs[0]?.url).toContain('mercadolibre.com.ar');
  });

  it('MX: resolves refs from real poly-card anchors (no __PRELOADED_STATE__)', () => {
    const refs = parseMercadolibreMxSearch(MERCADOLIBRE_MX_FIXTURE_LIVE_SERP_HTML);
    expect(refs.map((ref) => ref.sourceId).sort()).toEqual([
      'MLM-2976061593',
      'MLM-2976093621',
      'MLM-3114811707',
      'MLM-5635923058',
    ]);
    expect(refs[0]?.url.includes('#')).toBe(false);
    expect(refs[0]?.url).toContain('mercadolibre.com.mx');
  });
});

describe('MercadoLibre discover — HTTP fallback when the browser tier is degraded', () => {
  it('AR (requireBrowserSession:false): browser throws → falls back to HTTP ladder → yields refs', async () => {
    const refs = await collectRefs({
      provider: 'mercadolibre_ar',
      market: 'AR',
      city: 'capital-federal',
      limit: 4,
      runtime: makeRuntime(MERCADOLIBRE_AR_FIXTURE_LIVE_SERP_HTML, true),
    });
    expect(refs.length).toBe(4);
    expect(refs.every((ref) => ref.provider === 'mercadolibre_ar')).toBe(true);
    expect(refs.every((ref) => ref.sourceId.startsWith('MLA-'))).toBe(true);
  });

  it('MX (requireBrowserSession:false): browser throws → falls back to HTTP ladder → yields refs', async () => {
    const refs = await collectRefs({
      provider: 'mercadolibre_mx',
      market: 'MX',
      city: 'ciudad-de-mexico',
      limit: 4,
      runtime: makeRuntime(MERCADOLIBRE_MX_FIXTURE_LIVE_SERP_HTML, true),
    });
    expect(refs.length).toBe(4);
    expect(refs.every((ref) => ref.provider === 'mercadolibre_mx')).toBe(true);
    expect(refs.every((ref) => ref.sourceId.startsWith('MLM-'))).toBe(true);
  });

  it('AR: no browser tier at all → still discovers via the HTTP ladder', async () => {
    const refs = await collectRefs({
      provider: 'mercadolibre_ar',
      market: 'AR',
      city: 'capital-federal',
      limit: 4,
      runtime: makeRuntime(MERCADOLIBRE_AR_FIXTURE_LIVE_SERP_HTML, false),
    });
    expect(refs.length).toBe(4);
  });

  it('PE (requireBrowserSession:true): browser throws → does NOT fall back to HTTP → yields nothing', async () => {
    const refs = await collectRefs({
      provider: 'mercadolibre_pe',
      market: 'PE',
      city: 'lima',
      limit: 4,
      // HTTP would return AR anchors, but a browser-required site must never reach it.
      runtime: makeRuntime(MERCADOLIBRE_AR_FIXTURE_LIVE_SERP_HTML, true),
    });
    expect(refs).toEqual([]);
  });
});
