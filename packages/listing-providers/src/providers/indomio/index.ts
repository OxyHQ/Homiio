/**
 * indomio.es provider — JSON/AJAX via Playwright session; HTML last resort.
 * Registered OFF (`PROVIDER_INDOMIO_ENABLED`). Cloudflare currently blocks
 * cold + proxy sessions; keep OFF until managed tier or session clears.
 */

import type { NormalizedListing, ProviderId } from '@homiio/shared-types';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../types';
import { createFetchRuntime } from '../../runtime';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import { INDOMIO_BASE_URL, indomioListAjaxUrl, indomioSearchUrl } from './fixtures';
import {
  normalizeIndomioRaw,
  parseIndomioDetailJson,
  parseIndomioSearchJson,
  type IndomioRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'indomio';
const DEFAULT_CITIES: readonly string[] = ['madrid', 'barcelona', 'valencia'];
const MAX_SEARCH_PAGES = 3;

export function isIndomioChallenge(body: string): boolean {
  if (body.trim().length < 512) return true;
  return /just a moment|cloudflare|cf-browser|captcha|access denied|datadome/i.test(body);
}

export interface IndomioProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): IndomioRaw {
  const record = payload as { sourceId?: unknown; price?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.price !== 'number') {
    throw new Error('indomio: normalize received an invalid payload');
  }
  return payload as IndomioRaw;
}

export class IndomioProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;
  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: IndomioProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;
    const runtime = job.runtime ?? this.runtime;
    if (!runtime.openBrowserSession) return;

    for (const city of cities) {
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded >= limit) return;
        const warmUrl = indomioSearchUrl(city, page);
        let session: Awaited<ReturnType<NonNullable<FetchRuntime['openBrowserSession']>>> | undefined;
        const start = Date.now();
        try {
          session = await runtime.openBrowserSession({
            warmUrl,
            signal: job.signal,
            contentSelector: 'article, main, h1',
            isChallenge: isIndomioChallenge,
            challengeWaitMs: 45_000,
            blockAssets: true,
          });
          const ajaxUrl = indomioListAjaxUrl(city, page);
          const { status, body } = await session.request(ajaxUrl, {
            referer: session.pageUrl(),
            timeoutMs: 30_000,
          });
          if (status >= 400 || isIndomioChallenge(body)) {
            this.metrics.record({
              provider: this.id,
              strategy: 'browser',
              outcome: 'challenge',
              status,
              latencyMs: Date.now() - start,
              url: ajaxUrl,
            });
            break;
          }
          const refs = parseIndomioSearchJson(body);
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'success',
            status,
            latencyMs: Date.now() - start,
            url: ajaxUrl,
          });
          if (refs.length === 0) break;
          for (const ref of refs) {
            if (yielded >= limit) return;
            if (seen.has(ref.sourceId)) continue;
            seen.add(ref.sourceId);
            yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
            yielded += 1;
          }
        } catch {
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'challenge',
            latencyMs: Date.now() - start,
            url: warmUrl,
          });
          break;
        } finally {
          await session?.close();
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!ctx.runtime.openBrowserSession) {
      throw new Error('indomio: fetch requires openBrowserSession');
    }
    const session = await ctx.runtime.openBrowserSession({
      warmUrl: ref.url,
      signal: ctx.signal,
      contentSelector: 'h1, main',
      isChallenge: isIndomioChallenge,
      challengeWaitMs: 45_000,
      blockAssets: true,
    });
    try {
      const apiUrl = `${INDOMIO_BASE_URL}/api/listing/${ref.sourceId}`;
      const { status, body } = await session.request(apiUrl, {
        referer: ref.url,
        timeoutMs: 20_000,
      });
      if (status >= 200 && status < 300 && body.trim().startsWith('{') && !isIndomioChallenge(body)) {
        return { ref, payload: parseIndomioDetailJson(JSON.parse(body) as unknown, ref.url) };
      }
      throw new Error(`indomio: no JSON detail for ${ref.sourceId} (status=${status})`);
    } finally {
      await session.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    return normalizeIndomioRaw(asRaw(raw.payload));
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ES via ${INDOMIO_BASE_URL} (Cloudflare-gated; OFF until session clears)`,
    };
  }
}
