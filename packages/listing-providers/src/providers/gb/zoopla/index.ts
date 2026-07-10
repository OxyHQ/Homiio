/**
 * Zoopla provider (United Kingdom).
 *
 * Cloudflare blocks cold HTTP (403). Prefer warmed Playwright session, then
 * parse `__NEXT_DATA__` listing JSON (contact from branch/agent). HTML link
 * scrape is the discover fallback. Housing-only.
 *
 * Registered OFF by default (`PROVIDER_ZOOPLA_ENABLED`) — enable once a
 * residential proxy + browser tier clears Cloudflare in the worker.
 */

import {
  OfferingType,
  type NormalizedListing,
  type NormalizedListingAddress,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import type { BrowserSession, BrowserStorageState } from '../../../browserSession';
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
import { isGbPortalChallenge } from '../challenge';
import { resolveGbPropertyType } from '../housing';
import { ZOOPLA_BASE_URL } from './fixtures';
import {
  parseZooplaDetail,
  parseZooplaSearch,
  zooplaSearchUrl,
  zooplaSourceIdFromUrl,
  type ZooplaListingJson,
} from './parse';

const PROVIDER_ID: ProviderId = 'zoopla';
const DEFAULT_CITIES: readonly string[] = ['london', 'manchester', 'birmingham', 'edinburgh', 'bristol'];
const MAX_SEARCH_PAGES = 3;

export function isZooplaChallenge(html: string): boolean {
  return isGbPortalChallenge(html);
}

export interface ZooplaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asZooplaRaw(payload: unknown): ZooplaListingJson {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale')
  ) {
    throw new Error('zoopla: normalize received an invalid payload');
  }
  return payload as ZooplaListingJson;
}

function splitAddress(displayAddress: string | undefined): {
  street: string;
  city: string;
  postalCode?: string;
} {
  if (!displayAddress) return { street: '', city: '' };
  const parts = displayAddress.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { street: '', city: '' };
  if (parts.length === 1) return { street: parts[0], city: parts[0] };
  const last = parts[parts.length - 1];
  const postcodeMatch = last.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  const city = postcodeMatch ? parts[parts.length - 2] ?? last : last;
  const street = parts.slice(0, Math.max(1, parts.length - (postcodeMatch ? 2 : 1))).join(', ');
  return { street: street || city, city, postalCode: postcodeMatch?.[1]?.toUpperCase() };
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class ZooplaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['GB'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: ZooplaProviderOptions = {}) {
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
        const searchUrl = zooplaSearchUrl(city, page);
        let html: string | undefined;
        if (runtime.openBrowserSession) {
          html = await this.fetchHtmlViaSession(runtime, searchUrl, job.signal);
        }
        if (!html) {
          try {
            const result = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isZooplaChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            html = result.html;
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }
        const refs = parseZooplaSearch(html);
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yielded += 1;
          yield {
            provider: PROVIDER_ID,
            sourceId: ref.sourceId,
            url: ref.url,
            hints: { kind: ref.kind },
          };
        }
      }
    }
  }

  private async fetchHtmlViaSession(
    runtime: FetchRuntime,
    url: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) this.stickyProxySessionId = createProxySessionId();
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: url,
        signal,
        contentSelector: 'script#__NEXT_DATA__, a[href*="/details/"], main',
        isChallenge: isZooplaChallenge,
        challengeWaitMs: 60_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
      });
      const html = await session.content();
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return html;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const kind = ref.hints?.kind === 'sale' ? 'sale' : 'rent';
    if (ctx.runtime.openBrowserSession) {
      const html = await this.fetchHtmlViaSession(ctx.runtime, ref.url, ctx.signal);
      if (html) return { ref, payload: parseZooplaDetail(html, ref.url, kind) };
    }
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isZooplaChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseZooplaDetail(html, ref.url, kind) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asZooplaRaw(raw.payload);
    if (listing.priceAmount === undefined) {
      throw new Error(`zoopla: listing ${listing.sourceId} has no resolvable price`);
    }
    const split = splitAddress(listing.displayAddress);
    const address: NormalizedListingAddress = {
      street: split.street,
      city: split.city,
      country: 'United Kingdom',
      countryCode: 'GB',
      postalCode: split.postalCode,
    };
    if (listing.latitude !== undefined && listing.longitude !== undefined) {
      address.coordinates = { lat: listing.latitude, lng: listing.longitude };
    }
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address,
      type: resolveGbPropertyType(listing.propertyType),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale
        ? undefined
        : { monthlyAmount: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' },
      sale: isSale ? { price: listing.priceAmount, currency: listing.priceCurrency ?? 'GBP' } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description ?? listing.summary) {
      result.description = listing.description ?? listing.summary;
    }
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving GB via ${ZOOPLA_BASE_URL} (Cloudflare — needs browser + residential proxy)`,
    };
  }
}

export { zooplaSourceIdFromUrl };
