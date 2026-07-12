/**
 * Shared, observability-aware fetch ladder.
 *
 * The plan's acquisition ladder — HTTP → headless browser → managed anti-bot
 * service — lives HERE, once, so no provider re-implements rate limiting,
 * retries, challenge detection or escalation. It walks the tiers exposed by the
 * shared {@link FetchRuntime}:
 *
 *   1. `http`    — a status-aware GET (so 403/429 are classified, not swallowed).
 *   2. `browser` — headless browser (`runtime.fetchViaBrowser`), OPTIONAL.
 *   3. `managed` — managed anti-bot service (`runtime.fetchViaManaged`), OPTIONAL.
 *
 * A tier the runtime does not implement is skipped. As soon as a tier returns a
 * body that is NOT an anti-bot challenge, that body wins. If every available
 * tier is blocked, a {@link ChallengeError} is thrown so the worker can requeue
 * with backoff rather than ingest a CAPTCHA page. Every attempt is recorded to
 * the {@link ProviderMetricsSink} (success / 403 / challenge / latency) — the
 * plan's per-provider observability, shared by every plugin.
 *
 * Official APIs (Idealista) are a PROVIDER concern: a provider tries its API
 * first and only falls back to this HTML ladder, so "official API if usable →
 * HTTP → browser → managed" holds without the ladder knowing about any API.
 */

import type { ProviderId } from '@homiio/shared-types';
import {
  errorMessage,
  hostOf,
  sleep,
} from './http';
import { isAntiBotChallenge } from './parse/challenge';
import {
  defaultProviderMetrics,
  type ProviderMetricsSink,
  type ProviderOutcome,
  type StrategyName,
} from './metrics';
import type { FetchRuntime, FetchRuntimeInit } from './types';

/** The ordered escalation tiers a listing fetch is attempted at. */
const DEFAULT_TIERS: readonly StrategyName[] = ['http', 'browser', 'managed'];

/**
 * Raised when every AVAILABLE tier returned an anti-bot block (403 / CAPTCHA /
 * challenge). Carries the last status + tier so the worker can decide to
 * requeue/alert rather than ingest a challenge page.
 */
export class ChallengeError extends Error {
  constructor(
    readonly url: string,
    readonly tier: StrategyName,
    readonly status: number,
  ) {
    super(`Listing fetch hit an anti-bot block (last tier "${tier}", HTTP ${status}) for ${url}`);
    this.name = 'ChallengeError';
  }
}

/**
 * Classify a tier result. 429/503 and anti-bot-challenge bodies are `challenge`,
 * a bare 403 is `forbidden`, other 4xx/5xx are `error`, else `success`.
 * Anti-bot detection is the shared, precise {@link isAntiBotChallenge} — it keys
 * on vendor CHALLENGE-ONLY artefacts (captcha hosts / interstitial text), so a
 * challenge served with HTTP 200 escalates to the browser tier while a good SERP
 * that merely embeds a passive DataDome sensor or a reCAPTCHA site key stays
 * `success` and never wastes a browser hop. A provider-supplied `isChallenge`
 * catches any portal-specific 200 interstitial the shared markers miss.
 */
export function classifyOutcome(
  status: number,
  body: string,
  isChallenge?: (html: string) => boolean,
): ProviderOutcome {
  if (status === 429 || status === 503) return 'challenge';
  if (isAntiBotChallenge(body)) return 'challenge';
  if (isChallenge && isChallenge(body)) return 'challenge';
  if (status === 403) return 'forbidden';
  if (status >= 400) return 'error';
  return 'success';
}

/**
 * Per-host minimum-interval rate limiter. Serializes the next-allowed instant
 * per host so concurrent callers naturally space out; portals are rate
 * sensitive and this is the single place spacing is enforced.
 */
export class HostRateLimiter {
  private readonly nextAllowedAt = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  async wait(host: string, signal?: AbortSignal): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const now = Date.now();
    const earliest = this.nextAllowedAt.get(host) ?? 0;
    const startAt = Math.max(now, earliest);
    this.nextAllowedAt.set(host, startAt + this.minIntervalMs);
    const delay = startAt - now;
    if (delay > 0) await sleep(delay, signal);
  }
}

/** Process-wide default rate limiter (single spacing authority per host). */
export const defaultRateLimiter = new HostRateLimiter(1_500);

/** The winning tier plus the HTML it produced and the status observed. */
export interface ListingFetchResult {
  tier: StrategyName;
  html: string;
  status: number;
}

/** Options for {@link fetchListingViaLadder}. */
export interface ListingLadderOptions {
  /** Provider the fetch is attributed to (drives metrics + rate scoping). */
  provider: ProviderId;
  /** Provider-specific test for a 200 interstitial/CAPTCHA body. */
  isChallenge?: (html: string) => boolean;
  /** Per-request options forwarded to browser/managed tiers (signal, timeout). */
  init?: FetchRuntimeInit;
  /** Override the escalation order/subset (default http → browser → managed). */
  tiers?: readonly StrategyName[];
  /** Metrics sink; defaults to the process-wide {@link defaultProviderMetrics}. */
  metrics?: ProviderMetricsSink;
  /** Rate limiter; defaults to the process-wide {@link defaultRateLimiter}. */
  rateLimiter?: HostRateLimiter;
  /** Transient-network-error retry budget for the HTTP tier. */
  maxRetries?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Walk the fetch tiers until one yields non-challenge HTML. Records one metric
 * event per attempt. Throws {@link ChallengeError} when every available tier is
 * blocked, or the last transient error when a tier keeps erroring and no other
 * tier is available.
 */
export async function fetchListingViaLadder(
  runtime: FetchRuntime,
  url: string,
  options: ListingLadderOptions,
): Promise<ListingFetchResult> {
  const tiers = options.tiers ?? DEFAULT_TIERS;
  const metrics = options.metrics ?? defaultProviderMetrics;
  const rateLimiter = options.rateLimiter ?? defaultRateLimiter;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const host = hostOf(url);

  let attempted = false;
  let lastError: unknown;
  let lastStatus = 0;
  let lastTier: StrategyName = 'http';

  for (const tier of tiers) {
    const run = resolveRunner(runtime, tier, url, options.init);
    if (!run) continue;
    attempted = true;
    lastTier = tier;
    const start = Date.now();
    try {
      const { status, body } = await withRetries(
        () => run(),
        // Only the network-heavy HTTP tier retries transient errors.
        tier === 'http' ? maxRetries : 0,
        options.init?.signal,
      );
      lastStatus = status;
      const outcome = classifyOutcome(status, body, options.isChallenge);
      metrics.record({ provider: options.provider, strategy: tier, outcome, status, latencyMs: Date.now() - start, url });
      if (outcome === 'success') {
        return { tier, html: body, status };
      }
      lastError = new ChallengeError(url, tier, status);
    } catch (error) {
      metrics.record({
        provider: options.provider,
        strategy: tier,
        outcome: 'error',
        latencyMs: Date.now() - start,
        url,
        detail: errorMessage(error),
      });
      lastError = error;
    }
    await rateLimiter.wait(host, options.init?.signal);
  }

  if (!attempted) {
    throw new Error(`No fetch tier available for ${url}`);
  }
  if (lastError instanceof ChallengeError) throw lastError;
  if (lastError instanceof Error) throw lastError;
  throw new ChallengeError(url, lastTier, lastStatus);
}

/** Build the concrete runner for a tier (rate-limits before each call). */
function resolveRunner(
  runtime: FetchRuntime,
  tier: StrategyName,
  url: string,
  init: FetchRuntimeInit | undefined,
): (() => Promise<{ status: number; body: string }>) | undefined {
  if (tier === 'http') {
    return () => runtime.fetchHttp(url, init);
  }
  if (tier === 'browser' && runtime.fetchViaBrowser) {
    const fetchViaBrowser = runtime.fetchViaBrowser.bind(runtime);
    return async () => ({ status: 200, body: await fetchViaBrowser(url, init) });
  }
  if (tier === 'managed' && runtime.fetchViaManaged) {
    const fetchViaManaged = runtime.fetchViaManaged.bind(runtime);
    return async () => ({ status: 200, body: await fetchViaManaged(url, init) });
  }
  return undefined;
}

/** Retry a runner on thrown (transient) errors with exponential backoff. */
async function withRetries<T>(run: () => Promise<T>, retries: number, signal?: AbortSignal): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= retries) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > retries) break;
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
