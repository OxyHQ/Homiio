/**
 * ImmobilienScout24 (DE) — mobile JSON API first.
 * Uses shared contact/html helpers; session pool unused (cold mobile API works).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { createFetchRuntime } from '../../../runtime';
import type {
  DiscoverJob,
  ExternalListingRef,
  FetchContext,
  FetchRuntime,
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../../types';
import { IMMOBILIENSCOUT24_BASE_URL, IMMOBILIENSCOUT24_MOBILE_API } from './fixtures';
import {
  is24ExposeUrl,
  is24PublicUrl,
  is24SearchListUrl,
  is24SourceIdFromUrl,
  parseIs24Expose,
  parseIs24Search,
  type Is24RawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'immobilienscout24';
const DEFAULT_CITIES = ['berlin', 'hamburg', 'muenchen', 'koeln', 'frankfurt', 'stuttgart'] as const;
const MAX_SEARCH_PAGES = 3;
const MOBILE_HEADERS: Record<string, string> = {
  'User-Agent': 'ImmoScout_27.12_26.2_._',
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'Accept-Language': 'de-DE,de;q=0.9',
};

export interface ImmobilienScout24ProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asIs24Raw(payload: unknown): Is24RawListing {
  const record = payload as { sourceId?: unknown; url?: unknown } | null;
  if (!record || typeof record.sourceId !== 'string' || typeof record.url !== 'string') {
    throw new Error('immobilienscout24: normalize received a payload that is not an Is24RawListing');
  }
  return payload as Is24RawListing;
}

export class ImmobilienScout24Provider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['DE'] as const;
  readonly hasOfficialApi = true;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: ImmobilienScout24ProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded >= limit) return;
        const url = is24SearchListUrl(city, page, 'rent');
        const start = Date.now();
        const body = await this.postSearch(url, job.signal);
        if (!body) break;
        const refs = parseIs24Search(body);
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: refs.length > 0 ? 'success' : 'error',
          status: 200,
          latencyMs: Date.now() - start,
          url,
        });
        if (refs.length === 0) break;
        for (const ref of refs) {
          if (yielded >= limit) return;
          if (seen.has(ref.sourceId)) continue;
          seen.add(ref.sourceId);
          yield {
            provider: this.id,
            sourceId: ref.sourceId,
            url: ref.url,
            hints: ref.realEstateType ? { realEstateType: ref.realEstateType } : undefined,
          };
          yielded += 1;
        }
      }
    }
  }

  /** Mobile search is POST-only; shared fetchHttp is GET-only. */
  private async postSearch(url: string, signal?: AbortSignal): Promise<string | undefined> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        signal,
        headers: MOBILE_HEADERS,
        body: JSON.stringify({ supportedResultListType: [], userData: {} }),
      });
      const body = await response.text();
      if (response.status >= 400) {
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: response.status === 403 || response.status === 429 ? 'challenge' : 'error',
          status: response.status,
          latencyMs: 0,
          url,
        });
        return undefined;
      }
      return body;
    } catch (error) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        latencyMs: 0,
        url,
        detail: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const exposeUrl = is24ExposeUrl(ref.sourceId);
    const start = Date.now();
    const { status, body } = await ctx.runtime.fetchHttp(exposeUrl, {
      signal: ctx.signal,
      headers: {
        'User-Agent': MOBILE_HEADERS['User-Agent'] ?? 'ImmoScout_27.12_26.2_._',
        Accept: 'application/json',
        'Accept-Language': 'de-DE,de;q=0.9',
      },
    });
    if (status >= 400) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: status === 403 || status === 429 ? 'challenge' : 'error',
        status,
        latencyMs: Date.now() - start,
        url: exposeUrl,
      });
      throw new Error(`immobilienscout24: expose HTTP ${status} for ${ref.sourceId}`);
    }
    const payload = parseIs24Expose(body, ref.url || is24PublicUrl(ref.sourceId));
    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: 'success',
      status,
      latencyMs: Date.now() - start,
      url: exposeUrl,
    });
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asIs24Raw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`immobilienscout24: listing ${listing.sourceId} has no resolvable price`);
    }
    const city = listing.address.city ?? '';
    const street = listing.address.street ?? city;
    if (!city || !street) {
      throw new Error(`immobilienscout24: listing ${listing.sourceId} missing address`);
    }
    const isSale = listing.operation === 'sale';
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street,
        city,
        state: listing.address.region,
        country: 'Germany',
        countryCode: 'DE',
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
        coordinates:
          listing.address.lat !== undefined && listing.address.lng !== undefined
            ? { lat: listing.address.lat, lng: listing.address.lng }
            : undefined,
      },
      type: /house|haus/i.test(listing.realEstateType ?? '') ? PropertyType.HOUSE : PropertyType.APARTMENT,
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
      detail: `Serving DE via ${IMMOBILIENSCOUT24_MOBILE_API} (public ${IMMOBILIENSCOUT24_BASE_URL})`,
    };
  }
}

export { is24SourceIdFromUrl, is24PublicUrl, parseIs24Search, parseIs24Expose };
