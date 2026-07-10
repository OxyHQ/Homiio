/**
 * Funda.nl provider (Netherlands) — JSON-first via reverse-engineered mobile API.
 *
 * Uses `listing-search-wonen.funda.io` + `listing-detail-page.funda.io`. Akamai
 * blocks datacenter IPs (403) — keep OFF until `LISTING_HTTP_USE_PROXY` or
 * browser tier is provisioned. Registered OFF by default (`PROVIDER_FUNDA_ENABLED`).
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
import { FUNDA_BASE_URL } from './fixtures';
import {
  FUNDA_JSON_HEADERS,
  FUNDA_SEARCH_URL,
  fundaDetailUrl,
  fundaSearchBody,
  isFundaChallenge,
  parseFundaDetail,
  parseFundaSearch,
  type FundaRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'funda';

export interface FundaProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asRaw(payload: unknown): FundaRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; kind?: unknown; price?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale') ||
    typeof record.price !== 'number'
  ) {
    throw new Error('funda: normalize received an invalid payload');
  }
  return payload as FundaRawListing;
}

function resolvePropertyType(raw: string | undefined, bedrooms: number | undefined): PropertyType {
  const lower = (raw ?? '').toLowerCase();
  if (lower.includes('house') || lower.includes('woonhuis')) return PropertyType.HOUSE;
  if (lower.includes('studio') || bedrooms === 0) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

async function postSearch(
  runtime: FetchRuntime,
  body: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const { status, body: responseBody } = await runtime.fetchHttp(FUNDA_SEARCH_URL, {
    signal,
    method: 'POST',
    body,
    headers: {
      ...FUNDA_JSON_HEADERS,
      'Content-Type': 'application/x-ndjson',
    },
  });
  if (status >= 400 || isFundaChallenge(responseBody)) {
    throw new Error(`funda search failed (HTTP ${status})`);
  }
  return responseBody;
}

async function fetchDetail(
  runtime: FetchRuntime,
  sourceId: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const { status, body } = await runtime.fetchHttp(fundaDetailUrl(sourceId), {
    signal,
    headers: FUNDA_JSON_HEADERS,
  });
  if (status >= 400 || isFundaChallenge(body)) {
    throw new Error(`funda detail failed (HTTP ${status})`);
  }
  return body;
}

export class FundaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['NL'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: FundaProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities =
      options.cities && options.cities.length > 0 ? options.cities : citiesFromEnv('NL');
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const runtime = job.runtime ?? this.runtime;
    const seen = new Set<string>();
    let yielded = 0;
    const maxPages = providerMaxSearchPages(PROVIDER_ID, 2, 'NL');

    for (const city of cities) {
      for (const kind of ['rent', 'sale'] as const) {
        for (let page = 1; page <= maxPages; page += 1) {
          if (yielded >= limit) return;
          const start = Date.now();
          let body: string;
          try {
            body = await postSearch(runtime, fundaSearchBody(city, kind, page), job.signal);
          } catch (error) {
            this.metrics.record({
              provider: this.id,
              strategy: 'http',
              outcome: 'challenge',
              status: 403,
              latencyMs: Date.now() - start,
              url: FUNDA_SEARCH_URL,
              detail: error instanceof Error ? error.message : String(error),
            });
            break;
          }
          const refs = parseFundaSearch(body);
          this.metrics.record({
            provider: this.id,
            strategy: 'http',
            outcome: refs.length > 0 ? 'success' : 'error',
            status: 200,
            latencyMs: Date.now() - start,
            url: FUNDA_SEARCH_URL,
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
    const start = Date.now();
    const body = await fetchDetail(ctx.runtime, ref.sourceId, ctx.signal);
    const payload = parseFundaDetail(body, ref.sourceId);
    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: 'success',
      status: 200,
      latencyMs: Date.now() - start,
      url: fundaDetailUrl(ref.sourceId),
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
        country: 'Netherlands',
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
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.contact) result.contact = listing.contact;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    const snapshot = this.metrics.snapshot(this.id);
    if (snapshot && snapshot.attempts > 0 && snapshot.challengeRate >= 0.5) {
      return {
        provider: this.id,
        status: 'degraded',
        detail: `Akamai challengeRate=${snapshot.challengeRate.toFixed(2)} — needs residential proxy`,
      };
    }
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving NL via ${FUNDA_BASE_URL} mobile JSON (proxy required from datacenter)`,
    };
  }
}

export {
  isFundaChallenge,
  parseFundaDetail,
  parseFundaSearch,
  fundaSearchBody,
  fundaDetailUrl,
  fundaSourceIdFromUrl,
  FUNDA_JSON_HEADERS,
} from './parse';
