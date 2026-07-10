/**
 * yaencontre.com provider — JSON/AJAX via Playwright session; HTML last resort.
 * Registered OFF (`PROVIDER_YAENCONTRE_ENABLED`). Cloudflare currently blocks
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
import { YAENCONTRE_BASE_URL, yaencontreListAjaxUrl, yaencontreSearchUrl } from './fixtures';
import {
  normalizeYaencontreRaw,
  parseYaencontreDetailJson,
  parseYaencontreSearchJson,
  type YaencontreRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'yaencontre';
const DEFAULT_CITIES: readonly string[] = ['madrid', 'barcelona', 'valencia'];
const MAX_SEARCH_PAGES = 3;

export function isYaencontreChallenge(body: string): boolean {
  if (body.trim().length < 512) return true;
  return /just a moment|cloudflare|cf-browser|captcha|access denied|datadome/i.test(body);
}

export interface YaencontreProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): YaencontreRaw {
  const record = payload as { sourceId?: unknown; price?: unknown; city?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.price !== 'number') {
    throw new Error('yaencontre: normalize received an invalid payload');
  }
  return payload as YaencontreRaw;
}

export class YaencontreProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;
  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: YaencontreProviderOptions = {}) {
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
        const warmUrl = yaencontreSearchUrl(city, page);
        let session: Awaited<ReturnType<NonNullable<FetchRuntime['openBrowserSession']>>> | undefined;
        const start = Date.now();
        try {
          session = await runtime.openBrowserSession({
            warmUrl,
            signal: job.signal,
            contentSelector: 'article, main, h1',
            isChallenge: isYaencontreChallenge,
            challengeWaitMs: 45_000,
            blockAssets: true,
          });
          const ajaxUrl = yaencontreListAjaxUrl(city, page);
          const { status, body } = await session.request(ajaxUrl, {
            referer: session.pageUrl(),
            timeoutMs: 30_000,
          });
          if (status >= 400 || isYaencontreChallenge(body)) {
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
          const refs = parseYaencontreSearchJson(body);
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
      throw new Error('yaencontre: fetch requires openBrowserSession');
    }
    const session = await ctx.runtime.openBrowserSession({
      warmUrl: ref.url,
      signal: ctx.signal,
      contentSelector: 'h1, main',
      isChallenge: isYaencontreChallenge,
      challengeWaitMs: 45_000,
      blockAssets: true,
    });
    try {
      const apiUrl = `${YAENCONTRE_BASE_URL}/api/listing/${ref.sourceId}`;
      const { status, body } = await session.request(apiUrl, {
        referer: ref.url,
        timeoutMs: 20_000,
      });
      if (status >= 200 && status < 300 && body.trim().startsWith('{') && !isYaencontreChallenge(body)) {
        return { ref, payload: parseYaencontreDetailJson(JSON.parse(body) as unknown, ref.url) };
      }
      throw new Error(`yaencontre: no JSON detail for ${ref.sourceId} (status=${status})`);
    } finally {
      await session.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    return normalizeYaencontreRaw(asRaw(raw.payload));
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ES via ${YAENCONTRE_BASE_URL} (Cloudflare-gated; OFF until session clears)`,
    };
  }
}
