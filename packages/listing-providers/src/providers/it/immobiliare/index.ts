/**
 * Immobiliare.it provider (Italy) — JSON/AJAX first via search-list API + `__NEXT_DATA__`.
 *
 * Discover: warm session → search-list AJAX → `__NEXT_DATA__` / HTML link fallback.
 * Fetch: detail `__NEXT_DATA__` (includes advertiser contact when present).
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
import { IMMOBILIARE_BASE_URL } from './fixtures';
import {
  immobiliareSearchApiUrls,
  immobiliareSourceIdFromUrl,
  immobiliareWarmSearchUrl,
  parseImmobiliareDetail,
  parseImmobiliareSearch,
  parseImmobiliareSearchJson,
  type ImmobiliareRaw,
} from './parse';

const PROVIDER_ID: ProviderId = 'immobiliare';
const DEFAULT_CITIES: readonly string[] = ['roma', 'milano', 'napoli', 'torino', 'firenze'];
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'a[href*="/annunci/"], main, #__NEXT_DATA__, [data-testid="listing-card"]';

export function isImmobiliareChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /datadome|captcha-delivery|accesso negato|verifica che sei/i.test(html);
}

export interface ImmobiliareProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function resolvePropertyType(raw: string | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (/villa|casa indipendente|house|single/.test(lower)) return PropertyType.HOUSE;
  if (/monolocale|studio/.test(lower)) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function asImmobiliareRaw(payload: unknown): ImmobiliareRaw {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('immobiliare: normalize received a payload that is not an ImmobiliareRaw');
  }
  return payload as ImmobiliareRaw;
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
    seen.add(ref.sourceId);
    out.push({ provider: PROVIDER_ID, sourceId: ref.sourceId, url: ref.url });
    yielded.count += 1;
  }
  return out;
}

export class ImmobiliareProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['IT'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: ImmobiliareProviderOptions = {}) {
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
        warmUrl: immobiliareWarmSearchUrl(city, 1),
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isImmobiliareChallenge,
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
        let pageRefs: { sourceId: string; url: string }[] = [];
        for (const ajaxUrl of immobiliareSearchApiUrls(city, page)) {
          const { status, body } = await session.request(ajaxUrl, {
            referer: session.pageUrl(),
            timeoutMs: 30_000,
          });
          if (status >= 400 || isImmobiliareChallenge(body)) continue;
          pageRefs = parseImmobiliareSearchJson(body);
          if (pageRefs.length > 0) {
            this.metrics.record({
              provider: this.id,
              strategy: 'browser',
              outcome: 'success',
              status,
              latencyMs: Date.now() - start,
              url: ajaxUrl,
            });
            break;
          }
        }
        if (pageRefs.length === 0 && page === 1) {
          const html = await session.content();
          pageRefs = parseImmobiliareSearch(html);
        }
        if (pageRefs.length === 0) break;
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
        url: immobiliareWarmSearchUrl(city, 1),
        detail: `immobiliare warm-up failed: ${detail}`,
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
        const { html } = await fetchListingViaLadder(runtime, immobiliareWarmSearchUrl(city, page), {
          provider: this.id,
          isChallenge: isImmobiliareChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseImmobiliareSearch(html);
        if (refs.length === 0) return;
        for (const ref of yieldRefs(refs, seen, limit, yielded)) yield ref;
      } catch (error) {
        if (error instanceof ChallengeError) return;
        throw error;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchDetailViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isImmobiliareChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseImmobiliareDetail(html, ref.url) };
  }

  private async fetchDetailViaSession(
    ref: ExternalListingRef,
    ctx: FetchContext,
  ): Promise<RawListing | undefined> {
    if (!ctx.runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: '#__NEXT_DATA__, main, h1',
        isChallenge: isImmobiliareChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'it-IT',
      });
      const html = await session.content();
      if (isImmobiliareChallenge(html)) return undefined;
      const payload = parseImmobiliareDetail(html, ref.url);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return { ref, payload };
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asImmobiliareRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`immobiliare: listing ${listing.sourceId} has no resolvable price`);
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
        street: listing.street ?? listing.city ?? '',
        city: listing.city ?? '',
        state: listing.region,
        country: 'Italy',
        countryCode: 'IT',
        postalCode: listing.postalCode,
        neighborhood: listing.neighborhood,
        coordinates: listing.coordinates,
      },
      type: resolvePropertyType(listing.propertyType),
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
    if (listing.floor !== undefined) result.floor = listing.floor;
    if (listing.amenities.length > 0) result.amenities = listing.amenities;
    if (listing.furnished === true) result.furnishedStatus = 'furnished';
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving IT via ${IMMOBILIARE_BASE_URL} (search-list AJAX + __NEXT_DATA__)`,
    };
  }
}

export { immobiliareSourceIdFromUrl };
