/**
 * Rightmove provider (United Kingdom).
 *
 * Acquisition order (JSON-first):
 *   1. Typeahead JSON (`los.rightmove.co.uk/typeahead`) → locationIdentifier
 *   2. Warm Playwright session on city search (optional) OR ladder HTML
 *   3. Parse `__NEXT_DATA__.searchResults.properties` JSON (housing-only)
 *   4. Detail: parse `window.__PAGE_MODEL` compressed JSON (contact + images)
 *
 * Registered OFF by default (`PROVIDER_RIGHTMOVE_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingAddress,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type {
  BrowserSession,
  BrowserStorageState,
} from '../../../browserSession';
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
import { providerMaxSearchPages } from '../../../discoverLimits';
import { DEFAULT_GB_CITIES } from '../../../parse/defaultMarketCities';
import { isGbPortalChallenge } from '../challenge';
import { resolveGbPropertyType, splitGbDisplayAddress } from '../housing';
import {
  RIGHTMOVE_BASE_URL,
} from './fixtures';
import {
  parseRightmoveDetail,
  parseRightmoveSearchJson,
  parseRightmoveTypeahead,
  rightmoveSearchUrl,
  rightmoveSourceIdFromUrl,
  rightmoveTypeaheadUrl,
  type RightmoveListingJson,
} from './parse';

const PROVIDER_ID: ProviderId = 'rightmove';
const DEFAULT_MAX_SEARCH_PAGES = 50;
const RESULTS_PER_PAGE = 24;

const CONTENT_SELECTOR = 'script#__NEXT_DATA__, main, [data-test="propertyCard"]';

export function isRightmoveChallenge(html: string): boolean {
  return isGbPortalChallenge(html);
}

export interface RightmoveProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRightmoveRaw(payload: unknown): RightmoveListingJson {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale')
  ) {
    throw new Error('rightmove: normalize received a payload that is not a RightmoveListingJson');
  }
  return payload as RightmoveListingJson;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function buildAddress(listing: RightmoveListingJson): NormalizedListingAddress {
  const split = splitGbDisplayAddress(listing.displayAddress);
  const postalCode =
    listing.outcode && listing.incode
      ? `${listing.outcode} ${listing.incode}`
      : split.postalCode;
  const address: NormalizedListingAddress = {
    street: split.street,
    city: split.city,
    country: 'United Kingdom',
    countryCode: listing.countryCode ?? 'GB',
    postalCode,
  };
  if (listing.latitude !== undefined && listing.longitude !== undefined) {
    address.coordinates = { lat: listing.latitude, lng: listing.longitude };
  }
  return address;
}

export class RightmoveProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['GB'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly maxSearchPages: number;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;
  private locationCache = new Map<string, string>();

  constructor(options: RightmoveProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_GB_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.maxSearchPages = providerMaxSearchPages(PROVIDER_ID, DEFAULT_MAX_SEARCH_PAGES, 'GB');
  }

  private async resolveLocationId(runtime: FetchRuntime, city: string, signal?: AbortSignal): Promise<string | undefined> {
    const key = city.toLowerCase();
    const cached = this.locationCache.get(key);
    if (cached) return cached;

    try {
      const { status, body } = await runtime.fetchHttp(rightmoveTypeaheadUrl(city), {
        signal,
        headers: {
          Accept: 'application/json',
          Referer: `${RIGHTMOVE_BASE_URL}/`,
        },
      });
      if (status >= 400) return undefined;
      const locationId = parseRightmoveTypeahead(body);
      if (locationId) this.locationCache.set(key, locationId);
      return locationId;
    } catch {
      return undefined;
    }
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      if (yielded >= limit) return;
      const locationId = await this.resolveLocationId(runtime, city, job.signal);
      if (!locationId) continue;

      for (let page = 0; page < this.maxSearchPages; page += 1) {
        if (yielded >= limit) return;
        const index = page * RESULTS_PER_PAGE;
        const searchUrl = rightmoveSearchUrl(locationId, 'rent', index);
        let html: string | undefined;

        if (runtime.openBrowserSession) {
          html = await this.fetchSearchViaSession(runtime, searchUrl, job.signal);
        }
        if (!html) {
          try {
            const result = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isRightmoveChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            html = result.html;
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }

        const refs = parseRightmoveSearchJson(html);
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yielded += 1;
          yield {
            provider: PROVIDER_ID,
            sourceId: ref.sourceId,
            url: ref.url,
            hints: { kind: ref.kind },
          };
        }
      }
    }
  }

  private async fetchSearchViaSession(
    runtime: FetchRuntime,
    searchUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl: searchUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isRightmoveChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });
      const html = await session.content();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: searchUrl,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
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
        url: searchUrl,
        detail,
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchDetailViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isRightmoveChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseRightmoveDetail(html, ref.url);
    return { ref, payload };
  }

  private async fetchDetailViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
  ): Promise<RawListing | undefined> {
    if (!ctx.runtime.openBrowserSession) return undefined;
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
        contentSelector: 'script, h1, main',
        isChallenge: isRightmoveChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });
      const html = await session.content();
      if (isRightmoveChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          status: 200,
          latencyMs: Date.now() - start,
          url: ref.url,
        });
        return undefined;
      }
      const payload = parseRightmoveDetail(html, ref.url);
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
    } catch {
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: ref.url,
        detail: 'detail session failed; falling back to ladder',
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRightmoveRaw(raw.payload);
    if (listing.priceAmount === undefined) {
      throw new Error(`rightmove: listing ${listing.sourceId} has no resolvable price`);
    }
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: buildAddress(listing),
      type: resolveGbPropertyType(listing.propertySubType) as PropertyType,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' },
      sale: isSale ? { price: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    const description = listing.description ?? listing.summary;
    if (description) result.description = description;
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
        detail: `attempts=${snapshot.attempts} challengeRate=${snapshot.challengeRate.toFixed(2)} avgLatencyMs=${snapshot.avgLatencyMs}`,
      };
    }
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving GB via ${RIGHTMOVE_BASE_URL} (typeahead + __NEXT_DATA__/__PAGE_MODEL JSON)`,
    };
  }
}

export { rightmoveSourceIdFromUrl };
