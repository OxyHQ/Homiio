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
import type { FetchRuntime, FetchRuntimeInit } from './types';

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
