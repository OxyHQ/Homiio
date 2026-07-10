/**
 * Otodom.pl provider (Poland) — JSON-first via `__NEXT_DATA__` (OLX vertical).
 *
 * Cold HTTP works for search + detail. Registered OFF by default
 * (`PROVIDER_OTODOM_ENABLED`).
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
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { providerMaxSearchPages } from '../../../discoverLimits';
import { citiesFromEnv } from '../../../parse/cities';
import { OTODOM_BASE_URL } from './fixtures';
import {
  isOtodomChallenge,
  otodomSearchUrl,
  parseOtodomDetail,
  parseOtodomSearch,
  type OtodomRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'otodom';

export interface OtodomProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): OtodomRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; operation?: unknown; price?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.operation !== 'rent' && record.operation !== 'sale') ||
    typeof record.price !== 'number'
  ) {
    throw new Error('otodom: normalize received an invalid payload');
  }
  return payload as OtodomRawListing;
}

function resolvePropertyType(estate: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (estate ?? '').toLowerCase();
  if (lower.includes('house') || lower === 'house') return PropertyType.HOUSE;
  if (lower.includes('studio') || bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class OtodomProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['PL'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: OtodomProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities =
      options.cities && options.cities.length > 0 ? options.cities : citiesFromEnv('PL');
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    const seen = new Set<string>();
    let yielded = 0;
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'PL');

    for (const city of cities) {
      for (const kind of ['rent', 'sale'] as const) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const pageUrl = otodomSearchUrl(city, kind, page);
          const start = Date.now();
          try {
            const { html, status } = await fetchListingViaLadder(runtime, pageUrl, {
              provider: this.id,
              isChallenge: isOtodomChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            const refs = parseOtodomSearch(html);
            this.metrics.record({
              provider: this.id,
              strategy: 'http',
              outcome: refs.length > 0 ? 'success' : 'error',
              status,
              latencyMs: Date.now() - start,
              url: pageUrl,
            });
            if (refs.length === 0) break;
            for (const ref of refs) {
              if (yielded >= limit) return;
              if (seen.has(ref.sourceId)) continue;
              seen.add(ref.sourceId);
              yield { provider: this.id, sourceId: ref.sourceId, url: ref.url, hints: { city, kind } };
              yielded += 1;
            }
          } catch (error) {
            if (error instanceof ChallengeError) break;
            throw error;
          }
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isOtodomChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseOtodomDetail(html, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asRaw(raw.payload);
    const result: NormalizedListing = {
      source: this.id,
      sourceId: listing.sourceId,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: 'Poland',
        countryCode: listing.address.countryCode,
        neighborhood: listing.address.neighborhood,
        coordinates: listing.coordinates,
      },
      type: resolvePropertyType(listing.estate, listing.bedrooms),
      offerings: listing.operation === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (listing.operation === 'sale') {
      result.sale = { price: listing.price, currency: listing.currency };
    } else {
      result.longTermRent = { monthlyAmount: listing.price, currency: listing.currency };
    }
    if (listing.description) result.description = listing.description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving PL via ${OTODOM_BASE_URL} (__NEXT_DATA__ JSON)`,
    };
  }
}

export {
  isOtodomChallenge,
  parseOtodomDetail,
  parseOtodomSearch,
  otodomSearchUrl,
  otodomSourceIdFromUrl,
} from './parse';
