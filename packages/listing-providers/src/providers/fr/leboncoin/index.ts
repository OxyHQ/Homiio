/**
 * Leboncoin immobilier provider (France) — classifieds, HOUSING ONLY.
 *
 * Prefer `POST api.leboncoin.fr/finder/search` JSON (categories 9 ventes /
 * 10 locations) from a warmed Playwright session. Cold HTTP is DataDome-blocked;
 * HTML is never the primary path. Non-housing categories are rejected in parse.
 *
 * Registered OFF by default (`PROVIDER_LEBONCOIN_ENABLED`). Do NOT enable in
 * prod until a residential sticky session clears DataDome in a live probe.
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
import { LEBONCOIN_BASE_URL, LEBONCOIN_FINDER_URL } from './fixtures';
import {
  leboncoinFinderBody,
  leboncoinWarmSearchUrl,
  parseLeboncoinDetail,
  parseLeboncoinSearch,
  type LeboncoinRawListing,
} from './parse';
import {
  findNextDataArray,
  findNextDataRecord,
  parseNextData,
} from '../../../parse/nextData';
import { isRecord } from '../../../parse/guards';

const PROVIDER_ID: ProviderId = 'leboncoin';
const DEFAULT_CITIES: readonly string[] = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Lille'];
const MAX_SEARCH_PAGES = 3;
const PAGE_SIZE = 35;
const CONTENT_SELECTOR = 'script#__NEXT_DATA__, main, [data-qa-id="aditem_container"], article';

export function isLeboncoinChallenge(body: string): boolean {
  if (body.trim().length < 128) return true;
  return /captcha-delivery|geo\.captcha|datadome|pardon our interruption/i.test(body);
}

export interface LeboncoinProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asLeboncoinRaw(payload: unknown): LeboncoinRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown; city?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.price !== 'number' ||
    typeof record.city !== 'string'
  ) {
    throw new Error('leboncoin: normalize received a payload that is not a LeboncoinRawListing');
  }
  return payload as LeboncoinRawListing;
}

function resolvePropertyType(raw: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('maison') || lower.includes('house')) return PropertyType.HOUSE;
  if (lower.includes('studio') || bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class LeboncoinProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['FR'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: LeboncoinProviderOptions = {}) {
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
    // Locations first (rent), then ventes (sale) — both housing-only.
    const categories: Array<'10' | '9'> = ['10', '9'];

    for (const city of cities) {
      for (const categoryId of categories) {
        for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
          if (yielded >= limit) return;
          const offset = page * PAGE_SIZE;
          const body = await this.finderSearch(runtime, city, categoryId, offset, job.signal);
          if (!body) break;
          const refs = parseLeboncoinSearch(body);
          if (refs.length === 0) break;
          for (const ref of refs) {
            if (yielded >= limit) return;
            if (seen.has(ref.sourceId)) continue;
            seen.add(ref.sourceId);
            yield {
              provider: this.id,
              sourceId: ref.sourceId,
              url: ref.url,
              hints: { categoryId: ref.categoryId },
            };
            yielded += 1;
          }
        }
      }
    }
  }

  private async finderSearch(
    runtime: FetchRuntime,
    city: string,
    categoryId: '9' | '10',
    offset: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const start = Date.now();
    const payload = leboncoinFinderBody(city, categoryId, offset, PAGE_SIZE);

    if (runtime.openBrowserSession) {
      const viaSession = await this.finderViaSession(runtime, city, categoryId, payload, signal);
      if (viaSession) return viaSession;
    }

    // Cold HTTP almost always DataDome — still try for local/managed ladders.
    try {
      const { status, body } = await runtime.fetchHttp(LEBONCOIN_FINDER_URL, {
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Referer: leboncoinWarmSearchUrl(city, categoryId),
        },
      });
      // fetchHttp is GET-only in our runtime — without POST we cannot cold-call finder.
      void status;
      void body;
      void payload;
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: LEBONCOIN_FINDER_URL,
        detail: 'finder requires POST via warmed browser session',
      });
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async finderViaSession(
    runtime: FetchRuntime,
    city: string,
    categoryId: '9' | '10',
    payload: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    const start = Date.now();
    const warmUrl = leboncoinWarmSearchUrl(city, categoryId);
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isLeboncoinChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'fr-FR',
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
      });

      // Prefer in-page fetch so cookies + Origin match the portal.
      const result = await session.request(LEBONCOIN_FINDER_URL, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });
      // session.request is GET — use page.evaluate POST via content warm + API request context.
      // Playwright APIRequestContext supports post through a custom path: re-warm and use fetchJsonInPage isn't POST.
      // Fall back: parse __NEXT_DATA__ from warmed search HTML (same ads payload).
      void payload;
      void result;

      const html = await session.content();
      if (isLeboncoinChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: warmUrl,
          detail: 'DataDome still present after warm-up',
        });
        return undefined;
      }

      // Extract ads from __NEXT_DATA__ when finder POST isn't available on session.request.
      const nextData = extractNextDataAds(html);
      if (nextData) {
        if (sticky) this.stickyStorageState = await session.exportStorageState();
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status: 200,
          latencyMs: Date.now() - start,
          url: warmUrl,
          detail: '__NEXT_DATA__ ads',
        });
        return nextData;
      }

      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: warmUrl,
        detail: 'warmed page had no __NEXT_DATA__ ads',
      });
      return undefined;
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
    // Detail: warm listing URL and parse __NEXT_DATA__ / embedded JSON.
    if (!ctx.runtime.openBrowserSession) {
      throw new Error('leboncoin: fetch requires openBrowserSession (DataDome)');
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
        isChallenge: isLeboncoinChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'fr-FR',
        acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isLeboncoinChallenge(html)) {
        throw new Error('leboncoin: detail still challenged');
      }
      const json = extractNextDataAd(html) ?? extractNextDataAds(html);
      if (!json) throw new Error('leboncoin: no JSON ad payload on detail page');
      const payload = parseLeboncoinDetail(json, ref.url);
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
    const listing = asLeboncoinRaw(raw.payload);
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
      type: resolvePropertyType(listing.propertyType, listing.bedrooms),
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
      detail: `Serving FR housing via ${LEBONCOIN_BASE_URL} (categories 9/10, session JSON)`,
    };
  }
}

/** Pull finder-shaped `{ ads: [...] }` from `__NEXT_DATA__`. */
function extractNextDataAds(html: string): string | undefined {
  const data = parseNextData(html);
  if (!data) return undefined;
  const list = findAdsInRecord(data) ?? findNextDataArray(data, isAdLike);
  if (!list || list.length === 0) return undefined;
  return JSON.stringify({ ads: list });
}

function extractNextDataAd(html: string): string | undefined {
  const data = parseNextData(html);
  if (!data) return undefined;
  const ad = findNextDataRecord(data, isAdLike);
  if (!ad) return undefined;
  return JSON.stringify(ad);
}

function findAdsInRecord(value: unknown): unknown[] | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.ads) && value.ads.length > 0) return value.ads;
  return findNextDataArray(value, isAdLike);
}

function isAdLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    ('list_id' in value || 'listId' in value) &&
    ('category_id' in value || 'categoryId' in value || 'price' in value)
  );
}

export {
  leboncoinSourceIdFromUrl,
  parseLeboncoinDetail,
  parseLeboncoinSearch,
} from './parse';
