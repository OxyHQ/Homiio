/**
 * Idealista provider (Spain).
 *
 * Idealista (idealista.com) is Spain's largest portal. It DOES offer an
 * official partner API ("official API if usable" — the first rung of the plan's
 * ladder), but access requires partner credentials that are not provisioned in
 * this phase, so the active acquisition path is the shared anti-bot
 * {@link fetchListingViaLadder} (HTTP → headless browser → managed). The
 * provider NEVER re-implements rate limiting, retries, challenge detection or
 * metrics — all of that lives in the shared runtime/ladder.
 *
 * `discover()` pages ES-city rental search results into refs; `fetch()` pulls a
 * detail page's HTML; the pure parser in `./parse` flattens its schema.org
 * JSON-LD into an {@link IdealistaRaw}; `normalize()` maps that onto a
 * first-party {@link NormalizedListing}. Registered OFF by default
 * (`PROVIDER_IDEALISTA_ENABLED`).
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
} from '../../types';
import { createFetchRuntime } from '../../runtime';
import { fetchListingViaLadder } from '../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../metrics';
import type { EsSchemaListing } from '../es/jsonLd';
import { IDEALISTA_BASE_URL } from './fixtures';
import { idealistaSourceIdFromUrl, parseIdealistaDetail, parseIdealistaSearch, type IdealistaRaw } from './parse';

const PROVIDER_ID: ProviderId = 'idealista';

/** ES cities enumerated when a discover job carries no explicit `city`. */
const DEFAULT_CITIES: readonly string[] = ['madrid', 'barcelona', 'valencia', 'sevilla', 'malaga'];

/** Max search pages paged through per city in one discover pass. */
const MAX_SEARCH_PAGES = 3;

/** HTML markers of an Idealista interstitial/anti-bot page served with a 200. */
export function isIdealistaChallenge(html: string): boolean {
  if (html.trim().length < 512) return true;
  return /acceso denegado|comprueba que eres humano|datadome/i.test(html);
}

/** Options for {@link IdealistaProvider}. */
export interface IdealistaProviderOptions {
  /** Runtime used by `discover()` (fetch uses the per-call context runtime). */
  runtime?: FetchRuntime;
  /** Override the default discover city list. */
  cities?: readonly string[];
  /** Metrics sink + reader; defaults to the process-wide store. */
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build an Idealista rental search URL for a city + 1-based page number. */
function searchUrl(city: string, page: number): string {
  const base = `${IDEALISTA_BASE_URL}/alquiler-viviendas/${citySlug(city)}/`;
  return page <= 1 ? base : `${base}pagina-${page}.htm`;
}

function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('house') || type.includes('singlefamily'))) return PropertyType.HOUSE;
  if (lower.some((type) => type.includes('studio'))) return PropertyType.STUDIO;
  return PropertyType.APARTMENT;
}

function resolveFurnished(furnished: boolean | undefined): NormalizedListing['furnishedStatus'] {
  if (furnished === true) return 'furnished';
  if (furnished === false) return 'unfurnished';
  return 'not_specified';
}

function toRemoteImages(listing: EsSchemaListing): NormalizedRemoteImage[] {
  return listing.images.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function asIdealistaRaw(payload: unknown): IdealistaRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object'
  ) {
    throw new Error('idealista: normalize received a payload that is not an IdealistaRaw');
  }
  return payload as IdealistaRaw;
}

export class IdealistaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;
  /** Idealista offers an official partner API; gated (no creds) in this phase. */
  readonly hasOfficialApi = true;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: IdealistaProviderOptions = {}) {
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
        const { html } = await fetchListingViaLadder(job.runtime ?? this.runtime, searchUrl(city, page), {
          provider: this.id,
          isChallenge: isIdealistaChallenge,
          metrics: this.metrics,
          init: { signal: job.signal },
        });
        const refs = parseIdealistaSearch(html);
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

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isIdealistaChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseIdealistaDetail(html, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing } = asIdealistaRaw(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`idealista: listing ${sourceId} has no resolvable price`);
    }
    const isSale = listing.operation === 'sale';
    const currency = listing.priceCurrency ?? 'EUR';

    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: {
        street: listing.address.street ?? listing.address.city ?? '',
        city: listing.address.city ?? '',
        state: listing.address.region,
        country: listing.address.country,
        countryCode: listing.address.countryCode ?? 'ES',
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
        coordinates: listing.coordinates,
      },
      type: resolvePropertyType(listing.types),
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency },
      sale: isSale ? { price: listing.price, currency } : undefined,
      remoteImages: toRemoteImages(listing),
      status: 'published',
    };

    const description = listing.description ?? listing.name;
    if (description !== undefined) result.description = description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareMeters !== undefined) result.squareFootage = listing.squareMeters;
    if (listing.amenities.length > 0) result.amenities = listing.amenities;
    const furnished = resolveFurnished(listing.furnished);
    if (furnished !== 'not_specified') result.furnishedStatus = furnished;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    const snapshot = this.metrics.snapshot(this.id);
    if (snapshot && snapshot.attempts > 0) {
      const status =
        snapshot.challengeRate >= 0.8 ? 'unhealthy' : snapshot.challengeRate >= 0.3 ? 'degraded' : 'healthy';
      return {
        provider: this.id,
        status,
        detail: `attempts=${snapshot.attempts} challengeRate=${snapshot.challengeRate.toFixed(2)} avgLatencyMs=${snapshot.avgLatencyMs}`,
      };
    }
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ES via ${IDEALISTA_BASE_URL} (official API gated; HTML ladder active)`,
    };
  }
}

export { idealistaSourceIdFromUrl };
