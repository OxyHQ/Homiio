/**
 * Managed anti-bot escalation tier.
 *
 * The final rung of the shared fetch ladder (HTTP → browser → **managed**). It
 * forwards the target URL to a configured managed fetch service (residential
 * proxies / CAPTCHA solving — e.g. ScraperAPI, ScrapingBee, Zyte) and returns
 * the HTML that service resolved. It is deliberately OPTIONAL and config-driven:
 * when `LISTING_MANAGED_FETCH_URL` is unset the factory returns `undefined` and
 * the ladder SKIPS this rung entirely — we never fake or stub a managed fetch.
 *
 * The contract is intentionally generic so any GET-proxy-style service fits
 * without a per-vendor plugin:
 *   - the target URL is passed as a query param (name from `urlParam`, default
 *     `url`);
 *   - the API key is sent either as a header (`keyHeader`, default `X-Api-Key`)
 *     or, when `keyParam` is set, as a query param instead;
 *   - the response BODY is the fetched HTML. A non-2xx response throws so the
 *     ladder records an `error` and gives up (there is no rung after this).
 */

import { DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT, withAbortTimeout } from './http';
import type { FetchRuntimeInit, UrlFetcher } from './types';

/** Managed-fetch endpoint + auth configuration. */
export interface ManagedFetcherConfig {
  /** Managed fetch service endpoint. REQUIRED — absent config → no fetcher. */
  endpoint: string;
  /** API key for the service. */
  apiKey?: string;
  /** Query param the target URL is passed in (default `url`). */
  urlParam?: string;
  /** Header the API key is sent in (default `X-Api-Key`). Ignored if `keyParam` set. */
  keyHeader?: string;
  /** When set, the API key is sent as this query param instead of a header. */
  keyParam?: string;
  /** Extra static query params forwarded on every managed request. */
  extraParams?: Record<string, string>;
  /** Hard per-request timeout (ms). */
  timeoutMs?: number;
}

const DEFAULT_URL_PARAM = 'url';
const DEFAULT_KEY_HEADER = 'X-Api-Key';

/** A managed anti-bot service client exposing the {@link UrlFetcher} contract. */
export class ManagedFetcher implements UrlFetcher {
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly urlParam: string;
  private readonly keyHeader: string;
  private readonly keyParam?: string;
  private readonly extraParams: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: ManagedFetcherConfig) {
    this.endpoint = config.endpoint;
    this.apiKey = config.apiKey;
    this.urlParam = config.urlParam ?? DEFAULT_URL_PARAM;
    this.keyHeader = config.keyHeader ?? DEFAULT_KEY_HEADER;
    this.keyParam = config.keyParam;
    this.extraParams = config.extraParams ?? {};
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Build the managed request URL (target + optional key + extra params). */
  private buildRequestUrl(target: string): string {
    const requestUrl = new URL(this.endpoint);
    requestUrl.searchParams.set(this.urlParam, target);
    for (const [key, value] of Object.entries(this.extraParams)) {
      requestUrl.searchParams.set(key, value);
    }
    if (this.apiKey && this.keyParam) {
      requestUrl.searchParams.set(this.keyParam, this.apiKey);
    }
    return requestUrl.toString();
  }

  async fetch(target: string, init?: FetchRuntimeInit): Promise<string> {
    const timeoutMs = init?.timeoutMs ?? this.timeoutMs;
    const headers: Record<string, string> = {
      'User-Agent': DEFAULT_USER_AGENT,
      ...init?.headers,
    };
    if (this.apiKey && !this.keyParam) {
      headers[this.keyHeader] = this.apiKey;
    }
    return withAbortTimeout(timeoutMs, init?.signal, async (signal) => {
      const response = await fetch(this.buildRequestUrl(target), {
        signal,
        redirect: 'follow',
        headers,
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`Managed fetch failed for ${target}: HTTP ${response.status}`);
      }
      return body;
    });
  }
}

/**
 * Build the managed-tier {@link UrlFetcher} from config, or `undefined` when no
 * endpoint is configured (the ladder then skips the managed rung). We never
 * fabricate a managed fetch — an unset endpoint means the rung does not exist.
 */
export function createManagedFetcher(config: ManagedFetcherConfig | undefined): UrlFetcher | undefined {
  if (!config?.endpoint) return undefined;
  return new ManagedFetcher(config);
}
