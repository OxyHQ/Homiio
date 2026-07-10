/**
 * Properati provider (Argentina) — JSON-LD / `__NEXT_DATA__` + Playwright session.
 *
 * Cloudflare often blocks cold HTTP; session warm required for live ingest.
 * Uses shared {@link ../../../nextData}, {@link ../../../jsonLd}, {@link ../../../contact}.
 * Registered OFF by default (`PROVIDER_PROPERATI_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { BrowserSessionChallengeError } from '../../../session';
import { createProxySessionId, envBool } from '../../../proxy';
import { citySlug } from '../../../slug';
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
import { PROPERATI_BASE_URL } from './fixtures';
import {
  isProperatiChallenge,
  parseProperatiDetail,
  parseProperatiSearch,
  type ProperatiRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'properati';
const DEFAULT_CITIES: readonly string[] = [
  'capital-federal',
  'cordoba',
  'rosario',
  'mendoza',
  'la-plata',
];
const MAX_SEARCH_PAGES = 2;
const CONTENT_SELECTOR = 'script#__NEXT_DATA__, a[href*="/detalle/"], main, h1';

export interface ProperatiProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function searchUrl(city: string, page: number, kind: 'alquiler' | 'venta'): string {
  const slug = citySlug(city);
  const base = `${PROPERATI_BASE_URL}/s/${slug}/departamento/${kind}`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

function asRaw(payload: unknown): ProperatiRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('properati: normalize received an invalid payload');
  }
  return payload as ProperatiRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class ProperatiProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['AR'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: ProperatiProviderOptions = {}) {
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
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    const warmUrl = searchUrl(city, page, kind);
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isProperatiChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-AR',
        acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isProperatiChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: warmUrl,
        });
        return [];
      }
      const refs = parseProperatiSearch(html);
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
    if (!ctx.runtime.openBrowserSession) {
      throw new Error('properati: fetch requires openBrowserSession (Cloudflare)');
    }
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isProperatiChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-AR',
        acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isProperatiChallenge(html)) {
        throw new Error('properati: detail still challenged');
      }
      const payload = parseProperatiDetail(html, ref.url);
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
        street: listing.address.street ?? listing.address.neighborhood ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: 'Argentina',
        countryCode: 'AR',
        neighborhood: listing.address.neighborhood,
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
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
      detail: `Serving AR via ${PROPERATI_BASE_URL} (__NEXT_DATA__ / JSON-LD, Cloudflare-gated)`,
    };
  }
}

export {
  isProperatiChallenge,
  parseProperatiDetail,
  parseProperatiSearch,
  properatiSourceIdFromUrl,
} from './parse';
