/**
 * Immowelt (DE) — JSON-first via SERP LZ init data + optional Playwright session.
 * Reuses shared session helpers, html extractors, and contact parsers.
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
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { createFetchRuntime } from '../../../runtime';
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../../types';
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
const DEFAULT_CITIES = ['berlin', 'hamburg', 'muenchen', 'koeln', 'frankfurt', 'stuttgart'] as const;
const MAX_SEARCH_PAGES = 3;
const CONTENT_SELECTOR = 'a[href*="/expose/"], main';

export interface ImmoweltProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asImmoweltRaw(payload: unknown): ImmoweltRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('immowelt: normalize received a payload that is not an ImmoweltRawListing');
  }
  return payload as ImmoweltRawListing;
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

        let html: string | undefined;
        if (runtime.openBrowserSession) {
          html = await this.warmSearchHtml(runtime, searchUrl, job.signal);
        }
        if (!html) {
          try {
            const result = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isImmoweltChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            html = result.html;
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }

        const refs = parseImmoweltSearch(html);
        const cards = parseImmoweltSearchCards(html);
        const byLegacy = new Map<string, Record<string, unknown>>();
        for (const card of cards) {
          try {
            byLegacy.set(parseImmoweltCard(card).sourceId, card);
          } catch {
            // skip
          }
        }
        if (refs.length === 0) break;
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
      }
    }
  }

  private async warmSearchHtml(
    runtime: FetchRuntime,
    warmUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();

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
      const html = await session.content();
      this.metrics.record({
        provider: this.id,
        strategy: 'browser',
        outcome: 'success',
        status: 200,
        latencyMs: Date.now() - start,
        url: warmUrl,
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
        url: warmUrl,
        detail,
      });
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const hintCard = ref.hints?.card;
    if (hintCard && typeof hintCard === 'object' && !Array.isArray(hintCard)) {
      return { ref, payload: parseImmoweltCard(hintCard as Record<string, unknown>) };
    }

    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isImmoweltChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseImmoweltDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asImmoweltRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`immowelt: listing ${listing.sourceId} has no resolvable price`);
    }
    const city = listing.address.city ?? '';
    const street = listing.address.street ?? city;
    if (!city || !street) throw new Error(`immowelt: listing ${listing.sourceId} missing address`);
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
      type: /house|haus/i.test(listing.propertyType) ? PropertyType.HOUSE : PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: listing.images.map((url, index): NormalizedRemoteImage => ({
        url,
        isPrimary: index === 0,
      })),
      status: 'published',
    };
    if (listing.description ?? listing.title) result.description = listing.description ?? listing.title;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.floor !== undefined) result.floor = listing.floor;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving DE via ${IMMOWELT_BASE_URL} (SERP JSON / session)`,
    };
  }
}

export { immoweltSourceIdFromUrl, immoweltExposeUrl, parseImmoweltSearch, parseImmoweltDetail };
