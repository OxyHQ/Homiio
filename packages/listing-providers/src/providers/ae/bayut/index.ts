/**
 * Bayut provider (UAE — Dubai / Abu Dhabi).
 *
 * JSON-first via embedded `__NEXT_DATA__` on search + detail pages. Live site
 * is hb-captcha gated from datacenter IPs — prefer warmed Playwright session,
 * then fetch ladder. Registered OFF by default (`PROVIDER_BAYUT_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
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
import { citySlug } from '../../../slug';
import { BAYUT_BASE_URL } from './fixtures';
import {
  bayutSearchUrl,
  isBayutChallenge,
  parseBayutDetail,
  parseBayutSearch,
  type BayutRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'bayut';

const DEFAULT_CITIES: readonly string[] = ['dubai', 'abu-dhabi'];

const CONTENT_SELECTOR = 'script#__NEXT_DATA__, main, [data-testid]';

export interface BayutProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): BayutRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale')
  ) {
    throw new Error('bayut: normalize received an invalid payload');
  }
  return payload as BayutRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class BayutProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['AE'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: BayutProviderOptions = {}) {
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
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'AE');
    const purposes: readonly ('for-rent' | 'for-sale')[] = ['for-rent', 'for-sale'];

    for (const city of cities) {
      const slug = citySlug(city);
      for (const purpose of purposes) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const pageUrl = bayutSearchUrl(slug, purpose, page);
          const html = await this.fetchHtml(runtime, pageUrl, job.signal);
          if (!html) break;
          const refs = parseBayutSearch(html);
          if (refs.length === 0) break;
          for (const ref of refs) {
            if (yielded >= limit) return;
            if (seen.has(ref.sourceId)) continue;
            seen.add(ref.sourceId);
            yield {
              provider: this.id,
              sourceId: ref.sourceId,
              url: ref.url,
              hints: { kind: ref.kind, city: slug },
            };
            yielded += 1;
          }
        }
      }
    }
  }

  private async fetchHtml(
    runtime: FetchRuntime,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (runtime.openBrowserSession) {
      const fromSession = await this.fetchViaSession(runtime, pageUrl, signal);
      if (fromSession) return fromSession;
    }
    try {
      const ladder = await fetchListingViaLadder(runtime, pageUrl, {
        provider: this.id,
        isChallenge: isBayutChallenge,
        metrics: this.metrics,
        init: {
          signal,
          headers: {
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: `${BAYUT_BASE_URL}/`,
          },
        },
      });
      return ladder.html;
    } catch (error) {
      if (error instanceof ChallengeError) return undefined;
      throw error;
    }
  }

  private async fetchViaSession(
    runtime: FetchRuntime,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: pageUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isBayutChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'en-AE',
        acceptLanguage: 'en-US,en;q=0.9',
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return isBayutChallenge(html) ? undefined : html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const html = await this.fetchHtml(ctx.runtime, ref.url, ctx.signal);
    if (!html) {
      throw new Error(`bayut: could not fetch detail for ${ref.sourceId}`);
    }
    const payload = parseBayutDetail(html, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.state,
        neighborhood: listing.address.neighborhood,
        country: 'United Arab Emirates',
        countryCode: listing.address.countryCode,
        coordinates: listing.address.coordinates,
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale
        ? undefined
        : { monthlyAmount: listing.price, currency: listing.currency },
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
      status: 'degraded',
      detail: `${BAYUT_BASE_URL} hb-captcha gated — keep OFF until AE residential/browser discover works`,
    };
  }
}

export {
  bayutSourceIdFromUrl,
  isBayutChallenge,
  parseBayutDetail,
  parseBayutSearch,
} from './parse';
