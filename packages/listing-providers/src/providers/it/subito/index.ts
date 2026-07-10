/**
 * Subito.it provider (Italy) — housing-only classifieds.
 *
 * CRITICAL: never site-wide crawl. Discover uses `/affitto/appartamenti/` only;
 * `normalize()` rejects non-housing categories.
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
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { SUBITO_BASE_URL } from './fixtures';
import {
  isSubitoHousingCategory,
  parseSubitoDetail,
  parseSubitoSearch,
  parseSubitoSearchJson,
  subitoSearchApiUrl,
  subitoSourceIdFromUrl,
  subitoWarmSearchUrl,
  type SubitoRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'subito';
const DEFAULT_CITIES: readonly string[] = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;

export function isSubitoChallenge(html: string): boolean {
  if (html.trim().length < 256) return true;
  return /access denied|datadome|captcha|akamai|bot detection/i.test(html);
}

export interface SubitoProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asSubitoRaw(payload: unknown): SubitoRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; categoryUri?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('subito: normalize received a payload that is not a SubitoRaw');
  }
  return payload as SubitoRaw;
}

function yieldRefs(
  refs: readonly { sourceId: string; url: string }[],
  seen: Set<string>,
  limit: number,
  yielded: { count: number },
): ExternalListingRef[] {
  const out: ExternalListingRef[] = [];
  for (const ref of refs) {
    if (yielded.count >= limit) break;
    if (seen.has(ref.sourceId)) continue;
    if (!isSubitoHousingCategory(ref.url)) continue;
    seen.add(ref.sourceId);
    out.push({ provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url });
    yielded.count += 1;
  }
  return out;
}

export class SubitoProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['IT'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: SubitoProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const yielded = { count: 0 };
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      if (yielded.count >= limit) return;
      const viaAjax = runtime.openBrowserSession
        ? await this.discoverCityViaAjax(runtime, city, job.signal, seen, limit, yielded)
        : [];
      for (const ref of viaAjax) yield ref;
      if (yielded.count >= limit) return;
      if (viaAjax.length === 0) {
        for await (const ref of this.discoverCityViaHtml(runtime, city, job.signal, seen, limit, yielded)) {
          yield ref;
        }
      }
    }
  }

  private async discoverCityViaAjax(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl: subitoWarmSearchUrl(city, 1),
        signal,
        contentSelector: 'a[href*="/appartamenti/"], main, #__NEXT_DATA__',
        isChallenge: isSubitoChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'it-IT',
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded.count >= limit) break;
        const ajaxUrl = subitoSearchApiUrl(city, page);
        const { status, body } = await session.request(ajaxUrl, {
          referer: session.pageUrl(),
          timeoutMs: 30_000,
        });
        let pageRefs =
          status < 400 && !isSubitoChallenge(body) ? parseSubitoSearchJson(body) : [];
        if (pageRefs.length === 0 && page === 1) {
          pageRefs = parseSubitoSearch(await session.content());
        }
        if (pageRefs.length === 0) break;
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: ajaxUrl,
        });
        collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
      }
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return collected;
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
        url: subitoWarmSearchUrl(city, 1),
        detail: `subito warm-up failed: ${detail}`,
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  private async *discoverCityViaHtml(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): AsyncIterable<ExternalListingRef> {
    for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
      if (yielded.count >= limit) return;
      try {
        const { html } = await fetchListingViaLadder(runtime, subitoWarmSearchUrl(city, page), {
          provider: this.id,
          isChallenge: isSubitoChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseSubitoSearch(html);
        if (refs.length === 0) return;
        for (const ref of yieldRefs(refs, seen, limit, yielded)) yield ref;
      } catch (error) {
        if (error instanceof ChallengeError) return;
        throw error;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!isSubitoHousingCategory(ref.url)) {
      throw new Error(`subito: refusing to fetch non-housing URL ${ref.url}`);
    }
    if (ctx.runtime.openBrowserSession) {
      let session: BrowserSession | undefined;
      try {
        const sticky = envBool('LISTING_PROXY_STICKY', false);
        if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
        session = await ctx.runtime.openBrowserSession({
          warmUrl: ref.url,
          signal: ctx.signal,
          contentSelector: '#__NEXT_DATA__, main, h1',
          isChallenge: isSubitoChallenge,
          challengeWaitMs: 45_000,
          stickyProxySession: sticky,
          proxySessionId: this.stickyProxySessionId,
          storageState: this.stickyStorageState,
          blockAssets: true,
          locale: 'it-IT',
        });
        const html = await session.content();
        if (!isSubitoChallenge(html)) {
          if (sticky) this.stickyStorageState = await session.exportStorageState();
          return { ref, payload: parseSubitoDetail(html, ref.url) };
        }
      } catch {
        // Fall through.
      } finally {
        await session?.close();
      }
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isSubitoChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseSubitoDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asSubitoRaw(raw.payload);
    if (!isSubitoHousingCategory(listing.categoryUri || listing.url)) {
      throw new Error(
        `subito: non-housing listing rejected (${listing.categoryUri || listing.url})`,
      );
    }
    if (listing.price === undefined) {
      throw new Error(`subito: listing ${listing.sourceId} has no resolvable price`);
    }
    const isSale = listing.operation === 'sale';
    const images: NormalizedRemoteImage[] = listing.images.map((url, index) => ({
      url,
      isPrimary: index === 0,
    }));
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.city ?? '',
        city: listing.city ?? '',
        state: listing.region,
        country: 'Italy',
        countryCode: 'IT',
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: images,
      status: 'published',
    };
    if (listing.description ?? listing.title) result.description = listing.description ?? listing.title;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.furnished === true) result.furnishedStatus = 'furnished';
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving IT housing-only via ${SUBITO_BASE_URL} (appartamenti affitto; non-housing rejected)`,
    };
  }
}

export { subitoSourceIdFromUrl, isSubitoHousingCategory };
