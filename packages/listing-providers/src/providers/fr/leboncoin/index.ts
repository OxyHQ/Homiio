/**
 * Leboncoin immobilier provider (France) — classifieds, HOUSING ONLY.
 *
 * Prefer `__NEXT_DATA__` JSON on housing search/detail pages (categories 9
 * ventes / 10 locations) from a warmed Playwright session. Cold HTTP is
 * DataDome-blocked. Non-housing categories are rejected via shared
 * {@link assertHousingListing}.
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
import { findNextDataArray, findNextDataRecord, parseNextData } from '../../../nextData';
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
import { LEBONCOIN_BASE_URL } from './fixtures';
import {
  leboncoinWarmSearchUrl,
  parseLeboncoinDetail,
  parseLeboncoinSearch,
  type LeboncoinRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'leboncoin';
const DEFAULT_CITIES: readonly string[] = ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Lille'];
const MAX_SEARCH_PAGES = 3;
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

function isLeboncoinAdLike(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('list_id' in value || 'listId' in value) &&
    ('category_id' in value || 'categoryId' in value || 'price' in value)
  );
}

/** Finder-shaped `{ ads: [...] }` from shared `__NEXT_DATA__` parse. */
function adsJsonFromHtml(html: string): string | undefined {
  const root = parseNextData(html);
  if (!root) return undefined;
  const ads = findNextDataArray(root, isLeboncoinAdLike);
  if (!ads || ads.length === 0) return undefined;
  return JSON.stringify({ ads });
}

function adJsonFromHtml(html: string): string | undefined {
  const root = parseNextData(html);
  if (!root) return undefined;
  const ad = findNextDataRecord(root, isLeboncoinAdLike);
  if (!ad) return undefined;
  return JSON.stringify(ad);
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
    const categories: Array<'10' | '9'> = ['10', '9'];

    for (const city of cities) {
      for (const categoryId of categories) {
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          if (yielded >= limit) return;
          const body = await this.searchPageJson(runtime, city, categoryId, page, job.signal);
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

  private async searchPageJson(
    runtime: FetchRuntime,
    city: string,
    categoryId: '9' | '10',
    page: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        url: leboncoinWarmSearchUrl(city, categoryId),
        detail: 'openBrowserSession required (DataDome)',
      });
      return undefined;
    }

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    const warmUrl =
      page <= 1
        ? leboncoinWarmSearchUrl(city, categoryId)
        : `${leboncoinWarmSearchUrl(city, categoryId)}&page=${page}`;
    let session: BrowserSession | undefined;
    const start = Date.now();
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
      const html = await session.content();
      if (isLeboncoinChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: warmUrl,
        });
        return undefined;
      }
      const json = adsJsonFromHtml(html);
      if (!json) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'error',
          latencyMs: Date.now() - start,
          url: warmUrl,
          detail: 'no __NEXT_DATA__ ads',
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
      return json;
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
      const json = adJsonFromHtml(html) ?? adsJsonFromHtml(html);
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
      detail: `Serving FR housing via ${LEBONCOIN_BASE_URL} (categories 9/10, __NEXT_DATA__ JSON)`,
    };
  }
}

export {
  leboncoinSourceIdFromUrl,
  parseLeboncoinDetail,
  parseLeboncoinSearch,
} from './parse';
