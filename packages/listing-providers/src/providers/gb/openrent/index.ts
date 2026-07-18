/**
 * OpenRent provider (United Kingdom) — housing-native private lets.
 *
 * Discover pages `/properties-to-rent/<city>` for detail links. Detail parse is
 * title/og-image based (no public AJAX); contact captured when tel:/mailto
 * appear. Viable without a browser for many pages; session used when challenged.
 *
 * Registered OFF by default (`PROVIDER_OPENRENT_ENABLED`).
 */

import {
  OfferingType,
  type NormalizedListing,
  type NormalizedListingAddress,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
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
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { providerMaxSearchPages } from '../../../discoverLimits';
import { DEFAULT_GB_CITIES } from '../../../parse/defaultMarketCities';
import { isGbPortalChallenge } from '../challenge';
import { resolveGbPropertyType, splitGbDisplayAddress } from '../housing';
import { OPENRENT_BASE_URL } from './fixtures';
import {
  openrentSearchUrl,
  openrentSourceIdFromUrl,
  parseOpenRentDetail,
  parseOpenRentSearch,
  type OpenRentListingJson,
} from './parse';

const PROVIDER_ID: ProviderId = 'openrent';
const DEFAULT_MAX_SEARCH_PAGES = 50;

export function isOpenRentChallenge(html: string): boolean {
  return isGbPortalChallenge(html);
}

export interface OpenRentProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asOpenRentRaw(payload: unknown): OpenRentListingJson {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('openrent: normalize received an invalid payload');
  }
  return payload as OpenRentListingJson;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class OpenRentProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['GB'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly maxSearchPages: number;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: OpenRentProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_GB_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.maxSearchPages = providerMaxSearchPages(PROVIDER_ID, DEFAULT_MAX_SEARCH_PAGES, 'GB');
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      for (let page = 1; page <= this.maxSearchPages; page += 1) {
        if (yielded >= limit) return;
        const searchUrl = openrentSearchUrl(city, page);
        let html: string | undefined;
        if (runtime.openBrowserSession) {
          html = await this.fetchHtmlViaSession(runtime, searchUrl, job.signal);
        }
        if (!html) {
          try {
            const result = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isOpenRentChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            html = result.html;
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }
        const refs = parseOpenRentSearch(html);
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yielded += 1;
          yield { provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url };
        }
      }
    }
  }

  private async fetchHtmlViaSession(
    runtime: FetchRuntime,
    url: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: url,
        signal,
        contentSelector: 'a[href*="/property-to-rent/"], h1, title',
        isChallenge: isOpenRentChallenge,
        challengeWaitMs: 30_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const html = await this.fetchHtmlViaSession(ctx.runtime, ref.url, ctx.signal);
      if (html) return { ref, payload: parseOpenRentDetail(html, ref.url) };
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isOpenRentChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseOpenRentDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asOpenRentRaw(raw.payload);
    if (listing.priceAmount === undefined) {
      throw new Error(`openrent: listing ${listing.sourceId} has no resolvable price`);
    }
    const split = splitGbDisplayAddress(listing.displayAddress);
    const address: NormalizedListingAddress = {
      street: split.street,
      city: split.city,
      country: 'United Kingdom',
      countryCode: 'GB',
      postalCode: split.postalCode,
    };
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address,
      type: resolveGbPropertyType(listing.propertyType),
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' },
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.title) result.description = listing.title;
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
      detail: `Serving GB via ${OPENRENT_BASE_URL} (housing-native private lets)`,
    };
  }
}

export { openrentSourceIdFromUrl };
