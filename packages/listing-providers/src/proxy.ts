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

// ---------------------------------------------------------------------------
// Proxy reachability — the signal that was missing for two months
// ---------------------------------------------------------------------------
//
// On 2026-09-20 the residential proxy account ran out of balance and Evomi began
// answering every CONNECT with `402 Payment Required`. Every fetch and every
// browser navigation failed from that moment, no listing was ingested again, and
// the 30-day `EXTERNAL_PROPERTY_TTL_DAYS` sweep then emptied the properties
// table one row at a time until two seeded fixtures were left. It took a user
// noticing that the app had no homes.
//
// Two separate things made it silent for that long, and both are fixed here:
//
//  1. NOTHING EVER ASKED THE PROXY IF IT WORKED. The worker only discovered the
//     failure by failing a real job, one job at a time, forever.
//     {@link checkResidentialProxy} asks directly, in one request.
//
//  2. THE REASON WAS UNREACHABLE IN THE LOGS. undici buries a refused CONNECT
//     three `cause` levels down, and the worker logged `error.message` only:
//
//       TypeError: fetch failed                       <- what CloudWatch showed
//         Error: Request was cancelled.
//           AbortError: Proxy response (402) !== 200 when HTTP Tunneling
//                                       ^^^ the entire diagnosis, never logged
//
//     `fetch failed` is indistinguishable from a portal being down, which is
//     exactly how 19,497 failed jobs read as ordinary scraping noise.
//     {@link describeProxyFailure} flattens the chain and lifts the status out.

/** The tunnelling error undici raises when a proxy refuses CONNECT. */
const PROXY_TUNNEL_STATUS_RE = /Proxy response \((\d{3})\) !== 200 when HTTP Tunneling/;

/** How deep to walk an error's `cause` chain. undici's is three; allow slack. */
const MAX_CAUSE_DEPTH = 8;

/** A proxy failure, flattened into something a log line can carry. */
export interface ProxyFailureDescription {
  /** HTTP status the proxy answered CONNECT with, when it answered at all. */
  proxyStatus?: number;
  /** Every `name: message` in the `cause` chain, outermost first. */
  chain: string[];
}

/**
 * Flatten an error's `cause` chain and lift out the proxy's CONNECT status.
 *
 * Node's `fetch` reports a refused tunnel as a bare `TypeError: fetch failed`
 * and hides the status in nested causes, so this is the only way to tell "the
 * proxy refused us" apart from "the portal is down" without guessing.
 */
export function describeProxyFailure(error: unknown): ProxyFailureDescription {
  const chain: string[] = [];
  let proxyStatus: number | undefined;
  let current: unknown = error;

  for (let depth = 0; current != null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object') {
      chain.push(String(current));
      break;
    }
    const err = current as { name?: unknown; message?: unknown; cause?: unknown };
    const name = typeof err.name === 'string' ? err.name : 'Error';
    const message = typeof err.message === 'string' ? err.message : String(err.message ?? '');
    chain.push(`${name}: ${message}`);

    const matched = PROXY_TUNNEL_STATUS_RE.exec(message);
    if (matched && proxyStatus === undefined) proxyStatus = Number(matched[1]);

    current = err.cause;
  }

  return { proxyStatus, chain };
}

/** Why a proxy check failed. `billing` and `auth` are never transient. */
export type ProxyCheckFailure = 'billing' | 'auth' | 'refused' | 'network';

/** Outcome of {@link checkResidentialProxy}. */
export type ProxyCheckResult =
  | { ok: true; proxyStatus?: undefined; reason?: undefined; detail?: undefined }
  | { ok: false; reason: ProxyCheckFailure; proxyStatus?: number; detail: string };

/**
 * Default CONNECT target. Google's `generate_204` is built for exactly this —
 * no body, no rate limit worth the name, and up whenever the internet is.
 *
 * What it proves is deliberately narrow: that the proxy OPENED THE TUNNEL. The
 * response itself is not inspected, so a captcha, a redirect or a 500 from the
 * far end all still count as success, because all of them mean the proxy did
 * its job. Widening this into a content check would make the health of an
 * unrelated third party able to declare Homiio's proxy dead.
 */
const DEFAULT_PROXY_HEALTHCHECK_URL = 'https://www.google.com/generate_204';

/** Options for {@link checkResidentialProxy}. */
export interface ProxyCheckOptions {
  /** Absolute URL to CONNECT to. Defaults to {@link DEFAULT_PROXY_HEALTHCHECK_URL}. */
  url?: string;
  /** Abort after this many milliseconds (default 15s). */
  timeoutMs?: number;
  /** Injection seam for tests; defaults to {@link createProxiedFetch}. */
  fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

/**
 * Ask the residential proxy whether it will carry traffic right now.
 *
 * ANY HTTP RESPONSE IS A PASS — see {@link DEFAULT_PROXY_HEALTHCHECK_URL}. Only
 * a failure to establish the tunnel is a fail, classified so the caller can tell
 * a dead account (`billing`/`auth` — a human must act, retrying is pointless)
 * from a blip (`network` — retrying is the correct response).
 */
export async function checkResidentialProxy(
  config: ResidentialProxyConfig,
  options: ProxyCheckOptions = {},
): Promise<ProxyCheckResult> {
  const url = options.url ?? proxyHealthcheckUrlFromEnv();
  const timeoutMs = options.timeoutMs ?? 15_000;
  const proxiedFetch = options.fetchImpl ?? (await createProxiedFetch(config));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await proxiedFetch(url, { signal: controller.signal, redirect: 'manual' });
    return { ok: true };
  } catch (error) {
    const { proxyStatus, chain } = describeProxyFailure(error);
    return {
      ok: false,
      reason: classifyProxyFailure(proxyStatus),
      proxyStatus,
      detail: chain.join(' <- ') || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Map a CONNECT status onto whether a human has to do something.
 *
 * 402 is the one this file exists for: it is what an exhausted prepaid balance
 * looks like, it never clears on its own, and no amount of retrying or
 * redeploying touches it. 407 is the same shape with a different cause —
 * credentials the provider no longer accepts.
 */
function classifyProxyFailure(proxyStatus: number | undefined): ProxyCheckFailure {
  if (proxyStatus === 402) return 'billing';
  if (proxyStatus === 407) return 'auth';
  if (proxyStatus !== undefined) return 'refused';
  return 'network';
}

/** Read `LISTING_PROXY_HEALTHCHECK_URL`, falling back to the default target. */
export function proxyHealthcheckUrlFromEnv(): string {
  const raw = process.env.LISTING_PROXY_HEALTHCHECK_URL?.trim();
  return raw || DEFAULT_PROXY_HEALTHCHECK_URL;
}

/** Re-check cadence when the env var is unset or unusable. */
const DEFAULT_PROXY_CHECK_INTERVAL_MINUTES = 30;

/**
 * Largest interval that survives `setInterval`.
 *
 * A JS timer delay is a signed 32-bit millisecond count. Hand `setInterval`
 * more than that and Node does NOT wait longer — it warns and fires on the next
 * tick, turning "check every 27 days" into a check every millisecond.
 *
 * Worth naming precisely because of what this module is for: that flood would
 * run through the residential proxy, and the resource it would burn is the
 * metered balance whose exhaustion caused the outage this file exists to
 * detect. A typo in an env var would fund the next incident.
 *
 * Over-ceiling values fall back to the default rather than clamping to it —
 * somebody who wrote 40000 did not mean 35791, and a sane 30 beats an arbitrary
 * maximum nobody chose. `Number` rather than `parseInt` so `30min` and `30.5`
 * are refused outright instead of silently becoming 30.
 */
const MAX_PROXY_CHECK_INTERVAL_MINUTES = Math.floor(2_147_483_647 / 60_000);

/**
 * How often the worker re-checks the proxy, in minutes
 * (`LISTING_PROXY_CHECK_INTERVAL_MINUTES`, default 30, `0` disables).
 *
 * A boot-only check would not have caught the incident this module documents:
 * the balance ran out while the worker was running, and it kept running for two
 * months afterwards. The check has to repeat or it does not cover the failure
 * that actually happened.
 *
 * **THIS CADENCE IS COUPLED TO AN ALARM IN ANOTHER REPO.** While the proxy stays
 * broken the marker is re-emitted on this interval, and the alarm only returns
 * to OK once its whole evaluation window is marker-free — which is what makes a
 * recovery notice mean "a check actually passed" rather than "we happened not to
 * emit just then". oxy-infra's `homiio-listing-proxy-unusable` allows a 60
 * minute silence, so raising this past 30 minutes requires widening that window
 * in the same change or the alarm will flap between ALARM and a false OK.
 */
export function proxyCheckIntervalMinutesFromEnv(): number {
  const raw = process.env.LISTING_PROXY_CHECK_INTERVAL_MINUTES?.trim();
  if (!raw) return DEFAULT_PROXY_CHECK_INTERVAL_MINUTES;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_PROXY_CHECK_INTERVAL_MINUTES) {
    return DEFAULT_PROXY_CHECK_INTERVAL_MINUTES;
  }
  return parsed;
}
