/**
 * MercadoLibre Ecuador inmuebles — classifieds housing-only.
 * Flag: PROVIDER_MERCADOLIBRE_EC_ENABLED (OFF by default).
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
import { isHousingCategoryUrl } from '../../../classifieds';
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
import { MERCADOLIBRE_EC_BASE_URL, MERCADOLIBRE_EC_HOUSING_SLUGS } from './fixtures';
import {
  isMercadolibreEcChallenge,
  mercadolibreEcHousingSearchUrl,
  parseMercadolibreEcDetail,
  parseMercadolibreEcItemJson,
  parseMercadolibreEcSearch,
  type MercadolibreEcRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'mercadolibre_ec';
const DEFAULT_CITIES = ['quito', 'guayaquil', 'cuenca'] as const;
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'ol.ui-search-layout, a[href*="MEC-"], script, main';

export interface MercadolibreEcProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): MercadolibreEcRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('mercadolibre_ec: invalid normalize payload');
  }
  return payload as MercadolibreEcRawListing;
}

export class MercadolibreEcProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['EC'] as const;
  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: MercadolibreEcProviderOptions = {}) {
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
        const warmUrl = mercadolibreEcHousingSearchUrl(city, page);
        if (!isHousingCategoryUrl(warmUrl, MERCADOLIBRE_EC_HOUSING_SLUGS)) {
          throw new Error(`mercadolibre_ec: refuse non-housing URL ${warmUrl}`);
        }
        const refs = await this.discoverViaSession(runtime, warmUrl, job.signal);
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
    warmUrl: string,
    signal?: AbortSignal,
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isMercadolibreEcChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-EC',
        acceptLanguage: 'es-EC,es;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isMercadolibreEcChallenge(html)) {
        this.metrics.record({ provider: this.id, strategy: 'browser', outcome: 'challenge', latencyMs: Date.now() - start, url: warmUrl });
        return [];
      }
      const refs = parseMercadolibreEcSearch(html);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: refs.length > 0 ? 'success' : 'error',
        status: 200,
        latencyMs: Date.now() - start,
        url: warmUrl,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return refs.map((ref) => ({ provider: this.id, sourceId: ref.sourceId, url: ref.url }));
    } catch (error) {
      const detail =
        error instanceof BrowserSessionChallengeError
          ? error.detail
          : error instanceof Error
            ? error.message
            : String(error);
      this.metrics.record({ provider: this.id, strategy: 'browser', outcome: 'challenge', latencyMs: Date.now() - start, url: warmUrl, detail });
      return [];
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!ctx.runtime.openBrowserSession) throw new Error('mercadolibre_ec: openBrowserSession required');
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isMercadolibreEcChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-EC',
        acceptLanguage: 'es-EC,es;q=0.9,en;q=0.8',
      });
      const numericId = ref.sourceId.replace(/\D/g, '');
      const apiUrl = `https://api.mercadolibre.com/items/MEC${numericId}`;
      try {
        const { status, body } = await session.request(apiUrl, { referer: ref.url, timeoutMs: 20_000 });
        if (status >= 200 && status < 300 && body.trim().startsWith('{')) {
          const payload = parseMercadolibreEcItemJson(body, ref.url);
          this.metrics.record({ provider: this.id, strategy: 'browser', outcome: 'success', status, latencyMs: Date.now() - start, url: apiUrl });
          if (sticky) this.stickyStorageState = await session.exportStorageState();
          return { ref, payload };
        }
      } catch {
        // HTML
      }
      const html = await session.content();
      if (isMercadolibreEcChallenge(html)) throw new Error('mercadolibre_ec: detail challenged');
      const payload = parseMercadolibreEcDetail(html, ref.url);
      this.metrics.record({ provider: this.id, strategy: 'browser', outcome: 'success', status: 200, latencyMs: Date.now() - start, url: ref.url });
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
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: listing.images.map((url, index) => ({ url, isPrimary: index === 0 })),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return { provider: this.id, status: 'healthy', detail: `Serving EC housing-only via ${MERCADOLIBRE_EC_BASE_URL}` };
  }
}

export {
  isMercadolibreEcChallenge,
  isMercadolibreEcHousingCategory,
  mercadolibreEcHousingSearchUrl,
  mercadolibreEcSourceIdFromUrl,
  parseMercadolibreEcDetail,
  parseMercadolibreEcSearch,
  parseMercadolibreEcSearchJson,
} from './parse';
