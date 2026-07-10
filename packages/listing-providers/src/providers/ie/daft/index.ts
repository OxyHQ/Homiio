/**
 * Daft.ie provider (Ireland) — JSON-first via embedded `__NEXT_DATA__`.
 *
 * Cold HTTP works for search + detail on datacenter IPs. Registered OFF by
 * default (`PROVIDER_DAFT_ENABLED`).
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
import { DAFT_BASE_URL } from './fixtures';
import {
  daftSearchUrl,
  isDaftChallenge,
  parseDaftDetail,
  parseDaftSearch,
  type DaftRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'daft';

export interface DaftProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): DaftRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown; price?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale') ||
    typeof record.price !== 'number'
  ) {
    throw new Error('daft: normalize received an invalid payload');
  }
  return payload as DaftRawListing;
}

function resolvePropertyType(raw: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('studio')) return PropertyType.STUDIO;
  if (lower.includes('house') || lower.includes('bungalow')) return PropertyType.HOUSE;
  if (bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class DaftProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['IE'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: DaftProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities =
      options.cities && options.cities.length > 0 ? options.cities : citiesFromEnv('IE');
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    const seen = new Set<string>();
    let yielded = 0;
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'IE');

    for (const city of cities) {
      for (const kind of ['rent', 'sale'] as const) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const pageUrl = daftSearchUrl(city, kind);
          const start = Date.now();
          try {
            const { html, status } = await fetchListingViaLadder(runtime, pageUrl, {
              provider: this.id,
              isChallenge: isDaftChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            const refs = parseDaftSearch(html, city);
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
              yield {
                provider: this.id,
                sourceId: ref.sourceId,
                url: ref.url,
                hints: { kind: ref.kind, city },
              };
              yielded += 1;
            }
            break;
          } catch (error) {
            if (error instanceof ChallengeError) break;
            throw error;
          }
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const cityHint = typeof ref.hints?.city === 'string' ? ref.hints.city : 'Ireland';
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isDaftChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseDaftDetail(html, ref.url, cityHint);
    return { ref, payload };
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
        country: 'Ireland',
        countryCode: listing.address.countryCode,
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
    if (listing.contact) result.contact = listing.contact;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving IE via ${DAFT_BASE_URL} (__NEXT_DATA__ JSON)`,
    };
  }
}

export { isDaftChallenge, parseDaftDetail, parseDaftSearch, daftSearchUrl, daftSourceIdFromUrl } from './parse';
