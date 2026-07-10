/**
 * Storia.ro provider (Romania) — JSON-first via `__NEXT_DATA__` + Playwright session.
 *
 * Discover/fetch prefer embedded Next.js JSON (same payload as GraphQL searchAds)
 * over HTML card scraping. Contact phones from `contactDetails` feed
 * `NormalizedListing.contact` → Property `externalContact`.
 *
 * Registered OFF by default (`PROVIDER_STORIA_ENABLED`).
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
import { citySlug } from '../../../slug';
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
import { STORIA_BASE_URL } from './fixtures';
import {
  isStoriaChallenge,
  parseStoriaDetail,
  parseStoriaSearch,
  type StoriaRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'storia';

const DEFAULT_CITIES: readonly string[] = [
  'bucuresti',
  'cluj-napoca',
  'timisoara',
  'iasi',
  'brasov',
];

const MAX_SEARCH_PAGES = 3;

const CONTENT_SELECTOR = 'script#__NEXT_DATA__, [data-cy="search.listing"], article, main';

export interface StoriaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

/** Rental search URL (housing-native portal — no classifieds guard needed). */
function searchUrl(city: string, page: number, operation: 'inchiriere' | 'vanzare' = 'inchiriere'): string {
  const base = `${STORIA_BASE_URL}/ro/rezultate/${operation}/apartament/${citySlug(city)}`;
  return page <= 1 ? base : `${base}?page=${page}`;
}

function asStoriaRaw(payload: unknown): StoriaRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; price?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('storia: normalize received a payload that is not a StoriaRawListing');
  }
  return payload as StoriaRawListing;
}

function resolvePropertyType(estate: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (estate ?? '').toLowerCase();
  if (lower.includes('house') || lower.includes('terrain') || lower === 'house') return PropertyType.HOUSE;
  if (lower.includes('studio') || bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
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

export class StoriaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['RO'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: StoriaProviderOptions = {}) {
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
      const viaSession = runtime.openBrowserSession
        ? await this.discoverCityViaSession(runtime, city, job.signal, seen, limit, yielded)
        : [];
      for (const ref of viaSession) yield ref;
      if (yielded.count >= limit) return;

      if (viaSession.length === 0) {
        for await (const ref of this.discoverCityViaLadder(runtime, city, job.signal, seen, limit, yielded)) {
          yield ref;
        }
      }
    }
  }

  private async discoverCityViaSession(
    runtime: FetchRuntime,
    city: string,
    signal: AbortSignal | undefined,
    seen: Set<string>,
    limit: number,
    yielded: { count: number },
  ): Promise<ExternalListingRef[]> {
    if (!runtime.openBrowserSession) return [];

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const start = Date.now();
    const warmUrl = searchUrl(city, 1);
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isStoriaChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'ro-RO',
        acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
      });

      const collected: ExternalListingRef[] = [];
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded.count >= limit) break;
        const pageUrl = searchUrl(city, page);
        const { status, body } =
          page === 1
            ? { status: 200, body: await session.content() }
            : await session.request(pageUrl, {
                referer: session.pageUrl(),
                headers: {
                  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                },
                timeoutMs: 30_000,
              });

        if (status >= 400 || isStoriaChallenge(body)) {
          this.metrics.record({
            provider: this.id,
            strategy: 'browser',
            outcome: 'challenge',
            status,
            latencyMs: Date.now() - start,
            url: pageUrl,
            detail: 'storia search still challenged',
          });
          break;
        }

        const pageRefs = parseStoriaSearch(body);
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: pageUrl,
        });
        if (pageRefs.length === 0) break;
        collected.push(...yieldRefs(pageRefs, seen, limit, yielded));
      }

      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
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
        url: warmUrl,
        detail: `storia warm-up failed: ${detail}`,
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  private async *discoverCityViaLadder(
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
        const { html } = await fetchListingViaLadder(runtime, searchUrl(city, page), {
          provider: this.id,
          isChallenge: isStoriaChallenge,
          metrics: this.metrics,
          init: { signal },
        });
        const refs = parseStoriaSearch(html);
        if (refs.length === 0) return;
        for (const ref of yieldRefs(refs, seen, limit, yielded)) {
          yield ref;
        }
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
      isChallenge: isStoriaChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseStoriaDetail(html, ref.url);
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
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isStoriaChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'ro-RO',
        acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
      });

      const html = await session.content();
      if (isStoriaChallenge(html)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'challenge',
          latencyMs: Date.now() - start,
          url: ref.url,
          detail: 'storia detail still challenged',
        });
        return undefined;
      }

      const payload = parseStoriaDetail(html, ref.url);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: ref.url,
      });
      if (sticky) {
        this.stickyStorageState = await session.exportStorageState();
      }
      return { ref, payload };
    } catch {
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'error',
        latencyMs: Date.now() - start,
        url: ref.url,
        detail: 'storia detail session failed; falling back to ladder',
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asStoriaRaw(raw.payload);
    const isSale = listing.operation === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: 'Romania',
        countryCode: listing.address.countryCode,
        neighborhood: listing.address.neighborhood,
        coordinates: listing.coordinates,
      },
      type: resolvePropertyType(listing.estate, listing.bedrooms),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.floor !== undefined) result.floor = listing.floor;
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
      detail: `Serving RO via ${STORIA_BASE_URL} (__NEXT_DATA__ JSON + session)`,
    };
  }
}

export { isStoriaChallenge, parseStoriaDetail, parseStoriaSearch, storiaSourceIdFromUrl } from './parse';
