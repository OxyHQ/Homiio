/**
 * OnTheMarket provider (United Kingdom).
 *
 * JSON-first: detail pages expose listing + agent contact in
 * `__NEXT_DATA__.props.initialReduxState.property`. Discover pages search HTML
 * for `/details/<id>` and rejects non-housing (garages/parking) at normalize.
 *
 * Registered OFF by default (`PROVIDER_ONTHEMARKET_ENABLED`).
 */

import {
  OfferingType,
  type NormalizedListing,
  type NormalizedListingAddress,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { BrowserSessionChallengeError } from '../../../browserSession';
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
import { isGbPortalChallenge } from '../challenge';
import { resolveGbPropertyType } from '../housing';
import { ONTHEMARKET_BASE_URL } from './fixtures';
import {
  onthemarketSearchUrl,
  onthemarketSourceIdFromUrl,
  parseOnTheMarketDetail,
  parseOnTheMarketSearch,
  type OnTheMarketListingJson,
} from './parse';

const PROVIDER_ID: ProviderId = 'onthemarket';
const DEFAULT_CITIES: readonly string[] = ['london', 'manchester', 'birmingham', 'edinburgh', 'bristol'];
const MAX_SEARCH_PAGES = 3;

export function isOnTheMarketChallenge(html: string): boolean {
  return isGbPortalChallenge(html);
}

export interface OnTheMarketProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asOtmRaw(payload: unknown): OnTheMarketListingJson {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale')
  ) {
    throw new Error('onthemarket: normalize received an invalid payload');
  }
  return payload as OnTheMarketListingJson;
}

function splitAddress(displayAddress: string | undefined, locality?: string): {
  street: string;
  city: string;
  postalCode?: string;
} {
  if (!displayAddress) return { street: '', city: locality ?? '' };
  const parts = displayAddress.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { street: '', city: locality ?? '' };
  const last = parts[parts.length - 1];
  const postcodeMatch = last.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  const city = locality ?? (postcodeMatch ? parts[parts.length - 2] ?? last : last);
  const street = parts.slice(0, Math.max(1, parts.length - 1)).join(', ');
  return { street: street || city, city, postalCode: postcodeMatch?.[1]?.toUpperCase() };
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function buildAddress(listing: OnTheMarketListingJson): NormalizedListingAddress {
  const split = splitAddress(listing.displayAddress, listing.addressLocality);
  const address: NormalizedListingAddress = {
    street: split.street,
    city: split.city,
    country: 'United Kingdom',
    countryCode: 'GB',
    postalCode: split.postalCode,
  };
  if (listing.latitude !== undefined && listing.longitude !== undefined) {
    address.coordinates = { lat: listing.latitude, lng: listing.longitude };
  }
  return address;
}

export class OnTheMarketProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['GB'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: OnTheMarketProviderOptions = {}) {
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
        const searchUrl = onthemarketSearchUrl(city, page);
        let html: string | undefined;
        if (runtime.openBrowserSession) {
          html = await this.fetchHtmlViaSession(runtime, searchUrl, job.signal);
        }
        if (!html) {
          try {
            const result = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isOnTheMarketChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            html = result.html;
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }
        const refs = parseOnTheMarketSearch(html);
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yielded += 1;
          yield { provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url, hints: { kind: 'rent' } };
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
        contentSelector: 'script#__NEXT_DATA__, a[href*="/details/"]',
        isChallenge: isOnTheMarketChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return html;
    } catch (error) {
      if (!(error instanceof BrowserSessionChallengeError)) {
        // Fall through to ladder.
      }
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const html = await this.fetchHtmlViaSession(ctx.runtime, ref.url, ctx.signal);
      if (html) {
        return { ref, payload: parseOnTheMarketDetail(html, ref.url) };
      }
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isOnTheMarketChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseOnTheMarketDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asOtmRaw(raw.payload);
    if (listing.priceAmount === undefined) {
      throw new Error(`onthemarket: listing ${listing.sourceId} has no resolvable price`);
    }
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: buildAddress(listing),
      type: resolveGbPropertyType(listing.propertyType),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale
        ? undefined
        : { monthlyAmount: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' },
      sale: isSale ? { price: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description ?? listing.summary) {
      result.description = listing.description ?? listing.summary;
    }
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.contact) result.contact = listing.contact;
    return result;
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
      detail: `Serving GB via ${ONTHEMARKET_BASE_URL} (__NEXT_DATA__ property JSON; housing-only)`,
    };
  }
}

export { onthemarketSourceIdFromUrl };
