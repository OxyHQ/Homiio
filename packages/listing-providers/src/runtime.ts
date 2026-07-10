/**
 * Shared fetch runtime.
 *
 * Phase 0 ships a minimal HTTP runtime (global `fetch` + a per-request timeout)
 * plus an optional local-fixtures loader. Cross-cutting concerns the plan calls
 * for — rate limiting, retries, circuit breaking, a Playwright pool and the
 * managed-fetch escalation ladder — attach HERE in later phases so providers
 * never re-implement them. The provider contract does not change.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FetchRuntime, FetchRuntimeInit, UrlFetcher } from './types';
import { createBrowserFetcher } from './browser';
import { createManagedFetcher, type ManagedFetcherConfig } from './managed';

/** Default per-request abort budget (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Descriptive User-Agent so portals/CDNs can identify Homiio's ingest fetches. */
const DEFAULT_USER_AGENT = 'Homiio-Listings/1.0 (+https://homiio.com)';

/** Options for {@link HttpFetchRuntime}. */
export interface HttpFetchRuntimeOptions {
  /** Overrides the default per-request timeout. */
  defaultTimeoutMs?: number;
  /** Overrides the default User-Agent header. */
  userAgent?: string;
  /**
   * Absolute directory the {@link FetchRuntime.loadFixture} loader reads
   * `<key>.json` from. When unset, `loadFixture` rejects — providers that embed
   * their own dataset (e.g. the Phase-0 fixture provider) never call it.
   */
  fixturesDir?: string;
}

/**
 * Run an async fetch with an abort-based timeout. Merges an optional external
 * signal so the caller can also cancel. Always clears the timer.
 */
async function withTimeout<T>(
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Minimal HTTP {@link FetchRuntime} over the global `fetch`. Adequate for API
 * providers and image-source probing; HTML providers layer parsing on top of
 * {@link fetchText}.
 */
export class HttpFetchRuntime implements FetchRuntime {
  private readonly defaultTimeoutMs: number;
  private readonly userAgent: string;
  private readonly fixturesDir?: string;

  constructor(options: HttpFetchRuntimeOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fixturesDir = options.fixturesDir;
  }

  private async request(url: string, init: FetchRuntimeInit | undefined): Promise<Response> {
    const timeoutMs = init?.timeoutMs ?? this.defaultTimeoutMs;
    return withTimeout(timeoutMs, init?.signal, async (signal) => {
      const response = await fetch(url, {
        signal,
        headers: { 'User-Agent': this.userAgent, ...init?.headers },
      });
      if (!response.ok) {
        throw new Error(`Fetch failed for ${url}: HTTP ${response.status} ${response.statusText}`);
      }
      return response;
    });
  }

  async fetchJson<T = unknown>(url: string, init?: FetchRuntimeInit): Promise<T> {
    const response = await this.request(url, init);
    return (await response.json()) as T;
  }

  async fetchText(url: string, init?: FetchRuntimeInit): Promise<string> {
    const response = await this.request(url, init);
    return response.text();
  }

  async loadFixture<T = unknown>(key: string): Promise<T> {
    if (!this.fixturesDir) {
      throw new Error(
        `loadFixture('${key}') requires a fixturesDir; none configured on this runtime`,
      );
    }
    const file = path.join(this.fixturesDir, `${key}.json`);
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  }
}

/** Convenience factory for the default HTTP runtime. */
export function createFetchRuntime(options?: HttpFetchRuntimeOptions): FetchRuntime {
  return new HttpFetchRuntime(options);
}

/** Options for {@link createListingFetchRuntime}. */
export interface ListingFetchRuntimeOptions extends HttpFetchRuntimeOptions {
  /** Optional browser-tier fetcher; when omitted `fetchViaBrowser` is absent. */
  browser?: UrlFetcher;
  /** Optional managed-tier fetcher; when omitted `fetchViaManaged` is absent. */
  managed?: UrlFetcher;
}

/**
 * A composed runtime plus a shutdown that disposes any escalation-tier
 * resources (the browser pool, managed-client sockets). The worker holds this so
 * it can close the browser cleanly on SIGTERM/SIGINT.
 */
export interface ListingFetchRuntimeHandle {
  runtime: FetchRuntime;
  shutdown(): Promise<void>;
}

/**
 * Compose the full listing fetch runtime: the HTTP base plus whichever
 * escalation tiers were provided. Crucially, `fetchViaBrowser`/`fetchViaManaged`
 * are attached ONLY when their fetcher is present, so the shared ladder skips a
 * tier the deployment did not provision (it keys availability off method
 * presence).
 */
export function createListingFetchRuntime(
  options: ListingFetchRuntimeOptions = {},
): ListingFetchRuntimeHandle {
  const http = new HttpFetchRuntime(options);
  const { browser, managed } = options;

  const runtime: FetchRuntime = {
    fetchJson: (url, init) => http.fetchJson(url, init),
    fetchText: (url, init) => http.fetchText(url, init),
    loadFixture: (key) => http.loadFixture(key),
  };
  if (browser) runtime.fetchViaBrowser = (url, init) => browser.fetch(url, init);
  if (managed) runtime.fetchViaManaged = (url, init) => managed.fetch(url, init);

  return {
    runtime,
    shutdown: async () => {
      await browser?.close?.();
      await managed?.close?.();
    },
  };
}

/** Read a positive integer env var, falling back when unset/invalid. */
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Assemble the managed-fetch config from env, or `undefined` when unconfigured. */
function managedConfigFromEnv(): ManagedFetcherConfig | undefined {
  const endpoint = process.env.LISTING_MANAGED_FETCH_URL?.trim();
  if (!endpoint) return undefined;
  const config: ManagedFetcherConfig = { endpoint };
  const apiKey = process.env.LISTING_MANAGED_FETCH_KEY?.trim();
  if (apiKey) config.apiKey = apiKey;
  const urlParam = process.env.LISTING_MANAGED_FETCH_URL_PARAM?.trim();
  if (urlParam) config.urlParam = urlParam;
  const keyHeader = process.env.LISTING_MANAGED_FETCH_KEY_HEADER?.trim();
  if (keyHeader) config.keyHeader = keyHeader;
  const keyParam = process.env.LISTING_MANAGED_FETCH_KEY_PARAM?.trim();
  if (keyParam) config.keyParam = keyParam;
  config.timeoutMs = envInt('LISTING_MANAGED_FETCH_TIMEOUT_MS', 60_000);
  return config;
}

/** Options for {@link createListingFetchRuntimeFromEnv}. */
export interface ListingFetchRuntimeFromEnvOptions {
  /** Structured log sink for operational notices (e.g. Playwright missing). */
  onLog?: (message: string) => void;
}

/**
 * Build the worker's fetch runtime from environment variables:
 *   - browser tier: enabled by `LISTING_BROWSER_ENABLED=true`, tuned by
 *     `LISTING_BROWSER_MAX_CONCURRENCY` / `LISTING_BROWSER_TIMEOUT_MS`. Skipped
 *     (with a log notice) when Playwright is not installed.
 *   - managed tier: enabled by `LISTING_MANAGED_FETCH_URL` (+ optional key/param
 *     vars). Skipped when the endpoint is unset.
 *
 * The API/Express process must never call this — only the worker.
 */
export async function createListingFetchRuntimeFromEnv(
  options: ListingFetchRuntimeFromEnvOptions = {},
): Promise<ListingFetchRuntimeHandle> {
  const browser = await createBrowserFetcher({
    enabled: process.env.LISTING_BROWSER_ENABLED === 'true',
    maxConcurrency: envInt('LISTING_BROWSER_MAX_CONCURRENCY', 2),
    timeoutMs: envInt('LISTING_BROWSER_TIMEOUT_MS', 45_000),
    onLog: options.onLog,
  });
  const managed = createManagedFetcher(managedConfigFromEnv());
  return createListingFetchRuntime({ browser, managed });
}
