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
 * DataImpulse sticky sessions: append `-session-<id>` to the login username so
 * consecutive requests share an exit IP. Other providers can use the same pattern.
 */
export function withStickySessionUsername(baseUsername: string, sessionId: string): string {
  return `${baseUsername}-session-${sessionId}`;
}

/** Short random id for one sticky browser context or HTTP session. */
export function createProxySessionId(): string {
  return randomBytes(6).toString('hex');
}

/** Map structured config to Playwright proxy options (optional sticky session). */
export function toPlaywrightProxy(
  config: ResidentialProxyConfig,
  sessionId?: string,
): PlaywrightProxyOptions {
  const username =
    sessionId !== undefined
      ? withStickySessionUsername(config.username, sessionId)
      : config.username;
  return { server: config.server, username, password: config.password };
}

/**
 * Build a proxy URL with credentials embedded (for fetch runtimes that accept a
 * single proxy string, e.g. Bun's native `fetch` `proxy` option).
 */
export function toEmbeddedProxyUrl(
  config: ResidentialProxyConfig,
  sessionId?: string,
): string {
  const username =
    sessionId !== undefined
      ? withStickySessionUsername(config.username, sessionId)
      : config.username;
  const embedded = new URL(config.server);
  embedded.username = username;
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

const proxiedFetchCache = new Map<string, Promise<ProxiedFetch>>();

/**
 * Return a `fetch` that routes through the residential proxy. Uses Bun's native
 * `proxy` option when available; otherwise falls back to undici's ProxyAgent.
 * Cached by embedded proxy URL so undici connection pools are reused.
 */
export async function createProxiedFetch(
  config: ResidentialProxyConfig,
  sessionId?: string,
): Promise<ProxiedFetch> {
  const embedded = toEmbeddedProxyUrl(config, sessionId);
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

  proxiedFetchCache.set(embedded, created);
  return created;
}
