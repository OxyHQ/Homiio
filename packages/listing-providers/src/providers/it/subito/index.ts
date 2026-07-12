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
import { isAntiBotChallenge } from '../../../parse/challenge';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { SUBITO_BASE_URL } from './fixtures';
import {
  coerceSubitoRaw,
  isSubitoHousingCategory,
  parseSubitoDetail,
  parseSubitoSearch,
  parseSubitoSearchListings,
  subitoSourceIdFromUrl,
  subitoWarmSearchUrl,
  type SubitoRaw,
} from './parse';

const CONTENT_SELECTOR = 'a[href*="/appartamenti/"], main, #__NEXT_DATA__';

const PROVIDER_ID: ProviderId = 'subito';
const DEFAULT_CITIES: readonly string[] = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;

export function isSubitoChallenge(html: string): boolean {
  if (html.trim().length < 256) return true;
  // `bot detection` is Subito's own interstitial phrase; the vendor markers
  // (DataDome/Akamai/…) come from the shared detector. Bare `captcha`/`datadome`/
  // `akamai` are dropped — Akamai is a CDN that also fronts good pages, and a
  // reCAPTCHA site key lives in legit page config.
  if (/bot detection/i.test(html)) return true;
  return isAntiBotChallenge(html);
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

/**
 * Yield refs from full search-page ad objects, carrying the parsed listing in
 * `hints.listing`. The detail page (Next App Router) exposes no usable JSON, so
 * `fetch` normalizes from this hint instead of re-fetching the ad.
 */
function yieldListings(
  listings: readonly SubitoRaw[],
  seen: Set<string>,
  limit: number,
  yielded: { count: number },
): ExternalListingRef[] {
  const out: ExternalListingRef[] = [];
  for (const listing of listings) {
    if (yielded.count >= limit) break;
    if (seen.has(listing.sourceId)) continue;
    if (!isSubitoHousingCategory(listing.categoryUri || listing.url)) continue;
    seen.add(listing.sourceId);
    out.push({
      provider: PROVIDER_ID,
      sourceId: listing.sourceId,
      url: listing.url,
      hints: { listing },
    });
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
      const viaBrowser = runtime.openBrowserSession
        ? await this.discoverCityViaBrowser(runtime, city, job.signal, seen, limit, yielded)
        : [];
      for (const ref of viaBrowser) yield ref;
      if (yielded.count >= limit) return;
      if (viaBrowser.length === 0) {
        for await (const ref of this.discoverCityViaHtml(runtime, city, job.signal, seen, limit, yielded)) {
          yield ref;
        }
      }
    }
  }

  /**
   * Warm the Akamai-gated search page and parse the full ad objects embedded in
   * `__NEXT_DATA__` (JSON-first — no HTML scraping). Pages 2+ reuse the warmed
   * context via `warmNavigate` rather than re-opening a session per page.
   */
  private async discoverCityViaBrowser(
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
        contentSelector: CONTENT_SELECTOR,
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
        if (page > 1) {
          await session.warmNavigate({
            warmUrl: subitoWarmSearchUrl(city, page),
            signal,
            contentSelector: CONTENT_SELECTOR,
            isChallenge: isSubitoChallenge,
            challengeWaitMs: 45_000,
          });
        }
        const html = await session.content();
        if (isSubitoChallenge(html)) break;
        const listings = parseSubitoSearchListings(html);
        if (listings.length === 0) break;
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          latencyMs: Date.now() - start,
          url: session.pageUrl(),
        });
        collected.push(...yieldListings(listings, seen, limit, yielded));
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
    // Discover already parsed the full ad from the search page __NEXT_DATA__ and
    // carried it via hints (the detail page exposes no usable JSON). Prefer it.
    const hinted = coerceSubitoRaw(ref.hints?.listing);
    if (hinted) return { ref, payload: hinted };
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
