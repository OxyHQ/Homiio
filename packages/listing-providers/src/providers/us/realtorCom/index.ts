/**
 * realtor.com provider (United States).
 *
 * realtor.com exposes an internal GraphQL API at `/frontdoor/graphql` that powers
 * search and detail pages. This plugin uses direct JSON POST (no HTML scrape) for
 * discover + fetch; the shared {@link FetchRuntime} supplies `fetchHttp` only.
 * Registered OFF by default (`PROVIDER_REALTOR_COM_ENABLED`).
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
import { DEFAULT_US_CITIES } from '../portals';
import {
  REALTOR_GRAPHQL_HEADERS,
  REALTOR_GRAPHQL_URL,
  isRealtorGraphqlChallenge,
  parseRealtorDetailResponse,
  parseRealtorListingNode,
  parseRealtorSearchResponse,
  realtorDetailBody,
  realtorKindFromStatus,
  realtorSearchBody,
  realtorSourceUrl,
  type RealtorKind,
} from './api';
import { REALTOR_COM_BASE_URL, type RecordedRealtorListing } from './fixtures';

const PROVIDER_ID: ProviderId = 'realtor_com';
const CURRENCY = 'USD';
const COUNTRY = 'United States';
const SEARCH_PAGE_SIZE = 42;
const MAX_SEARCH_PAGES = 3;

export interface RealtorComRaw {
  sourceId: string;
  url: string;
  kind: RealtorKind;
  listing: RecordedRealtorListing;
}

export interface RealtorComProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
  cities?: readonly string[];
}

function refKind(ref: ExternalListingRef): RealtorKind {
  return ref.hints?.kind === 'sale' ? 'sale' : 'rent';
}

function resolvePropertyType(kind: RealtorKind): PropertyType {
  return kind === 'sale' ? PropertyType.HOUSE : PropertyType.APARTMENT;
}

function resolveMonthlyAmount(listing: RecordedRealtorListing): number | undefined {
  if (listing.list_price !== null && listing.list_price > 0) return listing.list_price;
  if (listing.list_price_min !== null && listing.list_price_min > 0) return listing.list_price_min;
  return undefined;
}

function resolveSalePrice(listing: RecordedRealtorListing): number | undefined {
  if (listing.list_price !== null && listing.list_price > 0) return listing.list_price;
  return undefined;
}

function toRemoteImages(listing: RecordedRealtorListing): NormalizedRemoteImage[] {
  const urls = listing.photos.map((photo) => photo.href);
  const primary = listing.primary_photo?.href;
  const ordered = primary ? [primary, ...urls.filter((url) => url !== primary)] : urls;
  return [...new Set(ordered)].map((url, index) => ({ url, isPrimary: index === 0 }));
}

function buildAddress(listing: RecordedRealtorListing): NormalizedListingAddress {
  const addr = listing.location.address;
  return {
    street: addr.line,
    city: addr.city,
    state: addr.state_code,
    country: COUNTRY,
    countryCode: 'US',
    postalCode: addr.postal_code,
    coordinates: { lat: addr.coordinate.lat, lng: addr.coordinate.lon },
  };
}

function asRealtorComRaw(payload: unknown): RealtorComRaw {
  const record = payload as
    | { sourceId?: unknown; url?: unknown; kind?: unknown; listing?: unknown }
    | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    (record.kind !== 'rent' && record.kind !== 'sale') ||
    typeof record.listing !== 'object' ||
    record.listing === null
  ) {
    throw new Error('realtor_com provider received a payload that is not a RealtorComRaw');
  }
  return payload as RealtorComRaw;
}

async function postGraphql(
  runtime: FetchRuntime,
  body: string,
  signal?: AbortSignal,
): Promise<string> {
  const { status, body: responseBody } = await runtime.fetchHttp(REALTOR_GRAPHQL_URL, {
    signal,
    method: 'POST',
    body,
    headers: {
      ...REALTOR_GRAPHQL_HEADERS,
      Accept: 'application/json',
    },
  });
  if (status >= 400 || isRealtorGraphqlChallenge(responseBody)) {
    throw new Error(`realtor_com GraphQL failed (HTTP ${status})`);
  }
  return responseBody;
}

export class RealtorComProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['US'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly cities: readonly string[];

  constructor(options: RealtorComProviderOptions = {}) {
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
      for (const kind of ['rent', 'sale'] as const) {
        for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
          if (yielded >= limit) return;
          const offset = page * SEARCH_PAGE_SIZE;
          const start = Date.now();
          let body: string;
          try {
            body = await postGraphql(
              runtime,
              realtorSearchBody(city, kind, offset, SEARCH_PAGE_SIZE),
              job.signal,
            );
          } catch (error) {
            this.metrics.record({
              provider: this.id,
              strategy: 'http',
              outcome: 'error',
              status: 0,
              latencyMs: Date.now() - start,
              url: REALTOR_GRAPHQL_URL,
              detail: error instanceof Error ? error.message : String(error),
            });
            break;
          }

          const refs = parseRealtorSearchResponse(body);
          this.metrics.record({
            provider: this.id,
            strategy: 'http',
            outcome: refs.length > 0 ? 'success' : 'error',
            status: 200,
            latencyMs: Date.now() - start,
            url: REALTOR_GRAPHQL_URL,
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
              hints: { kind: ref.kind },
            };
            yielded += 1;
          }
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const start = Date.now();
    const body = await postGraphql(ctx.runtime, realtorDetailBody(ref.sourceId), ctx.signal);
    const listing = parseRealtorDetailResponse(body);
    if (!listing) {
      this.metrics.record({
        provider: this.id,
        strategy: 'http',
        outcome: 'error',
        status: 200,
        latencyMs: Date.now() - start,
        url: REALTOR_GRAPHQL_URL,
        detail: 'HomeDetails returned no listing',
      });
      throw new Error(`realtor_com: no listing found for property_id ${ref.sourceId}`);
    }
    this.metrics.record({
      provider: this.id,
      strategy: 'http',
      outcome: 'success',
      status: 200,
      latencyMs: Date.now() - start,
      url: REALTOR_GRAPHQL_URL,
    });
    const kind = refKind(ref);
    return {
      ref,
      payload: {
        sourceId: ref.sourceId,
        url: realtorSourceUrl(listing.permalink),
        kind,
        listing,
      } satisfies RealtorComRaw,
    };
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, kind, listing } = asRealtorComRaw(raw.payload);
    const resolvedKind = kind ?? realtorKindFromStatus(listing.status);

    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: buildAddress(listing),
      type: resolvePropertyType(resolvedKind),
      offerings: resolvedKind === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      remoteImages: toRemoteImages(listing),
      status: 'published',
    };

    if (resolvedKind === 'sale') {
      const price = resolveSalePrice(listing);
      if (price === undefined) {
        throw new Error(`realtor_com: listing ${sourceId} has no resolvable sale price`);
      }
      result.sale = { price, currency: CURRENCY };
    } else {
      const monthlyAmount = resolveMonthlyAmount(listing);
      if (monthlyAmount === undefined) {
        throw new Error(`realtor_com: listing ${sourceId} has no resolvable rent price`);
      }
      result.longTermRent = { monthlyAmount, currency: CURRENCY };
    }

    if (listing.description.beds !== null) result.bedrooms = listing.description.beds;
    if (listing.description.baths !== null) result.bathrooms = listing.description.baths;
    if (listing.description.sqft !== null) result.squareFootage = listing.description.sqft;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ${this.markets.join(', ')} via ${REALTOR_COM_BASE_URL} GraphQL`,
    };
  }
}

export { parseRealtorSearchResponse, parseRealtorDetailResponse, parseRealtorListingNode };
