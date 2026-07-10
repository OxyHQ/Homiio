/**
 * Plusvalía (Ecuador) — thin Navent wrapper. Shared parse in {@link ../../../navent}.
 * Flag: PROVIDER_PLUSVALIA_ENABLED (OFF by default).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { BrowserSessionChallengeError } from '../../../session';
import { createProxySessionId, envBool } from '../../../proxy';
import { citySlug } from '../../../slug';
import {
  isNaventChallenge,
  naventPostingDetailApiUrls,
  naventPostingsApiUrl,
  parseNaventDetail,
  parseNaventPostingJson,
  parseNaventSearch,
  parseNaventSearchJson,
  type NaventRawListing,
  type NaventSiteConfig,
} from '../../../navent';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../../types';
import { createFetchRuntime } from '../../../runtime';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { PLUSVALIA_BASE_URL } from './fixtures';

const PROVIDER_ID: ProviderId = 'plusvalia';
const DEFAULT_CITIES = ['quito', 'guayaquil', 'cuenca', 'manta', 'ambato'] as const;
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'a[href*="/propiedades/"], script, main, h1';

const SITE: NaventSiteConfig = {
  provider: PROVIDER_ID,
  baseUrl: PLUSVALIA_BASE_URL,
  countryCode: 'EC',
  defaultCity: 'Quito',
  defaultCurrency: 'USD',
  hrefRe: /href="((?:https:\/\/www\.plusvalia\.com)?\/propiedades\/[^"]+-(\d{5,})\.html)"/gi,
};

export interface PlusvaliaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function searchUrl(city: string, page: number, kind: 'alquiler' | 'venta'): string {
  const base = `${PLUSVALIA_BASE_URL}/departamentos-${kind}-${citySlug(city)}.html`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

function asRaw(payload: unknown): NaventRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('plusvalia: invalid normalize payload');
  }
  return payload as NaventRawListing;
}

function resolveType(raw: string | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (/casa|house|chalet/.test(lower)) return PropertyType.HOUSE;
  if (/studio|estudio/.test(lower)) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

export class PlusvaliaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['EC'] as const;
  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: PlusvaliaProviderOptions = {}) {
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
      for (const kind of ['alquiler', 'venta'] as const) {
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          if (yielded >= limit) return;
          const refs = await this.discoverPage(runtime, city, kind, page, job.signal);
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
  }

  private async discoverPage(
    runtime: FetchRuntime,
    city: string,
    kind: 'alquiler' | 'venta',
    page: number,
    signal?: AbortSignal,
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    const warmUrl = searchUrl(city, page, kind);
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isNaventChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-EC',
        acceptLanguage: 'es-EC,es;q=0.9,en;q=0.8',
      });
      let refs: ExternalListingRef[] = [];
      try {
        const { status, body } = await session.request(naventPostingsApiUrl(SITE), {
          referer: warmUrl,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          timeoutMs: 30_000,
        });
        if (status >= 200 && status < 300 && !isNaventChallenge(body)) {
          refs = parseNaventSearchJson(SITE, body).map((r) => ({
            provider: this.id,
            sourceId: r.sourceId,
            url: r.url,
          }));
        }
      } catch {
        // HTML fallback
      }
      if (refs.length === 0) {
        const html = await session.content();
        if (!isNaventChallenge(html)) {
          refs = parseNaventSearch(SITE, html).map((r) => ({
            provider: this.id,
            sourceId: r.sourceId,
            url: r.url,
          }));
        }
      }
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: refs.length > 0 ? 'success' : 'challenge',
        status: 200,
        latencyMs: Date.now() - start,
        url: warmUrl,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return refs;
    } catch (error) {
      const detail =
        error instanceof BrowserSessionChallengeError
          ? error.detail
          : error instanceof Error
            ? error.message
            : String(error);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'challenge',
        latencyMs: Date.now() - start,
        url: warmUrl,
        detail,
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!ctx.runtime.openBrowserSession) throw new Error('plusvalia: openBrowserSession required');
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isNaventChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-EC',
        acceptLanguage: 'es-EC,es;q=0.9,en;q=0.8',
      });
      for (const apiUrl of naventPostingDetailApiUrls(SITE, ref.sourceId)) {
        try {
          const { status, body } = await session.request(apiUrl, { referer: ref.url, timeoutMs: 20_000 });
          if (status >= 200 && status < 300 && body.trim().startsWith('{') && !isNaventChallenge(body)) {
            const payload = parseNaventPostingJson(SITE, body, ref.url);
            this.metrics.record({
              provider: this.id,
              strategy: 'browser',
              outcome: 'success',
              status,
              latencyMs: Date.now() - start,
              url: apiUrl,
            });
            if (sticky) this.stickyStorageState = await session.exportStorageState();
            return { ref, payload };
          }
        } catch {
          // continue
        }
      }
      const html = await session.content();
      if (isNaventChallenge(html)) throw new Error('plusvalia: detail challenged');
      const payload = parseNaventDetail(SITE, html, ref.url);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return { ref, payload };
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.operation === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: 'Ecuador',
        countryCode: 'EC',
        coordinates: listing.coordinates,
      },
      type: resolveType(listing.propertyType),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: listing.images.map((url, index) => ({ url, isPrimary: index === 0 })),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    else if (listing.title) result.description = listing.title;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving EC via ${PLUSVALIA_BASE_URL} (shared Navent JSON + session)`,
    };
  }
}

export { isNaventChallenge as isPlusvaliaChallenge, naventSourceIdFromUrl as plusvaliaSourceIdFromUrl } from '../../../navent';
