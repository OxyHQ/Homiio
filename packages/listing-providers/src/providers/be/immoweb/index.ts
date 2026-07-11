/**
 * Immoweb provider (Belgium) — JSON-first via `/en/search-results` + classified JSON.
 *
 * Cold HTTP works from datacenter IPs. Registered OFF by default
 * (`PROVIDER_IMMOWEB_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedRemoteImage,
  type ProviderId,
} from '@homiio/shared-types';
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
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { providerMaxSearchPages } from '../../../discoverLimits';
import { citiesFromEnv } from '../../../parse/cities';
import { IMMOWEB_BASE_URL } from './fixtures';
import {
  immowebDetailUrl,
  immowebSearchUrl,
  isImmowebChallenge,
  parseImmowebDetail,
  parseImmowebSearch,
  type ImmowebRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'immoweb';

const JSON_HEADERS: Readonly<Record<string, string>> = {
  Accept: 'application/json',
  'X-Requested-With': 'XMLHttpRequest',
};

export interface ImmowebProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): ImmowebRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown; price?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale') ||
    typeof record.price !== 'number'
  ) {
    throw new Error('immoweb: normalize received an invalid payload');
  }
  return payload as ImmowebRawListing;
}

function resolvePropertyType(raw: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('house')) return PropertyType.HOUSE;
  if (bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

async function fetchJson(
  runtime: FetchRuntime,
  url: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const { status, body } = await runtime.fetchHttp(url, {
    signal,
    headers: JSON_HEADERS,
  });
  if (status >= 400 || isImmowebChallenge(body)) {
    throw new Error(`immoweb JSON failed (HTTP ${status})`);
  }
  return body;
}

export class ImmowebProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['BE'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: ImmowebProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities =
      options.cities && options.cities.length > 0 ? options.cities : citiesFromEnv('BE');
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    const seen = new Set<string>();
    let yielded = 0;
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'BE');

    for (const city of cities) {
      for (const kind of ['rent', 'sale'] as const) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const searchUrl = immowebSearchUrl(city, kind, page);
          const start = Date.now();
          let body: string;
          try {
            body = await fetchJson(runtime, searchUrl, job.signal);
          } catch (error) {
            this.metrics.record({
              provider: this.id,
              strategy: 'http',
              outcome: 'error',
              status: 0,
              latencyMs: Date.now() - start,
              url: searchUrl,
              detail: error instanceof Error ? error.message : String(error),
            });
            break;
          }
          const refs = parseImmowebSearch(body);
          this.metrics.record({
            provider: this.id,
            strategy: 'http',
            outcome: refs.length > 0 ? 'success' : 'error',
            status: 200,
            latencyMs: Date.now() - start,
            url: searchUrl,
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
              hints: { kind: ref.kind, city },
            };
            yielded += 1;
          }
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const detailUrl = immowebDetailUrl(ref.sourceId);
    const start = Date.now();
    const body = await fetchJson(ctx.runtime, detailUrl, ctx.signal);
    const payload = parseImmowebDetail(body, ref.sourceId);
    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: 'success',
      status: 200,
      latencyMs: Date.now() - start,
      url: detailUrl,
    });
    return { ref: { ...ref, url: payload.url }, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.title,
        city: listing.address.city,
        state: listing.address.state,
        country: 'Belgium',
        countryCode: listing.address.countryCode,
        postalCode: listing.address.postalCode,
        coordinates: listing.coordinates,
      },
      type: resolvePropertyType(listing.propertyType, listing.bedrooms),
      offerings: listing.kind === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (listing.kind === 'sale') {
      result.sale = { price: listing.price, currency: listing.currency };
    } else {
      result.longTermRent = { monthlyAmount: listing.price, currency: listing.currency };
    }
    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.yearBuilt !== undefined) result.yearBuilt = listing.yearBuilt;
    if (listing.amenities && listing.amenities.length > 0) result.amenities = listing.amenities;
    if (listing.hasElevator !== undefined) result.hasElevator = listing.hasElevator;
    if (listing.hasGarden !== undefined) result.hasGarden = listing.hasGarden;
    if (listing.hasBalcony !== undefined) result.hasBalcony = listing.hasBalcony;
    if (listing.parkingSpaces !== undefined) result.parkingSpaces = listing.parkingSpaces;
    if (listing.parkingType !== undefined) result.parkingType = listing.parkingType;
    if (listing.furnished === true) result.furnishedStatus = 'furnished';
    if (listing.furnished === false) result.furnishedStatus = 'unfurnished';
    if (listing.contact) result.contact = listing.contact;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving BE via ${IMMOWEB_BASE_URL} search-results JSON`,
    };
  }
}

export {
  isImmowebChallenge,
  parseImmowebDetail,
  parseImmowebSearch,
  immowebSearchUrl,
  immowebDetailUrl,
  immowebSourceIdFromUrl,
} from './parse';
