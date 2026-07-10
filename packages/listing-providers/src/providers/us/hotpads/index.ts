/**
 * HotPads provider (United States).
 *
 * HotPads exposes a public JSON API (`hotpads-api-gke-prod-...hotpads.com`) that
 * powers its search UI — no auth, no PerimeterX on the API host. This plugin
 * uses direct HTTP JSON for discover + fetch. Registered OFF by default
 * (`PROVIDER_HOTPADS_ENABLED`).
 */

import {
  OfferingType,
  PropertyType,
  type NormalizedListing,
  type NormalizedListingAddress,
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
import { cityToResourceSlug, DEFAULT_US_CITIES } from '../portals';
import {
  hotpadsAreaUrl,
  hotpadsListingsUrl,
  hotpadsSourceUrl,
  isHotpadsApiChallenge,
  parseHotpadsArea,
  parseHotpadsListingById,
  parseHotpadsSearch,
  type HotpadsArea,
} from './api';
import { HOTPADS_BASE_URL, type HotpadsListingFixture } from './fixtures';

const PROVIDER_ID: ProviderId = 'hotpads';
const CURRENCY = 'USD';
const COUNTRY = 'United States';
const SEARCH_LIMIT = 200;

export interface HotpadsRaw {
  sourceId: string;
  url: string;
  listing: HotpadsListingFixture;
}

export interface HotpadsProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
  cities?: readonly string[];
}

function resolvePropertyType(propertyType: string): PropertyType {
  const lower = propertyType.toLowerCase();
  if (lower.includes('house') || lower.includes('town')) return PropertyType.HOUSE;
  if (lower.includes('studio') || lower === 'divided') return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(listing: HotpadsListingFixture): NormalizedRemoteImage[] {
  const urls = [listing.medPhotoUrl, ...listing.medPhotoUrls].filter((url) => url.length > 0);
  return [...new Set(urls)].map((url, index) => ({ url, isPrimary: index === 0 }));
}

function buildAddress(listing: HotpadsListingFixture): NormalizedListingAddress {
  return {
    street: listing.address.street,
    city: listing.address.city,
    state: listing.address.state,
    country: COUNTRY,
    countryCode: 'US',
    postalCode: listing.address.zip,
    coordinates: { lat: listing.geo.lat, lng: listing.geo.lon },
  };
}

function asHotpadsRaw(payload: unknown): HotpadsRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object' ||
    record.listing === null
  ) {
    throw new Error('hotpads provider received a payload that is not a HotpadsRaw');
  }
  return payload as HotpadsRaw;
}

async function fetchArea(runtime: FetchRuntime, city: string, signal?: AbortSignal): Promise<HotpadsArea> {
  const resourceId = cityToResourceSlug(city);
  const { status, body } = await runtime.fetchHttp(hotpadsAreaUrl(resourceId), { signal });
  if (status >= 400 || isHotpadsApiChallenge(body)) {
    throw new Error(`hotpads area lookup failed for ${city} (HTTP ${status})`);
  }
  const area = parseHotpadsArea(body);
  if (!area) throw new Error(`hotpads area lookup returned no data for ${city}`);
  return area;
}

export class HotpadsProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['US'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly cities: readonly string[];

  constructor(options: HotpadsProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_US_CITIES;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      if (yielded >= limit) return;
      const start = Date.now();
      let area: HotpadsArea;
      try {
        area = await fetchArea(runtime, city, job.signal);
      } catch (error) {
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: 'error',
          status: 0,
          latencyMs: Date.now() - start,
          url: hotpadsAreaUrl(cityToResourceSlug(city)),
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const listUrl = hotpadsListingsUrl(area, SEARCH_LIMIT);
      const { status, body } = await runtime.fetchHttp(listUrl, { signal: job.signal });
      const refs = parseHotpadsSearch(body);
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: status < 400 && refs.length > 0 ? 'success' : 'error',
        status,
        latencyMs: Date.now() - start,
        url: listUrl,
      });

      for (const ref of refs) {
        if (yielded >= limit) return;
        if (seen.has(ref.sourceId)) continue;
        seen.add(ref.sourceId);
        yield {
          provider: this.id,
          sourceId: ref.sourceId,
          url: ref.url,
          hints: { lotIdEncoded: ref.lotIdEncoded, city },
        };
        yielded += 1;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const cityHint = typeof ref.hints?.city === 'string' ? ref.hints.city : undefined;
    const cities = cityHint ? [cityHint] : this.cities;
    const start = Date.now();

    for (const city of cities) {
      const area = await fetchArea(ctx.runtime, city, ctx.signal);
      const listUrl = hotpadsListingsUrl(area, SEARCH_LIMIT);
      const { status, body } = await ctx.runtime.fetchHttp(listUrl, { signal: ctx.signal });
      const listing = parseHotpadsListingById(body, ref.sourceId);
      if (listing) {
        this.metrics.record({
          provider: this.id,
          strategy: 'http',
          outcome: 'success',
          status,
          latencyMs: Date.now() - start,
          url: listUrl,
        });
        return {
          ref,
          payload: {
            sourceId: ref.sourceId,
            url: hotpadsSourceUrl(listing.uriMalone),
            listing,
          } satisfies HotpadsRaw,
        };
      }
    }

    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: 'error',
      status: 404,
      latencyMs: Date.now() - start,
      url: ref.url,
      detail: `listing ${ref.sourceId} not found in search refresh`,
    });
    throw new Error(`hotpads: listing ${ref.sourceId} not found in city search refresh`);
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing } = asHotpadsRaw(raw.payload);
    const monthlyAmount = listing.modelSummary.minPrice;
    if (monthlyAmount <= 0) {
      throw new Error(`hotpads: listing ${sourceId} has no resolvable price`);
    }

    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: buildAddress(listing),
      type: resolvePropertyType(listing.propertyType),
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount, currency: CURRENCY },
      remoteImages: toRemoteImages(listing),
      status: 'published',
      description: listing.title,
      bedrooms: listing.modelSummary.minBeds,
      bathrooms: listing.modelSummary.minBaths,
      squareFootage: listing.modelSummary.minSqft,
    };

    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ${this.markets.join(', ')} via ${HOTPADS_BASE_URL} JSON API`,
    };
  }
}

export { parseHotpadsSearch, parseHotpadsListingById, parseHotpadsArea };
