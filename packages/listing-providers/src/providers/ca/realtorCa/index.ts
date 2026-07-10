/**
 * Realtor.ca provider (Canada).
 *
 * Discover + fetch via `api2.realtor.ca` form-encoded JSON after warming
 * `www.realtor.ca` (Imperva `reese84` / `incap_ses_*`). Registered OFF by
 * default (`PROVIDER_REALTOR_CA_ENABLED`).
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
import { providerMaxSearchPages } from '../../../discoverLimits';
import { citySlug } from '../../../slug';
import {
  REALTOR_CA_BASE_URL,
  REALTOR_CA_CITY_BBOX,
} from './fixtures';
import {
  buildRealtorCaSearchBody,
  isRealtorCaApiChallenge,
  realtorCaDetailUrl,
  realtorCaSearchUrl,
  type RealtorCaTransaction,
} from './api';
import {
  isRealtorCaChallenge,
  parseRealtorCaDetail,
  parseRealtorCaSearch,
  type RealtorCaRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'realtor_ca';

const DEFAULT_CITIES: readonly string[] = ['toronto', 'vancouver', 'montreal', 'calgary', 'ottawa'];

export interface RealtorCaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): RealtorCaRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale')
  ) {
    throw new Error('realtor_ca: normalize received an invalid payload');
  }
  return payload as RealtorCaRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function resolvePropertyType(label: string | undefined): PropertyType {
  const lower = (label ?? '').toLowerCase();
  if (lower.includes('house') || lower.includes('detached')) return PropertyType.HOUSE;
  if (lower.includes('studio')) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

export class RealtorCaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['CA'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private stickyProxySessionId?: string;
  private stickyStorageState?: BrowserStorageState;

  constructor(options: RealtorCaProviderOptions = {}) {
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
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'CA');
    const transactions: readonly RealtorCaTransaction[] = ['rent', 'sale'];

    for (const city of cities) {
      const key = citySlug(city);
      const bbox = REALTOR_CA_CITY_BBOX[key];
      if (!bbox) continue;

      for (const transaction of transactions) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const body = await this.postSearch(runtime, bbox, transaction, page, job.signal);
          if (!body) break;
          const refs = parseRealtorCaSearch(body, transaction);
          if (refs.length === 0) break;
          for (const ref of refs) {
            if (yielded >= limit) return;
            if (seen.has(ref.sourceId)) continue;
            seen.add(ref.sourceId);
            yield {
              provider: this.id,
              sourceId: ref.sourceId,
              url: ref.url,
              hints: { kind: ref.kind, city: key },
            };
            yielded += 1;
          }
        }
      }
    }
  }

  private async postSearch(
    runtime: FetchRuntime,
    bbox: (typeof REALTOR_CA_CITY_BBOX)[string],
    transaction: RealtorCaTransaction,
    page: number,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const searchUrl = realtorCaSearchUrl();
    const bodyParams = buildRealtorCaSearchBody(bbox, transaction, page);
    const start = Date.now();

    if (runtime.openBrowserSession) {
      const fromSession = await this.postViaSession(runtime, searchUrl, bodyParams.toString(), signal);
      if (fromSession && !isRealtorCaApiChallenge(fromSession)) {
        this.metrics.record({
          provider: this.id,
          strategy: 'browser',
          outcome: 'success',
          status: 200,
          latencyMs: Date.now() - start,
          url: searchUrl,
        });
        return fromSession;
      }
    }

    const { status, body } = await runtime.fetchHttp(searchUrl, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Referer: `${REALTOR_CA_BASE_URL}/`,
        Origin: REALTOR_CA_BASE_URL,
      },
      body: bodyParams.toString(),
    });
    const ok = status < 400 && !isRealtorCaApiChallenge(body);
    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: ok ? 'success' : 'challenge',
      status,
      latencyMs: Date.now() - start,
      url: searchUrl,
    });
    return ok ? body : undefined;
  }

  private async getViaSession(
    runtime: FetchRuntime,
    apiUrl: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: `${REALTOR_CA_BASE_URL}/`,
        signal,
        contentSelector: 'main, #map, body',
        isChallenge: isRealtorCaChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'en-CA',
        acceptLanguage: 'en-CA,en;q=0.9',
      });
      const response = await session.request(apiUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        referer: `${REALTOR_CA_BASE_URL}/`,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return response.body;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  private async postViaSession(
    runtime: FetchRuntime,
    apiUrl: string,
    formBody: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (!runtime.openBrowserSession) return undefined;
    const sticky = envBool('LISTING_PROXY_STICKY', false);
    if (sticky && !this.stickyProxySessionId) {
      this.stickyProxySessionId = createProxySessionId();
    }
    let session: BrowserSession | undefined;
    try {
      session = await runtime.openBrowserSession({
        warmUrl: `${REALTOR_CA_BASE_URL}/`,
        signal,
        contentSelector: 'main, #map, body',
        isChallenge: isRealtorCaChallenge,
        challengeWaitMs: 45_000,
        stickyProxySession: sticky,
        proxySessionId: this.stickyProxySessionId,
        storageState: this.stickyStorageState,
        blockAssets: true,
        locale: 'en-CA',
        acceptLanguage: 'en-CA,en;q=0.9',
      });
      const response = await session.request(apiUrl, {
        method: 'POST',
        data: formBody,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/javascript, */*; q=0.01',
        },
        referer: `${REALTOR_CA_BASE_URL}/`,
      });
      if (sticky) this.stickyStorageState = await session.exportStorageState();
      return response.body;
    } catch {
      return undefined;
    } finally {
      await session?.close();
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const detailUrl = realtorCaDetailUrl(ref.sourceId);
    let body: string | undefined;

    if (ctx.runtime.openBrowserSession) {
      const sessionBody = await this.getViaSession(ctx.runtime, detailUrl, ctx.signal);
      if (sessionBody && !isRealtorCaApiChallenge(sessionBody)) body = sessionBody;
    }

    if (!body) {
      const ladder = await fetchListingViaLadder(ctx.runtime, detailUrl, {
        provider: this.id,
        isChallenge: isRealtorCaChallenge,
        metrics: this.metrics,
        init: {
          signal: ctx.signal,
          headers: {
            Accept: 'application/json',
            Referer: `${REALTOR_CA_BASE_URL}/`,
          },
        },
      });
      body = ladder.html;
    }

    const payload = parseRealtorCaDetail(body, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const isSale = listing.kind === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.state,
        country: 'Canada',
        countryCode: listing.address.countryCode,
        postalCode: listing.address.postalCode,
        coordinates: listing.address.coordinates,
      },
      type: resolvePropertyType(listing.propertyType),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale
        ? undefined
        : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };
    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareFootage !== undefined) result.squareFootage = listing.squareFootage;
    if (listing.contact) result.contact = listing.contact;
    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'degraded',
      detail: `${REALTOR_CA_BASE_URL} Imperva-gated — keep OFF until CA browser session + api2 POST works`,
    };
  }
}

export {
  isRealtorCaChallenge,
  parseRealtorCaDetail,
  parseRealtorCaSearch,
  realtorCaSourceIdFromUrl,
} from './parse';
