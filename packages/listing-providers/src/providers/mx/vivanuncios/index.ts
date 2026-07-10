/**
 * Vivanuncios Mexico provider — general classifieds, HOUSING ONLY.
 *
 * CRITICAL: never site-wide crawl. `discover()` only hits
 * `s-departamentos-en-renta` / `s-casas-en-renta` category URLs. Detail parse
 * rejects non-housing via {@link isHousingCategoryUrl} +
 * {@link assertHousingListing}. Prefer a warmed Playwright session, then the
 * shared fetch ladder.
 *
 * Registered OFF by default (`PROVIDER_VIVANUNCIOS_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
import { isHousingCategoryUrl, NonHousingListingError } from '../../../classifieds';
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
import { VIVANUNCIOS_BASE_URL, VIVANUNCIOS_HOUSING_SLUGS } from './fixtures';
import {
  isVivanunciosChallenge,
  parseVivanunciosDetail,
  parseVivanunciosSearch,
  type VivanunciosRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'vivanuncios';

const DEFAULT_CITIES: readonly string[] = [
  'ciudad-de-mexico',
  'guadalajara',
  'monterrey',
  'puebla',
  'queretaro',
];

/** Housing category path builders — allowlist only. */
const HOUSING_SEARCHES: ReadonlyArray<(city: string, page: number) => string> = [
  (city, page) => {
    const base = `${VIVANUNCIOS_BASE_URL}/s-departamentos-en-renta/${citySlug(city)}`;
    return page <= 1 ? base : `${base}/page-${page}`;
  },
  (city, page) => {
    const base = `${VIVANUNCIOS_BASE_URL}/s-casas-en-renta/${citySlug(city)}`;
    return page <= 1 ? base : `${base}/page-${page}`;
  },
];

const MAX_SEARCH_PAGES = 2;
const CONTENT_SELECTOR =
  'script[type="application/ld+json"], main, a[href*="/a-renta-"], a[href*="/a-venta-"]';

export interface VivanunciosProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): VivanunciosRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('vivanuncios: normalize received an invalid payload');
  }
  return payload as VivanunciosRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class VivanunciosProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['MX'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: VivanunciosProviderOptions = {}) {
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
      for (const buildUrl of HOUSING_SEARCHES) {
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          if (yielded >= limit) return;
          const pageUrl = buildUrl(city, page);
          if (!isHousingCategoryUrl(pageUrl, VIVANUNCIOS_HOUSING_SLUGS)) {
            throw new Error(`vivanuncios: refuse non-housing discover URL ${pageUrl}`);
          }
          try {
            let html: string | undefined;
            if (runtime.openBrowserSession) {
              html = await this.fetchViaSession(runtime, pageUrl, job.signal);
            }
            if (!html) {
              const ladder = await fetchListingViaLadder(runtime, pageUrl, {
                provider: this.id,
                isChallenge: isVivanunciosChallenge,
                metrics: this.metrics,
                init: { signal: job.signal },
              });
              html = ladder.html;
            }
            const refs = parseVivanunciosSearch(html);
            if (refs.length === 0) break;
            for (const ref of refs) {
              if (yielded >= limit) return;
              if (seen.has(ref.sourceId)) continue;
              if (!isHousingCategoryUrl(ref.url, VIVANUNCIOS_HOUSING_SLUGS)) continue;
              seen.add(ref.sourceId);
              yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
              yielded += 1;
            }
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }
      }
    }
  }

  private async fetchViaSession(
    runtime: FetchRuntime,
    pageUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: pageUrl,
        signal,
        contentSelector: CONTENT_SELECTOR,
        isChallenge: isVivanunciosChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'es-MX',
        acceptLanguage: 'es-MX,es;q=0.9',
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return isVivanunciosChallenge(html) ? undefined : html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    if (!isHousingCategoryUrl(ref.url, VIVANUNCIOS_HOUSING_SLUGS)) {
      throw new NonHousingListingError(this.id, ref.sourceId, `url is not housing: ${ref.url}`);
    }
    let html = ctx.runtime.openBrowserSession
      ? await this.fetchViaSession(ctx.runtime, ref.url, ctx.signal)
      : undefined;
    if (!html) {
      const ladder = await fetchListingViaLadder(ctx.runtime, ref.url, {
        provider: this.id,
        isChallenge: isVivanunciosChallenge,
        metrics: this.metrics,
        init: { signal: ctx.signal },
      });
      html = ladder.html;
    }
    return { ref, payload: parseVivanunciosDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    if (!isHousingCategoryUrl(listing.url, VIVANUNCIOS_HOUSING_SLUGS)) {
      throw new NonHousingListingError(this.id, listing.sourceId, `url is not housing: ${listing.url}`);
    }
    const isSale = listing.operation === 'sale';
    const isHouse = /casa/i.test(listing.url) || /casa/i.test(listing.category ?? '');
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: 'Mexico',
        countryCode: 'MX',
      },
      type: isHouse ? PropertyType.HOUSE : PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale
        ? undefined
        : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    else if (listing.title) result.description = listing.title;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'degraded',
      detail: `Housing-only via ${VIVANUNCIOS_BASE_URL} (s-departamentos-en-renta, s-casas-en-renta) — keep OFF until residential discover works`,
    };
  }
}

export {
  isVivanunciosChallenge,
  parseVivanunciosDetail,
  parseVivanunciosSearch,
  vivanunciosSourceIdFromUrl,
} from './parse';
