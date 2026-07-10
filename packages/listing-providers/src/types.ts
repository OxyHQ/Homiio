/**
 * The listing-provider plugin contract.
 *
 * A provider knows how to (1) DISCOVER listing references for a market segment,
 * (2) FETCH the raw payload for one reference, (3) NORMALIZE that raw payload
 * into a provider-agnostic {@link NormalizedListing}, and (4) report its own
 * HEALTH. Everything cross-cutting (rate limiting, retries, circuit breaking,
 * browser/managed fetch ladder, CAPTCHA handling) lives in the shared
 * {@link FetchRuntime}, NOT in each plugin.
 *
 * The API/Express process never imports providers — only the worker does.
 */

import type {
  ListingMarket,
  NormalizedListing,
  ProviderId,
} from '@homiio/shared-types';

/**
 * A discover job: enumerate listing references for a provider within a market
 * scope (a city and/or a geographic bounding box). Phase 0's fixture provider
 * ignores the scope and yields its local dataset; real providers page through
 * search results.
 */
export interface DiscoverJob {
  provider: ProviderId;
  market: ListingMarket;
  /** City name to enumerate (provider-specific interpretation). */
  city?: string;
  /** Geographic bounding box `[west, south, east, north]` (lng/lat degrees). */
  bbox?: [number, number, number, number];
  /** Soft cap on how many references to yield in this discover pass. */
  limit?: number;
  /**
   * Shared runtime used by providers that must page live search results during
   * discovery (HTML/API portals). Optional so purely local providers (e.g. the
   * fixture provider) ignore it; real providers throw when it is absent.
   */
  runtime?: FetchRuntime;
  /** Abort signal so a hung discovery pass can be cancelled by the worker. */
  signal?: AbortSignal;
}

/**
 * A lightweight reference to a single listing on a portal, produced by
 * `discover()` and consumed by `fetch()`. `sourceId` is the portal's stable id;
 * `url` is the canonical listing URL (also used as the CTA `sourceUrl`).
 */
export interface ExternalListingRef {
  provider: ProviderId;
  sourceId: string;
  url: string;
  /** Optional provider-specific hints carried from discover to fetch. */
  hints?: Record<string, unknown>;
}

/**
 * Per-fetch context handed to a provider's `fetch()`: the shared runtime plus
 * an abort signal so a hung fetch can be cancelled by the worker.
 */
export interface FetchContext {
  runtime: FetchRuntime;
  signal?: AbortSignal;
}

/**
 * The raw, un-normalized payload a provider's `fetch()` returns and its
 * `normalize()` consumes. Shape is provider-specific, so it is opaque here; the
 * `ref` is carried alongside so `normalize()` can stamp `sourceId`/`sourceUrl`
 * without re-parsing.
 */
export interface RawListing {
  ref: ExternalListingRef;
  /** Provider-specific parsed payload (JSON object, parsed HTML model, …). */
  payload: unknown;
}

/** Health verdict for a provider, surfaced by the worker's health endpoint. */
export interface ProviderHealth {
  provider: ProviderId;
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Optional human-readable detail (last error, challenge rate, …). */
  detail?: string;
}

/**
 * How a provider retrieves bytes. Phase 0 ships a minimal HTTP + local-fixture
 * runtime; later phases extend it with the Playwright pool and managed-fetch
 * escalation ladder WITHOUT changing the provider contract.
 */
export interface FetchRuntime {
  /** Fetch a URL and parse the JSON body. */
  fetchJson<T = unknown>(url: string, init?: FetchRuntimeInit): Promise<T>;
  /** Fetch a URL and return the raw text body (e.g. HTML). */
  fetchText(url: string, init?: FetchRuntimeInit): Promise<string>;
  /** Load a bundled local fixture by key (used by the fixture provider). */
  loadFixture<T = unknown>(key: string): Promise<T>;
  /**
   * Escalation tier: fetch a URL through a real (headless) browser, so
   * JS-rendered pages and simple bot walls resolve to real HTML. OPTIONAL —
   * only a runtime wired with a browser pool implements it. Providers never
   * call it directly; the shared fetch ladder escalates to it when the plain
   * HTTP tier hits an anti-bot challenge. Absent on the Phase-0 HTTP runtime.
   */
  fetchViaBrowser?(url: string, init?: FetchRuntimeInit): Promise<string>;
  /**
   * Final escalation tier: fetch a URL through a managed anti-bot fetch service
   * (residential proxies / CAPTCHA solving). OPTIONAL, same contract as
   * {@link fetchViaBrowser}; the ladder escalates here only after the browser
   * tier also hit a challenge. Absent on the Phase-0 HTTP runtime.
   */
  fetchViaManaged?(url: string, init?: FetchRuntimeInit): Promise<string>;
}

/** Minimal request options accepted by the {@link FetchRuntime}. */
export interface FetchRuntimeInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/**
 * A listing provider plugin. Implementations are pure w.r.t. persistence: they
 * never touch Mongo or S3 — they only turn a portal into a
 * {@link NormalizedListing} for the backend `IngestionService`.
 */
export interface ListingProvider {
  readonly id: ProviderId;
  readonly markets: ReadonlyArray<ListingMarket>;
  discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
  fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
  normalize(raw: RawListing): NormalizedListing;
  health(): Promise<ProviderHealth>;
}
