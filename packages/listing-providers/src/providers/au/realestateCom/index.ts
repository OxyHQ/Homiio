/**
 * realestate.com.au provider (Australia).
 *
 * JSON-first via embedded `window.ArgonautExchange` (search + detail). Kasada
 * blocks datacenter HTTP — prefer warmed Playwright session, then fetch ladder.
 * Registered OFF by default (`PROVIDER_REALESTATE_COM_AU_ENABLED`).
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
import { REALESTATE_COM_AU_BASE_URL } from './fixtures';
import {
  isRealestateComAuChallenge,
  parseRealestateComAuDetail,
  parseRealestateComAuSearch,
  realestateComAuSearchUrl,
  type RealestateComAuRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'realestate_com_au';

const DEFAULT_CITIES: readonly string[] = [
  'sydney-nsw-2000',
  'melbourne-vic-3000',
  'brisbane-qld-4000',
  'perth-wa-6000',
  'adelaide-sa-5000',
];

const CONTENT_SELECTOR = 'script, main, [data-testid]';

export interface RealestateComAuProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): RealestateComAuRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale')
  ) {
    throw new Error('realestate_com_au: normalize received an invalid payload');
  }
  return payload as RealestateComAuRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function resolvePropertyType(label: string | undefined): PropertyType {
  const lower = (label ?? '').toLowerCase();
  if (lower.includes('house') || lower.includes('townhouse') || lower.includes('villa')) {
    return PropertyType.HOUSE;
  }
  if (lower.includes('studio')) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

export class RealestateComAuProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['AU'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: RealestateComAuProviderOptions = {}) {
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
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'AU');
    const channels: readonly ('rent' | 'buy')[] = ['rent', 'buy'];

    for (const city of cities) {
      const slug = citySlug(city);
      for (const channel of channels) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const pageUrl = realestateComAuSearchUrl(slug, channel, page);
          const html = await this.fetchHtml(runtime, pageUrl, job.signal);
          if (!html) break;
          const refs = parseRealestateComAuSearch(html);
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
        isChallenge: isRealestateComAuChallenge,
        metrics: this.metrics,
        init: {
          signal,
          headers: {
            'Accept-Language': 'en-AU,en;q=0.9',
            Referer: `${REALESTATE_COM_AU_BASE_URL}/`,
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
        isChallenge: isRealestateComAuChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'en-AU',
        acceptLanguage: 'en-AU,en;q=0.9',
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return isRealestateComAuChallenge(html) ? undefined : html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const html = await this.fetchHtml(ctx.runtime, ref.url, ctx.signal);
    if (!html) {
      throw new Error(`realestate_com_au: could not fetch detail for ${ref.sourceId}`);
    }
    const payload = parseRealestateComAuDetail(html, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.kind === 'sale';
    const monthlyAmount = isSale ? undefined : listing.price;
    const salePrice = isSale ? listing.price : undefined;

    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.state,
        country: 'Australia',
        countryCode: listing.address.countryCode,
        postalCode: listing.address.postalCode,
        coordinates: listing.address.coordinates,
      },
      type: resolvePropertyType(listing.propertyType),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent:
        monthlyAmount !== undefined
          ? { monthlyAmount, currency: listing.currency }
          : undefined,
      sale:
        salePrice !== undefined
          ? { price: salePrice, currency: listing.currency }
          : undefined,
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
      detail: `${REALESTATE_COM_AU_BASE_URL} Kasada-gated — keep OFF until AU residential/browser discover works`,
    };
  }
}

export {
  isRealestateComAuChallenge,
  parseRealestateComAuDetail,
  parseRealestateComAuSearch,
  realestateComAuSourceIdFromUrl,
} from './parse';
