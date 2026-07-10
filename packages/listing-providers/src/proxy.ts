/**
 * Residential-proxy helpers for the listing fetch ladder.
 *
 * Homiio scrapes with its OWN worker (Playwright / HTTP) — this module wires a
 * cheap DIY residential proxy (e.g. DataImpulse) for HTML/JSON only. Image/CSS/font
 * bytes are blocked in Playwright; listing photos are re-hosted on a direct fetch path.
 */

import { randomBytes } from 'node:crypto';

/** Parsed residential proxy credentials (no userinfo in `server`). */
export interface ResidentialProxyConfig {
  /** Proxy origin without credentials, e.g. `http://gw.dataimpulse.com:823`. */
  server: string;
  username: string;
  password: string;
}

/** Playwright-compatible proxy shape. */
export interface PlaywrightProxyOptions {
  server: string;
  username?: string;
  password?: string;
}

/** Resource types aborted when asset blocking is enabled in the browser tier. */
export const BLOCKED_BROWSER_RESOURCE_TYPES = new Set([
  'image',
  'media',
  'font',
  'stylesheet',
]);

/**
 * Parse `http://user:pass@host:port` into structured proxy config.
 * Returns `undefined` when the value is empty or not a valid URL.
 */
export function parseResidentialProxyUrl(raw: string | undefined): ResidentialProxyConfig | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (!parsed.username || !parsed.password) return undefined;
  const server = `${parsed.protocol}//${parsed.host}`;
  return {
    server,
    username: safeDecode(parsed.username),
    password: safeDecode(parsed.password),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Read `LISTING_RESIDENTIAL_PROXY_URL` when set and valid. */
export function residentialProxyFromEnv(): ResidentialProxyConfig | undefined {
  return parseResidentialProxyUrl(process.env.LISTING_RESIDENTIAL_PROXY_URL);
}

/**
 * Mask userinfo in a proxy URL for logs (SSM secrets must never appear in
 * CloudWatch). `http://user:pass@host:823` → `http://***:***@host:823`.
 */
export function maskProxyUrl(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return trimmed.replace(/\/\/[^@/]+@/g, '//***:***@');
  }
}

/**
 * Whether an env var is explicitly `"true"`. When unset, returns `defaultValue`.
 */
export function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  return raw.trim().toLowerCase() === 'true';
}

/** Whether Playwright should abort images/CSS/fonts (default ON). */
export function browserBlockAssetsFromEnv(): boolean {
  return envBool('LISTING_BROWSER_BLOCK_ASSETS', true);
}

/** Whether plain HTTP listing fetches should use the residential proxy. */
export function httpUseProxyFromEnv(): boolean {
  return process.env.LISTING_HTTP_USE_PROXY === 'true';
}

/**
 * Optional ISO-3166-1 alpha-2 country for DataImpulse geo targeting
 * (`LISTING_PROXY_GEO=es` → `login__cr.es;sessid.<id>`).
 */
export function proxyGeoCountryFromEnv(): string | undefined {
  const raw = process.env.LISTING_PROXY_GEO?.trim().toLowerCase();
  if (!raw || !/^[a-z]{2}$/.test(raw)) return undefined;
  return raw;
}

/**
 * DataImpulse sticky sessions: `login__cr.<cc>;sessid.<id>` (or `login__sessid.<id>`
 * without geo). The legacy `-session-<id>` suffix returns HTTP 407 from DataImpulse.
 */
export function withStickySessionUsername(
  baseUsername: string,
  sessionId: string,
  geoCountry?: string,
): string {
  const params: string[] = [];
  const geo = geoCountry?.trim().toLowerCase();
  if (geo && /^[a-z]{2}$/.test(geo)) params.push(`cr.${geo}`);
  params.push(`sessid.${sessionId}`);
  return `${baseUsername}__${params.join(';')}`;
}

/** Short random id for one sticky browser context or HTTP session. */
export function createProxySessionId(): string {
  return randomBytes(6).toString('hex');
}

/**
 * DataImpulse geo targeting: append `__cr.<cc>` to the login when not already
 * present (see https://docs.dataimpulse.com/proxies/parameters).
 */
export function withProxyCountryUsername(username: string, countryCode?: string): string {
  const country = countryCode?.trim().toLowerCase();
  if (!country || /__cr\./i.test(username)) return username;
  return `${username}__cr.${country}`;
}

function resolveProxyUsername(
  config: ResidentialProxyConfig,
  sessionId?: string,
  countryCode?: string,
): string {
  if (sessionId === undefined) {
    return withProxyCountryUsername(config.username, countryCode);
  }
  return withStickySessionUsername(
    config.username,
    sessionId,
    countryCode ?? proxyGeoCountryFromEnv(),
  );
}

/** Map structured config to Playwright proxy options (optional sticky session). */
export function toPlaywrightProxy(
  config: ResidentialProxyConfig,
  sessionId?: string,
  countryCode?: string,
): PlaywrightProxyOptions {
  return {
    server: config.server,
    username: resolveProxyUsername(config, sessionId, countryCode),
    password: config.password,
  };
}

/**
 * Build a proxy URL with credentials embedded (for fetch runtimes that accept a
 * single proxy string, e.g. Bun's native `fetch` `proxy` option).
 */
export function toEmbeddedProxyUrl(
  config: ResidentialProxyConfig,
  sessionId?: string,
  countryCode?: string,
): string {
  const embedded = new URL(config.server);
  embedded.username = resolveProxyUsername(config, sessionId, countryCode);
  embedded.password = config.password;
  return embedded.toString();
}

interface UndiciModule {
  ProxyAgent: new (uri: string) => unknown;
  fetch: typeof fetch;
}

function isUndiciModule(value: unknown): value is UndiciModule {
  if (typeof value !== 'object' || value === null) return false;
  const mod = value as { ProxyAgent?: unknown; fetch?: unknown };
  return typeof mod.ProxyAgent === 'function' && typeof mod.fetch === 'function';
}

async function loadUndici(): Promise<UndiciModule | undefined> {
  const specifier = 'undici';
  try {
    const mod: unknown = await import(specifier);
    if (isUndiciModule(mod)) return mod;
    const wrapped = (mod as { default?: unknown }).default;
    return isUndiciModule(wrapped) ? wrapped : undefined;
  } catch {
    return undefined;
  }
}

type ProxiedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const PROXIED_FETCH_CACHE_MAX = 100;
const proxiedFetchCache = new Map<string, Promise<ProxiedFetch>>();

/**
 * Return a `fetch` that routes through the residential proxy. Uses Bun's native
 * `proxy` option when available; otherwise falls back to undici's ProxyAgent.
 * Cached by embedded proxy URL so undici connection pools are reused.
 */
export async function createProxiedFetch(
  config: ResidentialProxyConfig,
  sessionId?: string,
  countryCode?: string,
): Promise<ProxiedFetch> {
  const embedded = toEmbeddedProxyUrl(config, sessionId, countryCode);
  const cached = proxiedFetchCache.get(embedded);
  if (cached) return cached;

  const created = (async (): Promise<ProxiedFetch> => {
    if (typeof process.versions.bun === 'string') {
      return (input, init) =>
        fetch(input, { ...init, proxy: embedded } as RequestInit & { proxy: string });
    }

    const undici = await loadUndici();
    if (!undici) {
      throw new Error(
        'Residential proxy HTTP fetch requires Bun or the undici package (ProxyAgent)',
      );
    }
    const dispatcher = new undici.ProxyAgent(embedded);
    return (input, init) =>
      undici.fetch(input, { ...init, dispatcher } as RequestInit & { dispatcher: unknown });
  })();

  if (proxiedFetchCache.size >= PROXIED_FETCH_CACHE_MAX) {
    const firstKey = proxiedFetchCache.keys().next().value;
    if (firstKey !== undefined) proxiedFetchCache.delete(firstKey);
  }
  proxiedFetchCache.set(embedded, created);
  return created;
}
