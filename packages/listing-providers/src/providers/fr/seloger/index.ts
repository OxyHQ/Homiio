/**
 * SeLoger provider (France) — JSON-first (`initialData` / `__NEXT_DATA__`) + session.
 * Registered OFF by default (`PROVIDER_SELOGER_ENABLED`).
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
import { SELOGER_BASE_URL } from './fixtures';
import {
  parseSelogerDetail,
  parseSelogerSearch,
  selogerWarmSearchUrl,
  type SelogerRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'seloger';
const DEFAULT_CITIES: readonly string[] = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Lille'];
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'script, main, a[href*=".htm"], [data-testid]';

export function isSelogerChallenge(body: string): boolean {
  if (body.trim().length < 128) return true;
  return /captcha|datadome|just a moment|cloudflare|access denied/i.test(body);
}

export interface SelogerProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): SelogerRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('seloger: normalize received an invalid payload');
  }
  return payload as SelogerRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class SelogerProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['FR'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: SelogerProviderOptions = {}) {
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
        const html = await this.fetchSearchHtml(runtime, city, page, job.signal);
        if (!html) break;
        const refs = parseSelogerSearch(html);
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

  private async fetchSearchHtml(
    runtime: FetchRuntime,
    city: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        latencyMs: 0,
        url: selogerWarmSearchUrl(city, page),
        detail: 'openBrowserSession required (DataDome)',
      });
      return undefined;
    }
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    const warmUrl = selogerWarmSearchUrl(city, page);
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isSelogerChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'fr-FR',
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isSelogerChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: warmUrl,
        });
        return undefined;
      }
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: warmUrl,
      });
      return html;
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
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!ctx.runtime.openBrowserSession) {
      throw new Error('seloger: fetch requires openBrowserSession');
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
        isChallenge: isSelogerChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'fr-FR',
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isSelogerChallenge(html)) throw new Error('seloger: detail still challenged');
      const payload = parseSelogerDetail(html, ref.url);
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      return { ref, payload };
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.city,
        city: listing.city,
        country: 'France',
        countryCode: 'FR',
        postalCode: listing.postalCode,
        coordinates: listing.coordinates,
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: 'EUR' },
      sale: isSale ? { price: listing.price, currency: 'EUR' } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    else if (listing.title) result.description = listing.title;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving FR via ${SELOGER_BASE_URL} (initialData / __NEXT_DATA__)`,
    };
  }
}

export {
  extractSelogerInitialData,
  parseSelogerDetail,
  parseSelogerSearch,
  selogerSourceIdFromUrl,
  selogerWarmSearchUrl,
} from './parse';
