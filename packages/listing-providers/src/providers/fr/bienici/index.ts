/**
 * Bien'ici provider (France) — JSON-first (`realEstateAds.json` / `realEstateAd.json`).
 *
 * Cold HTTP works for search + detail. Prices are often redacted to 0; discover
 * only yields refs with a positive scalar/range price. Detail enriches contact
 * (`contactRelativeData`) and photos; price may ride in discover hints.
 *
 * Optional Playwright warm-up for sticky proxy sessions. Registered OFF by
 * default (`PROVIDER_BIENICI_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
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
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { BIENICI_BASE_URL } from './fixtures';
import {
  bieniciDetailJsonUrl,
  bieniciSearchJsonUrl,
  bieniciWarmSearchUrl,
  parseBieniciDetail,
  parseBieniciSearch,
  type BieniciRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'bienici';
const DEFAULT_CITIES: readonly string[] = ['paris', 'lyon', 'marseille', 'bordeaux', 'lille'];
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'main, #root, [class*="search"], a[href*="/annonce/"]';

export function isBieniciChallenge(body: string): boolean {
  if (body.trim().length < 64) return true;
  return /captcha-delivery|datadome|access denied|just a moment/i.test(body);
}

export interface BieniciProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asBieniciRaw(payload: unknown): BieniciRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown; city?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.price !== 'number' ||
    typeof record.city !== 'string'
  ) {
    throw new Error('bienici: normalize received a payload that is not a BieniciRawListing');
  }
  return payload as BieniciRawListing;
}

function resolvePropertyType(raw: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('house') || lower.includes('townhouse') || lower.includes('maison')) {
    return PropertyType.HOUSE;
  }
  if (lower.includes('studio') || bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function hintPrice(hints: Record<string, unknown> | undefined): number | undefined {
  if (!hints) return undefined;
  const price = hints.price;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : undefined;
}

export class BieniciProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['FR'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: BieniciProviderOptions = {}) {
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
        const body = await this.fetchSearchBody(runtime, city, page, job.signal);
        if (!body) break;
        const refs = parseBieniciSearch(body);
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield {
            provider: this.id,
            sourceId: ref.sourceId,
            url: ref.url,
            hints: { price: ref.price, kind: ref.kind },
          };
          yielded += 1;
        }
      }
    }
  }

  private async fetchSearchBody(
    runtime: FetchRuntime,
    city: string,
    page: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const ajaxUrl = bieniciSearchJsonUrl(city, page);
    const start = Date.now();

    if (runtime.openBrowserSession && page === 1) {
      const viaSession = await this.searchViaSession(runtime, city, ajaxUrl, signal);
      if (viaSession) return viaSession;
    }

    try {
      const { status, body } = await runtime.fetchHttp(ajaxUrl, {
        signal,
        headers: {
          Accept: 'application/json',
          Referer: bieniciWarmSearchUrl(city),
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      if (status >= 400 || isBieniciChallenge(body)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: 'challenge',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
        });
        return undefined;
      }
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'success',
        status,
        latencyMs: Date.now() - start,
        url: ajaxUrl,
      });
      return body;
    } catch (error) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: ajaxUrl,
        detail: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async searchViaSession(
    runtime: FetchRuntime,
    city: string,
    ajaxUrl: string,
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
        warmUrl: bieniciWarmSearchUrl(city),
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isBieniciChallenge,
        challengeWaitMs: 30_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'fr-FR',
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
      });
      const { status, body } = await session.request(ajaxUrl, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
      });
      if (status >= 400 || isBieniciChallenge(body)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
        });
        return undefined;
      }
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status,
        latencyMs: Date.now() - start,
        url: ajaxUrl,
      });
      return body;
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
        url: bieniciWarmSearchUrl(city),
        detail,
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const price = hintPrice(ref.hints);
    const jsonUrl = bieniciDetailJsonUrl(ref.sourceId);
    const start = Date.now();

    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchDetailViaSession(ref, ctx, jsonUrl, price);
      if (fromSession) return fromSession;
    }

    const { status, body } = await ctx.runtime.fetchHttp(jsonUrl, {
      signal: ctx.signal,
      headers: {
        Accept: 'application/json',
        Referer: ref.url,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    if (status >= 400 || isBieniciChallenge(body)) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'challenge',
        status,
        latencyMs: Date.now() - start,
        url: jsonUrl,
      });
      throw new Error(`bienici: detail fetch failed status=${status}`);
    }
    const payload = parseBieniciDetail(body, ref.url, price);
    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: 'success',
      status,
      latencyMs: Date.now() - start,
      url: jsonUrl,
    });
    return { ref, payload };
  }

  private async fetchDetailViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
    jsonUrl: string,
    priceHint: number | undefined,
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
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isBieniciChallenge,
        challengeWaitMs: 30_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'fr-FR',
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
      });
      const { status, body } = await session.request(jsonUrl, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
      });
      if (status >= 400 || isBieniciChallenge(body)) return undefined;
      const payload = parseBieniciDetail(body, ref.url, priceHint);
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status,
        latencyMs: Date.now() - start,
        url: jsonUrl,
      });
      return { ref, payload };
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asBieniciRaw(raw.payload);
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.street ?? listing.city,
        city: listing.city,
        country: 'France',
        countryCode: 'FR',
        postalCode: listing.postalCode,
        neighborhood: listing.neighborhood,
        coordinates: listing.coordinates,
      },
      type: resolvePropertyType(listing.propertyType, listing.bedroomsQuantity),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: 'EUR' },
      sale: isSale ? { price: listing.price, currency: 'EUR' } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (listing.description) result.description = listing.description;
    else if (listing.title) result.description = listing.title;
    if (listing.bedroomsQuantity !== undefined) result.bedrooms = listing.bedroomsQuantity;
    if (listing.bathroomsQuantity !== undefined) result.bathrooms = listing.bathroomsQuantity;
    if (listing.surfaceArea !== undefined) result.squareFootage = listing.surfaceArea;
    if (listing.floor !== undefined) result.floor = listing.floor;
    if (listing.furnished === true) result.furnishedStatus = 'furnished';
    if (listing.furnished === false) result.furnishedStatus = 'unfurnished';
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
      detail: `Serving FR via ${BIENICI_BASE_URL} (realEstateAds.json + contactRelativeData)`,
    };
  }
}

export {
  bieniciSourceIdFromUrl,
  parseBieniciDetail,
  parseBieniciSearch,
  resolveBieniciPrice,
} from './parse';
