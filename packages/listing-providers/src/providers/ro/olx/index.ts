/**
 * OLX.ro imobiliare provider (Romania) — general classifieds, housing-only.
 *
 * CRITICAL: never site-wide crawl. `discover()` only hits explicit
 * `/imobiliare/…` category URLs. `normalize()` rejects non-`real_estate`
 * categories. Contact name/agency from prerendered JSON; phone via optional
 * limited-phones AJAX when a session can reveal it.
 *
 * Registered OFF by default (`PROVIDER_OLX_RO_ENABLED`).
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
import { citySlug } from '../../../slug';
import { NonHousingListingError } from '../../../classifieds';
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
import { OLX_RO_BASE_URL } from './fixtures';
import {
  isOlxRoChallenge,
  isOlxRoHousingCategory,
  mergeOlxRoPhone,
  parseOlxRoDetail,
  parseOlxRoSearch,
  type OlxRoRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'olx_ro';

const DEFAULT_CITIES: readonly string[] = [
  'bucuresti',
  'cluj-napoca',
  'timisoara',
  'iasi',
  'brasov',
];

const MAX_SEARCH_PAGES = 2;
const CONTENT_SELECTOR = 'a[href*="/d/oferta/"], [data-cy="l-card"], main';

/** Housing category URL builders (allowlist — never general OLX crawl). */
const HOUSING_SEARCHES: ReadonlyArray<(city: string, page: number) => string> = [
  (city, page) => {
    const base = `${OLX_RO_BASE_URL}/imobiliare/apartamente-garsoniere-de-inchiriat/${city}/`;
    return page <= 1 ? base : `${base}?page=${page}`;
  },
  (city, page) => {
    const base = `${OLX_RO_BASE_URL}/imobiliare/apartamente-garsoniere-de-vanzare/${city}/`;
    return page <= 1 ? base : `${base}?page=${page}`;
  },
];

export interface OlxRoProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): OlxRoRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; categoryType?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('olx_ro: normalize received an invalid payload');
  }
  return payload as OlxRoRawListing;
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

export class OlxRoProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['RO'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: OlxRoProviderOptions = {}) {
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
      for (const buildUrl of HOUSING_SEARCHES) {
        if (yielded.count >= limit) return;
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          if (yielded.count >= limit) return;
          const pageUrl = buildUrl(citySlug(city), page);
          try {
            let html: string | undefined;
            if (runtime.openBrowserSession) {
              html = await this.fetchSearchHtmlViaSession(runtime, pageUrl, job.signal);
            }
            if (!html) {
              const ladder = await fetchListingViaLadder(runtime, pageUrl, {
                provider: this.id,
                isChallenge: isOlxRoChallenge,
                metrics: this.metrics,
                init: { signal: job.signal },
              });
              html = ladder.html;
            }
            const refs = parseOlxRoSearch(html);
            if (refs.length === 0) break;
            for (const ref of yieldRefs(refs, seen, limit, yielded)) yield ref;
          } catch (error) {
            if (error instanceof ChallengeError || error instanceof BrowserSessionChallengeError) {
              return;
            }
            throw error;
          }
        }
      }
    }
  }

  private async fetchSearchHtmlViaSession(
    runtime: FetchRuntime,
    pageUrl: string,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: pageUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isOlxRoChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'ro-RO',
        acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return isOlxRoChallenge(html) ? undefined : html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (ctx.runtime.openBrowserSession) {
      const fromSession = await this.fetchViaSession(ref, ctx);
      if (fromSession) return fromSession;
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isOlxRoChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseOlxRoDetail(html, ref.url);
    if (!isOlxRoHousingCategory(payload.categoryType)) {
      throw new NonHousingListingError(this.id, payload.sourceId, `non-housing category "${payload.categoryType}"`);
    }
    return { ref, payload };
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
    try {
      session = await ctx.runtime.openBrowserSession({
        warmUrl: ref.url,
        signal: ctx.signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isOlxRoChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'ro-RO',
        acceptLanguage: 'ro-RO,ro;q=0.9,en;q=0.8',
      });
      const html = await session.content();
      if (isOlxRoChallenge(html)) return undefined;
      let payload = parseOlxRoDetail(html, ref.url);
      if (!isOlxRoHousingCategory(payload.categoryType)) {
        throw new NonHousingListingError(this.id, payload.sourceId, `non-housing category "${payload.categoryType}"`);
      }
      if (payload.numericId) {
        try {
          const { status, body } = await session.request(
            `${OLX_RO_BASE_URL}/api/v1/offers/${payload.numericId}/limited-phones/`,
            { referer: ref.url, timeoutMs: 15_000 },
          );
          if (status >= 200 && status < 300) {
            payload = mergeOlxRoPhone(payload, body);
          }
        } catch {
          // Phone reveal is optional.
        }
      }
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return { ref, payload };
    } catch (error) {
      if (error instanceof NonHousingListingError) throw error;
      return undefined;
    } finally {
      await session?.close();
    }
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    if (!isOlxRoHousingCategory(listing.categoryType)) {
      throw new NonHousingListingError(this.id, listing.sourceId, `non-housing category "${listing.categoryType}"`);
    }
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
      },
      type: PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
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
      detail: `Serving RO housing-only via ${OLX_RO_BASE_URL}/imobiliare/`,
    };
  }
}

export {
  isOlxRoChallenge,
  isOlxRoHousingCategory,
  parseOlxRoDetail,
  parseOlxRoSearch,
  olxRoSourceIdFromUrl,
} from './parse';
