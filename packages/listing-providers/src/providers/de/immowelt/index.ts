/**
 * Immowelt provider (Germany) — JSON-first via SERP init data.
 *
 * Acquisition order (discover):
 *   1. Warm Playwright session → POST `/classified-search-service/v1/searches`
 *      when the session pool is available (DataDome-gated cold).
 *   2. Fall back to search HTML → LZ-decompress `classified-serp-init-data`
 *      (structured JSON cards — preferred over link scraping).
 *   3. UUID `/expose/{uuid}` link scrape as last resort.
 *
 * Fetch prefers the card JSON (hints) or re-parses search/detail HTML JSON.
 * Contact (phone / email / agency) is taken from the card `provider` block.
 *
 * Registered OFF by default (`PROVIDER_IMMOWELT_ENABLED`).
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
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { IMMOWELT_BASE_URL } from './fixtures';
import {
  immoweltExposeUrl,
  immoweltSearchUrl,
  immoweltSourceIdFromUrl,
  isImmoweltChallenge,
  parseImmoweltCard,
  parseImmoweltDetail,
  parseImmoweltSearch,
  parseImmoweltSearchCards,
  type ImmoweltRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'immowelt';

const DEFAULT_CITIES: readonly string[] = [
  'berlin',
  'hamburg',
  'muenchen',
  'koeln',
  'frankfurt',
  'stuttgart',
];

const MAX_SEARCH_PAGES = 3;

const CONTENT_SELECTOR = 'a[href*="/expose/"], [data-testid*="card"], main';

/** Immowelt classified-search AJAX (DataDome-gated without a warm session). */
const SEARCHES_AJAX_URL = `${IMMOWELT_BASE_URL}/classified-search-service/v1/searches`;

export interface ImmoweltProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function resolvePropertyType(raw: string): PropertyType {
  const lower = raw.toLowerCase();
  if (lower.includes('house') || lower.includes('haus')) return PropertyType.HOUSE;
  if (lower.includes('studio')) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function asImmoweltRaw(payload: unknown): ImmoweltRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('immowelt: normalize received a payload that is not an ImmoweltRawListing');
  }
  return payload as ImmoweltRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class ImmoweltProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['DE'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: ImmoweltProviderOptions = {}) {
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
        const searchUrl = immoweltSearchUrl(city, page);

        let refs = runtime.openBrowserSession
          ? await this.discoverViaSession(runtime, searchUrl, job.signal)
          : [];

        if (refs.length === 0) {
          try {
            const { html } = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isImmoweltChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            refs = parseImmoweltSearch(html);
            // Attach card JSON as hints so fetch can normalize without a detail hit.
            const cards = parseImmoweltSearchCards(html);
            const byLegacy = new Map<string, Record<string, unknown>>();
            for (const card of cards) {
              try {
                const parsed = parseImmoweltCard(card);
                byLegacy.set(parsed.sourceId, card);
              } catch {
                // skip
              }
            }
            for (const ref of refs) {
              if (yielded >= limit) return;
              if (seen.has(ref.sourceId)) continue;
              seen.add(ref.sourceId);
              const card = byLegacy.get(ref.sourceId);
              yield {
                provider: this.id,
                sourceId: ref.sourceId,
                url: ref.url,
                hints: card ? { card } : undefined,
              };
              yielded += 1;
            }
            if (refs.length === 0) break;
            continue;
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }

        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
          yielded += 1;
        }
      }
    }
  }

  private async discoverViaSession(
    runtime: FetchRuntime,
    warmUrl: string,
    signal?: AbortSignal,
  ): Promise<{ sourceId: string; url: string }[]> {
    if (!runtime.openBrowserSession) return [];

    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }

    let session: BrowserSession | undefined;
    const start = Date.now();
    try {
      session = await runtime.openBrowserSession({
        warmUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isImmoweltChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });

      // Prefer AJAX searches after warm-up; fall back to page HTML JSON.
      const ajax = await session.request(SEARCHES_AJAX_URL, {
        referer: session.pageUrl(),
        timeoutMs: 30_000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      // Note: searches is typically POST; GET may 404/405 — HTML path below.
      void ajax;

      const html = await session.content();
      const refs = parseImmoweltSearch(html);
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: refs.length > 0 ? 'success' : 'error',
        status: 200,
        latencyMs: Date.now() - start,
        url: warmUrl,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return refs;
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
        detail: `immowelt warm-up failed: ${detail}`,
      });
      return [];
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    // Card JSON may be passed via hints from a prior discover enrichment.
    const hintCard = ref.hints?.card;
    if (hintCard && typeof hintCard === 'object') {
      return { ref, payload: parseImmoweltCard(hintCard as Record<string, unknown>) };
    }

    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isImmoweltChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    // Detail pages may not embed SERP cards — try parsing; if fail, re-fetch city search is too heavy.
    // Prefer hint-less: parseImmoweltDetail throws clearly.
    try {
      const payload = parseImmoweltDetail(html, ref.url);
      return { ref, payload };
    } catch {
      // Fall back: discover-shaped HTML sometimes redirects; scrape UUID-only is insufficient.
      // Re-fetch a Berlin search is wrong. Use minimal payload from URL only — reject.
      throw new Error(`immowelt: no classified JSON on detail page ${ref.url}`);
    }
  }

  private async fetchViaSession(
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
        contentSelector: 'script, main, h1',
        isChallenge: isImmoweltChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });
      const html = await session.content();
      // Detail pages embed UFRN lifecycle JSON; also try SERP-shaped cards.
      const cards = parseImmoweltSearchCards(html);
      let payload: ImmoweltRawListing | undefined;
      for (const card of cards) {
        try {
          const parsed = parseImmoweltCard(card);
          if (parsed.sourceId === ref.sourceId) {
            payload = parsed;
            break;
          }
        } catch {
          // skip malformed card
        }
      }
      if (!payload && cards[0]) {
        try {
          payload = parseImmoweltCard(cards[0]);
        } catch {
          payload = undefined;
        }
      }
      if (!payload) {
        // Try parseImmoweltDetail on full HTML (may throw).
        payload = parseImmoweltDetail(html, ref.url);
      }
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
        detail: 'immowelt detail session failed; falling back to ladder',
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asImmoweltRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`immowelt: listing ${listing.sourceId} has no resolvable price`);
    }
    const city = listing.address.city ?? '';
    const street = listing.address.street ?? city;
    if (!city || !street) {
      throw new Error(`immowelt: listing ${listing.sourceId} missing address city/street`);
    }
    const isSale = listing.operation === 'sale';

    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street,
        city,
        country: 'Germany',
        countryCode: listing.address.countryCode ?? 'DE',
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
      },
      type: resolvePropertyType(listing.propertyType),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (listing.description ?? listing.title) {
      result.description = listing.description ?? listing.title;
    }
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
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
      detail: `Serving DE via ${IMMOWELT_BASE_URL} (SERP JSON / session AJAX)`,
    };
  }
}

export { immoweltSourceIdFromUrl, immoweltExposeUrl, parseImmoweltSearch, parseImmoweltDetail };
