/**
 * Per-market residential-proxy geo.
 *
 * Verifies the market → exit-country mapping, the `withProxyCountry` runtime
 * wrapper (default-inject vs provider override, optional-tier preservation), and
 * that a market country threads correctly into BOTH proxy dialects (Evomi/IPRoyal
 * password-param + DataImpulse username). Also proves the regression-safety
 * contract: flag OFF preserves the global geo, and an unknown market falls back
 * to `LISTING_PROXY_GEO` (never a malformed/407-inducing country param).
 *
 * No live portal hits — pure unit coverage of the shared helpers the worker wires.
 */

import {
  marketProxyCountry,
  proxyPerMarketGeoFromEnv,
  withProxyCountry,
  withPasswordParams,
  withProxyCountryUsername,
  withStickySessionUsername,
  resolveProxyCredentials,
  type BrowserSession,
  type BrowserSessionOptions,
  type FetchRuntime,
  type FetchRuntimeInit,
} from '@homiio/listing-providers';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

/* -------------------------------------------------------------------------- */
/* Recording fake runtime                                                     */
/* -------------------------------------------------------------------------- */

interface Recorded {
  httpInit?: FetchRuntimeInit;
  textInit?: FetchRuntimeInit;
  browserInit?: FetchRuntimeInit;
  managedInit?: FetchRuntimeInit;
  sessionOptions?: BrowserSessionOptions;
}

function stubSession(): BrowserSession {
  return {
    request: () => Promise.resolve({ status: 200, body: '' }),
    content: () => Promise.resolve(''),
    pageUrl: () => 'https://example.test/',
    warmNavigate: () => Promise.resolve(),
    exportStorageState: () => Promise.resolve({ cookies: [] }),
    close: () => Promise.resolve(),
  };
}

/** A runtime that records the `init` each method receives (optional tiers gated). */
function recorderRuntime(rec: Recorded, withOptionalTiers = false): FetchRuntime {
  const runtime: FetchRuntime = {
    fetchHttp: (_url: string, init?: FetchRuntimeInit) => {
      rec.httpInit = init;
      return Promise.resolve({ status: 200, body: '' });
    },
    fetchJson: <T = unknown>(): Promise<T> => Promise.reject(new Error('fetchJson unused')),
    fetchText: (_url: string, init?: FetchRuntimeInit) => {
      rec.textInit = init;
      return Promise.resolve('');
    },
    loadFixture: <T = unknown>(): Promise<T> => Promise.reject(new Error('no fixtures')),
  };
  if (withOptionalTiers) {
    runtime.fetchViaBrowser = (_url: string, init?: FetchRuntimeInit) => {
      rec.browserInit = init;
      return Promise.resolve('');
    };
    runtime.fetchViaManaged = (_url: string, init?: FetchRuntimeInit) => {
      rec.managedInit = init;
      return Promise.resolve('');
    };
    runtime.openBrowserSession = (options: BrowserSessionOptions) => {
      rec.sessionOptions = options;
      return Promise.resolve(stubSession());
    };
  }
  return runtime;
}

/* -------------------------------------------------------------------------- */
/* marketProxyCountry                                                         */
/* -------------------------------------------------------------------------- */

describe('marketProxyCountry', () => {
  it('maps each provider market to its lowercase ISO exit country', () => {
    expect(marketProxyCountry('ES')).toBe('es');
    expect(marketProxyCountry('GB')).toBe('gb');
    expect(marketProxyCountry('PL')).toBe('pl');
    expect(marketProxyCountry('AR')).toBe('ar');
    expect(marketProxyCountry('MX')).toBe('mx');
    expect(marketProxyCountry('US')).toBe('us');
    expect(marketProxyCountry('DE')).toBe('de');
    expect(marketProxyCountry('BE')).toBe('be');
    expect(marketProxyCountry('NL')).toBe('nl');
    expect(marketProxyCountry('PT')).toBe('pt');
  });

  it('is case-insensitive and trims surrounding whitespace', () => {
    expect(marketProxyCountry('pl')).toBe('pl');
    expect(marketProxyCountry(' GB ')).toBe('gb');
  });

  it('returns undefined for an unknown, empty, or absent market (→ env geo fallback)', () => {
    expect(marketProxyCountry('ZZ')).toBeUndefined();
    expect(marketProxyCountry('')).toBeUndefined();
    expect(marketProxyCountry(undefined)).toBeUndefined();
  });
});

/* -------------------------------------------------------------------------- */
/* proxyPerMarketGeoFromEnv (flag)                                            */
/* -------------------------------------------------------------------------- */

describe('proxyPerMarketGeoFromEnv', () => {
  it('defaults OFF and is opt-in via LISTING_PROXY_PER_MARKET_GEO=true', () => {
    delete process.env.LISTING_PROXY_PER_MARKET_GEO;
    expect(proxyPerMarketGeoFromEnv()).toBe(false);
    process.env.LISTING_PROXY_PER_MARKET_GEO = 'true';
    expect(proxyPerMarketGeoFromEnv()).toBe(true);
    process.env.LISTING_PROXY_PER_MARKET_GEO = 'TRUE';
    expect(proxyPerMarketGeoFromEnv()).toBe(true);
    process.env.LISTING_PROXY_PER_MARKET_GEO = 'false';
    expect(proxyPerMarketGeoFromEnv()).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* withProxyCountry runtime wrapper                                           */
/* -------------------------------------------------------------------------- */

describe('withProxyCountry', () => {
  it('returns the runtime UNCHANGED when no country is given (strict no-op)', () => {
    const base = recorderRuntime({});
    expect(withProxyCountry(base, undefined)).toBe(base);
    expect(withProxyCountry(base, '')).toBe(base);
  });

  it('defaults proxyCountry on fetchHttp and fetchText', async () => {
    const rec: Recorded = {};
    const scoped = withProxyCountry(recorderRuntime(rec), 'pl');
    await scoped.fetchHttp('https://portal.example/search');
    await scoped.fetchText('https://portal.example/detail');
    expect(rec.httpInit?.proxyCountry).toBe('pl');
    expect(rec.textInit?.proxyCountry).toBe('pl');
  });

  it('lets a provider-set proxyCountry WIN over the market default', async () => {
    const rec: Recorded = {};
    const scoped = withProxyCountry(recorderRuntime(rec), 'pl');
    await scoped.fetchHttp('https://portal.example/search', { proxyCountry: 'es' });
    expect(rec.httpInit?.proxyCountry).toBe('es');
  });

  it('preserves ABSENT optional tiers (never fabricates a tier)', () => {
    const scoped = withProxyCountry(recorderRuntime({}, false), 'pl');
    expect(scoped.fetchViaBrowser).toBeUndefined();
    expect(scoped.fetchViaManaged).toBeUndefined();
    expect(scoped.openBrowserSession).toBeUndefined();
  });

  it('injects the country into the browser/managed tiers and openBrowserSession', async () => {
    const rec: Recorded = {};
    const scoped = withProxyCountry(recorderRuntime(rec, true), 'gb');
    await scoped.fetchViaBrowser?.('https://portal.example/x');
    await scoped.fetchViaManaged?.('https://portal.example/x');
    const session = await scoped.openBrowserSession?.({ warmUrl: 'https://portal.example/x' });
    await session?.close();
    expect(rec.browserInit?.proxyCountry).toBe('gb');
    expect(rec.managedInit?.proxyCountry).toBe('gb');
    expect(rec.sessionOptions?.proxyCountry).toBe('gb');
  });

  it('lets a provider-set proxyCountry WIN on openBrowserSession', async () => {
    const rec: Recorded = {};
    const scoped = withProxyCountry(recorderRuntime(rec, true), 'gb');
    const session = await scoped.openBrowserSession?.({
      warmUrl: 'https://portal.example/x',
      proxyCountry: 'es',
    });
    await session?.close();
    expect(rec.sessionOptions?.proxyCountry).toBe('es');
  });
});

/* -------------------------------------------------------------------------- */
/* Per-dialect country injection driven by the market                        */
/* -------------------------------------------------------------------------- */

describe('per-market country injection — DataImpulse (username) dialect', () => {
  it('rides the market country on the username', () => {
    expect(withProxyCountryUsername('login', marketProxyCountry('GB'))).toBe('login__cr.gb');
    expect(withStickySessionUsername('login', 'sess1', marketProxyCountry('PL'))).toBe(
      'login__cr.pl;sessid.sess1',
    );
  });
});

describe('per-market country injection — Evomi/IPRoyal (password) dialect', () => {
  it('rides the market country on the password', () => {
    expect(withPasswordParams('pass', 'sess1', marketProxyCountry('AR'))).toBe(
      'pass_country-ar_session-sess1',
    );
    expect(withPasswordParams('pass', undefined, marketProxyCountry('MX'))).toBe('pass_country-mx');
  });
});

describe('resolveProxyCredentials threads the market country per dialect', () => {
  const config = { server: 'http://rp.evomi.com:1000', username: 'user', password: 'pass' };

  it('password dialect: params ride on the password', () => {
    expect(resolveProxyCredentials(config, 'sess1', marketProxyCountry('GB'), 'password')).toEqual({
      username: 'user',
      password: 'pass_country-gb_session-sess1',
    });
  });

  it('dataimpulse dialect: params ride on the username', () => {
    expect(resolveProxyCredentials(config, 'sess1', marketProxyCountry('PL'), 'dataimpulse')).toEqual(
      {
        username: 'user__cr.pl;sessid.sess1',
        password: 'pass',
      },
    );
  });

  it('an unknown market yields NO country param (never a 407-inducing junk param)', () => {
    delete process.env.LISTING_PROXY_GEO;
    expect(resolveProxyCredentials(config, 'sess1', marketProxyCountry('ZZ'), 'password')).toEqual({
      username: 'user',
      password: 'pass_session-sess1',
    });
    expect(resolveProxyCredentials(config, 'sess1', marketProxyCountry('ZZ'), 'dataimpulse')).toEqual(
      {
        username: 'user__sessid.sess1',
        password: 'pass',
      },
    );
  });

  it('an unknown market falls back to LISTING_PROXY_GEO when set', () => {
    process.env.LISTING_PROXY_GEO = 'es';
    expect(resolveProxyCredentials(config, 'sess1', marketProxyCountry('ZZ'), 'password')).toEqual({
      username: 'user',
      password: 'pass_country-es_session-sess1',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Worker composition: flag OFF preserves the global geo                      */
/* -------------------------------------------------------------------------- */

describe('worker composition (flag gate)', () => {
  it('flag OFF: no market country injected — traffic stays on the global geo', async () => {
    delete process.env.LISTING_PROXY_PER_MARKET_GEO;
    const rec: Recorded = {};
    const base = recorderRuntime(rec);
    // Mirrors worker.runtimeForMarket: only wrap when the flag is on.
    const country = proxyPerMarketGeoFromEnv() ? marketProxyCountry('PL') : undefined;
    const scoped = withProxyCountry(base, country);
    expect(scoped).toBe(base);
    await scoped.fetchHttp('https://portal.example/x');
    expect(rec.httpInit?.proxyCountry).toBeUndefined();
  });

  it('flag ON: the market country is injected', async () => {
    process.env.LISTING_PROXY_PER_MARKET_GEO = 'true';
    const rec: Recorded = {};
    const base = recorderRuntime(rec);
    const country = proxyPerMarketGeoFromEnv() ? marketProxyCountry('PL') : undefined;
    const scoped = withProxyCountry(base, country);
    await scoped.fetchHttp('https://portal.example/x');
    expect(rec.httpInit?.proxyCountry).toBe('pl');
  });
});
