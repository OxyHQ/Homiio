/**
 * milanuncios.com provider (Spain) — general classifieds, REAL-ESTATE ONLY.
 *
 * Classifieds providers must scope discover to real-estate categories and reject
 * non-housing in normalize. Discover uses housing category URLs + AJAX list
 * endpoints from a warmed Playwright session (GeeTest blocks cold HTTP). HTML
 * scrape is last resort and still filtered by category allowlist.
 *
 * Registered OFF by default (`PROVIDER_MILANUNCIOS_ENABLED`). Do NOT enable in
 * prod until the housing filter is verified end-to-end.
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
import { isHousingCategoryUrl } from '../../parse/classifieds';
import {
  MILANUNCIOS_BASE_URL,
  MILANUNCIOS_HOUSING_CATEGORY_SLUGS,
  milanunciosHousingSearchUrl,
  milanunciosListAjaxUrl,
} from './fixtures';
import {
  milanunciosSourceIdFromUrl,
  normalizeMilanunciosRaw,
  parseMilanunciosAdvert,
  parseMilanunciosSearchJson,
  type MilanunciosRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'milanuncios';
const DEFAULT_CITIES: readonly string[] = ['madrid', 'barcelona', 'valencia'];
const MAX_SEARCH_PAGES = 3;

export function isMilanunciosChallenge(body: string): boolean {
  if (body.trim().length < 256) return true;
  return /pardon our interruption|geetest|captcha|datadome|access denied/i.test(body);
}

export interface MilanunciosProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asMilanunciosRaw(payload: unknown): MilanunciosRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown; city?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.price !== 'number'
  ) {
    throw new Error('milanuncios: normalize received a payload that is not a MilanunciosRaw');
  }
  return payload as MilanunciosRaw;
}

export class MilanunciosProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: MilanunciosProviderOptions = {}) {
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

    for (const city of cities) {
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded >= limit) return;
        const warmUrl = milanunciosHousingSearchUrl(city, page);
        if (!isHousingCategoryUrl(warmUrl, MILANUNCIOS_HOUSING_CATEGORY_SLUGS)) {
          throw new Error(`milanuncios: refuse non-housing discover URL ${warmUrl}`);
        }

        const refs = runtime.openBrowserSession
          ? await this.discoverViaSession(runtime, city, page, warmUrl, job.signal)
          : [];

        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
          yielded += 1;
        }
      }
    }
  }

  private async discoverViaSession(
    runtime: FetchRuntime,
    city: string,
    page: number,
    warmUrl: string,
    signal: AbortSignal | undefined,
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];
    const start = Date.now();
    let session: Awaited<ReturnType<NonNullable<FetchRuntime['openBrowserSession']>>> | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: 'article, .aditem, main, h1',
        isChallenge: isMilanunciosChallenge,
        challengeWaitMs: 45_000,
        blockAssets: true,
      });

      const ajaxUrl = milanunciosListAjaxUrl(city, page);
      const { status, body } = await session.request(ajaxUrl, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
      });

      if (status === 403 || status === 405 || status === 429 || isMilanunciosChallenge(body)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
          detail: 'milanuncios list AJAX challenged',
        });
        return [];
      }

      const pageRefs = parseMilanunciosSearchJson(body);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status,
        latencyMs: Date.now() - start,
        url: ajaxUrl,
      });
      return pageRefs.map((ref) => ({ provider: this.id, sourceId: ref.sourceId, url: ref.url }));
    } catch {
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'challenge',
        latencyMs: Date.now() - start,
        url: warmUrl,
        detail: 'milanuncios session warm-up failed (GeeTest likely)',
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!isHousingCategoryUrl(ref.url, MILANUNCIOS_HOUSING_CATEGORY_SLUGS) && !ref.url.includes('inmobiliaria')) {
      // Still allow detail URLs that embed the id but carry housing hints in path.
      if (!/piso|casa|chalet|habitacion|atico|duplex|inmueble|alquiler|venta/i.test(ref.url)) {
        throw new Error(`milanuncios: refuse fetch of non-housing URL ${ref.url}`);
      }
    }

    if (!ctx.runtime.openBrowserSession) {
      throw new Error('milanuncios: fetch requires openBrowserSession (GeeTest)');
    }

    const start = Date.now();
    const session = await ctx.runtime.openBrowserSession({
      warmUrl: ref.url,
      signal: ctx.signal,
      contentSelector: 'h1, article, main',
      isChallenge: isMilanunciosChallenge,
      challengeWaitMs: 45_000,
      blockAssets: true,
    });
    try {
      // Prefer detail JSON if an API sibling exists; fall back to parsing __NEXT_DATA__ / embedded JSON.
      const apiCandidates = [
        `${MILANUNCIOS_BASE_URL}/api/v3/adverts/${ref.sourceId}`,
        `${MILANUNCIOS_BASE_URL}/api/v2/adverts/${ref.sourceId}`,
      ];
      for (const apiUrl of apiCandidates) {
        const { status, body } = await session.request(apiUrl, {
          referer: ref.url,
          timeoutMs: 20_000,
        });
        if (status >= 200 && status < 300 && body.trim().startsWith('{') && !isMilanunciosChallenge(body)) {
          const payload = parseMilanunciosAdvert(JSON.parse(body) as unknown, ref.url);
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'success',
            status,
            latencyMs: Date.now() - start,
            url: apiUrl,
          });
          return { ref, payload };
        }
      }

      const html = await session.content();
      if (isMilanunciosChallenge(html)) {
        throw new Error('milanuncios: detail page still challenged');
      }
      // Last resort: look for embedded JSON advert blob.
      const embedded = html.match(
        /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      )?.[1];
      if (embedded) {
        const next = JSON.parse(embedded) as { props?: { pageProps?: { advert?: unknown } } };
        const advert = next.props?.pageProps?.advert;
        if (advert) {
          return { ref, payload: parseMilanunciosAdvert(advert, ref.url) };
        }
      }
      throw new Error(`milanuncios: no JSON advert payload for ${ref.sourceId}`);
    } finally {
      await session.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    return normalizeMilanunciosRaw(asMilanunciosRaw(raw.payload));
  }

  async health(): Promise<ProviderHealth> {
    const snapshot = this.metrics.snapshot(this.id);
    if (snapshot && snapshot.attempts > 0) {
      const status =
        snapshot.challengeRate >= 0.8 ? 'unhealthy' : snapshot.challengeRate >= 0.3 ? 'degraded' : 'healthy';
      return {
        provider: this.id,
        status,
        detail: `attempts=${snapshot.attempts} challengeRate=${snapshot.challengeRate.toFixed(2)}`,
      };
    }
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ES housing-only via ${MILANUNCIOS_BASE_URL} (GeeTest; OFF until verified)`,
    };
  }
}

export { milanunciosSourceIdFromUrl, normalizeMilanunciosRaw, parseMilanunciosAdvert };
