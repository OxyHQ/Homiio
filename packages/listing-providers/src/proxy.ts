/**
 * Residential-proxy helpers for the listing fetch ladder.
 *
 * Homiio scrapes with its OWN worker (Playwright / HTTP) — this module wires a
 * cheap DIY residential proxy (e.g. DataImpulse) for HTML/JSON only. Image/CSS/font
 * bytes are blocked in Playwright; listing photos are re-hosted on a direct fetch path.
 */

import { randomBytes } from 'node:crypto';
import type { ListingMarket } from '@homiio/shared-types';

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

/**
 * Whether the browser tier launches a HEADED Chromium (default OFF → headless).
 *
 * DataDome/Kasada fingerprint and block headless Chromium; a real headed browser
 * running under a virtual display (Xvfb) on a residential IP clears those
 * challenges where a headless launch is detected and blocked. When this is
 * `true`, the worker process MUST run under an X server — a headed launch with no
 * `DISPLAY` throws. The sanctioned command (see the backend Dockerfile header) is:
 *
 *   xvfb-run -a --server-args="-screen 0 1920x1080x24" node packages/backend/dist/worker.js
 *
 * Default `false` preserves the current headless behaviour, so this flag is inert
 * until infra flips it together with the xvfb-run worker command.
 */
export function browserHeadedFromEnv(): boolean {
  return envBool('LISTING_BROWSER_HEADED', false);
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
 * Residential-proxy exit country for each provider {@link ListingMarket}
 * (lowercase ISO-3166-1 alpha-2). Markets are already ISO-ish, but the mapping
 * is explicit and exhaustive (`satisfies`) so a reviewer can audit every exit
 * country and adding a market forces a deliberate choice. `GB` (United Kingdom)
 * is the correct ISO code — the residential proxies key geo on ISO alpha-2.
 */
const MARKET_PROXY_COUNTRY = {
  ES: 'es',
  US: 'us',
  IT: 'it',
  GB: 'gb',
  DE: 'de',
  RO: 'ro',
  FR: 'fr',
  AR: 'ar',
  EC: 'ec',
  MX: 'mx',
  CO: 'co',
  CL: 'cl',
  PE: 'pe',
  PT: 'pt',
  CA: 'ca',
  AU: 'au',
  AE: 'ae',
  IE: 'ie',
  BE: 'be',
  PL: 'pl',
  NL: 'nl',
} satisfies Record<ListingMarket, string>;

/** Lookup keyed by string so an unknown/stale market resolves to `undefined`. */
const MARKET_PROXY_COUNTRY_TABLE: ReadonlyMap<string, string> = new Map(
  Object.entries(MARKET_PROXY_COUNTRY),
);

/**
 * Map a provider market to its residential-proxy exit country (lowercase ISO
 * alpha-2), or `undefined` when the market is absent or has no clean mapping —
 * the caller then falls back to the global `LISTING_PROXY_GEO`.
 */
export function marketProxyCountry(market: string | undefined): string | undefined {
  if (!market) return undefined;
  return MARKET_PROXY_COUNTRY_TABLE.get(market.trim().toUpperCase());
}

/**
 * Whether fetch + discover traffic exits from each provider's OWN market
 * country (`LISTING_PROXY_PER_MARKET_GEO=true`) instead of the single global
 * `LISTING_PROXY_GEO`. Defaults OFF: this alters a working shared fetch path, so
 * it ships dark and is flipped after a canary. When off, behaviour is unchanged
 * (all traffic exits from `LISTING_PROXY_GEO`).
 */
export function proxyPerMarketGeoFromEnv(): boolean {
  return envBool('LISTING_PROXY_PER_MARKET_GEO', false);
}

/**
 * How a provider expects geo + sticky parameters to be encoded in the proxy
 * credentials. Providers split into two families:
 * - `dataimpulse`: parameters ride on the USERNAME (`login__cr.es;sessid.<id>`).
 * - `password`: parameters ride on the PASSWORD, underscore-separated
 *   (`password_country-es_session-<id>`). This covers Evomi and IPRoyal, which
 *   share the exact same syntax.
 */
export type ProxyCredentialFormat = 'dataimpulse' | 'password';

/**
 * Provider credential dialect from `LISTING_PROXY_FORMAT`. Defaults to
 * `password` (Evomi / IPRoyal, the active residential proxy family); set
 * `LISTING_PROXY_FORMAT=dataimpulse` to opt back into username-encoded params.
 */
export function proxyFormatFromEnv(): ProxyCredentialFormat {
  return process.env.LISTING_PROXY_FORMAT?.trim().toLowerCase() === 'dataimpulse'
    ? 'dataimpulse'
    : 'password';
}

/**
 * Evomi / IPRoyal style: geo + sticky parameters appended to the PASSWORD,
 * underscore-separated (`password_country-es_session-<id>`). The username stays
 * untouched. Session ids are alphanumeric (IPRoyal requires it); the shared
 * {@link createProxySessionId} hex ids satisfy both providers.
 */
export function withPasswordParams(
  basePassword: string,
  sessionId?: string,
  countryCode?: string,
): string {
  const params: string[] = [];
  const country = countryCode?.trim().toLowerCase();
  if (country && /^[a-z]{2}$/.test(country)) params.push(`country-${country}`);
  if (sessionId) params.push(`session-${sessionId}`);
  return params.length > 0 ? `${basePassword}_${params.join('_')}` : basePassword;
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

/**
 * Resolve `{ username, password }` for the active provider dialect. DataImpulse
 * encodes geo + sticky on the username; Evomi/IPRoyal encode them on the
 * password. `format` defaults to the env-selected dialect.
 */
export function resolveProxyCredentials(
  config: ResidentialProxyConfig,
  sessionId?: string,
  countryCode?: string,
  format: ProxyCredentialFormat = proxyFormatFromEnv(),
): { username: string; password: string } {
  const country = countryCode ?? proxyGeoCountryFromEnv();
  if (format === 'password') {
    return {
      username: config.username,
      password: withPasswordParams(config.password, sessionId, country),
    };
  }
  const username =
    sessionId === undefined
      ? withProxyCountryUsername(config.username, country)
      : withStickySessionUsername(config.username, sessionId, country);
  return { username, password: config.password };
}

/** Map structured config to Playwright proxy options (optional sticky session). */
export function toPlaywrightProxy(
  config: ResidentialProxyConfig,
  sessionId?: string,
  countryCode?: string,
): PlaywrightProxyOptions {
  const { username, password } = resolveProxyCredentials(config, sessionId, countryCode);
  return { server: config.server, username, password };
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
  const { username, password } = resolveProxyCredentials(config, sessionId, countryCode);
  embedded.username = username;
  embedded.password = password;
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
