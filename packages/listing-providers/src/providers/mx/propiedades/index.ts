/**
 * Propiedades.com (MX) — JSON-LD + session warm.
 *
 * Often Akamai/Cloudflare blocked from datacenter IPs. Keep OFF until a live
 * residential-proxy discover pass succeeds (`PROVIDER_PROPIEDADES_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
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
import { fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { PROPIEDADES_BASE_URL } from './fixtures';
import {
  isPropiedadesChallenge,
  parsePropiedadesDetail,
  parsePropiedadesSearch,
  type PropiedadesRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'propiedades';
const DEFAULT_CITIES: readonly string[] = ['ciudad-de-mexico', 'guadalajara', 'monterrey'];
const MAX_SEARCH_PAGES = 2;

export interface PropiedadesProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function searchUrl(city: string, page: number): string {
  const base = `${PROPIEDADES_BASE_URL}/${citySlug(city)}/departamentos-renta`;
  return page <= 1 ? base : `${base}?pagina=${page}`;
}

function asRaw(payload: unknown): PropiedadesRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('propiedades: normalize received an invalid payload');
  }
  return payload as PropiedadesRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class PropiedadesProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['MX'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: PropiedadesProviderOptions = {}) {
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
        const pageUrl = searchUrl(city, page);
        let html: string | undefined;
        if (runtime.openBrowserSession) {
          html = await this.fetchViaSession(runtime, pageUrl, job.signal);
        }
        if (!html) {
          try {
            const ladder = await fetchListingViaLadder(runtime, pageUrl, {
              provider: this.id,
              isChallenge: isPropiedadesChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            html = ladder.html;
          } catch {
            return;
          }
        }
        const refs = parsePropiedadesSearch(html);
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
        contentSelector: 'script[type="application/ld+json"], main, a[href*="/inmueble/"]',
        isChallenge: isPropiedadesChallenge,
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
      return isPropiedadesChallenge(html) ? undefined : html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    let html = ctx.runtime.openBrowserSession
      ? await this.fetchViaSession(ctx.runtime, ref.url, ctx.signal)
      : undefined;
    if (!html) {
      const ladder = await fetchListingViaLadder(ctx.runtime, ref.url, {
        provider: this.id,
        isChallenge: isPropiedadesChallenge,
        metrics: this.metrics,
        init: { signal: ctx.signal },
      });
      html = ladder.html;
    }
    return { ref, payload: parsePropiedadesDetail(html, ref.url) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.operation === 'sale';
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
      type: PropertyType.APARTMENT,
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
      detail: `${PROPIEDADES_BASE_URL} often blocked — keep OFF until residential discover works`,
    };
  }
}

export {
  isPropiedadesChallenge,
  parsePropiedadesDetail,
  parsePropiedadesSearch,
  propiedadesSourceIdFromUrl,
} from './parse';
