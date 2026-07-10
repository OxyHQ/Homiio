/**
 * apartments.com provider (United States).
 *
 * apartments.com is a large US rental portal with no public API, so this plugin
 * scrapes seriously through the shared {@link FetchRuntime} — it NEVER
 * re-implements anti-bot infrastructure. Acquisition/escalation (HTTP →
 * headless browser → managed proxy) is owned entirely by the runtime's shared
 * {@link StrategyLadder}; the provider only asks the runtime for bytes and
 * turns them into a {@link NormalizedListing}. `discover()` pages US city
 * search results into {@link ExternalListingRef}s; `fetch()` pulls a detail
 * page's HTML; the shared {@link extractSchemaOrgListings} parser lifts the
 * embedded schema.org JSON-LD; `normalize()` maps it onto a first-party USD
 * long-term-rent listing. Registered OFF by default
 * (`PROVIDER_APARTMENTS_COM_ENABLED`).
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
import { fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink, type StrategyName } from '../../../metrics';
import { extractSchemaOrgListings, pickPrimaryListing, type SchemaOrgListing } from '../jsonLd';
import { isUsPortalChallenge } from '../challenge';

const PROVIDER_ID: ProviderId = 'apartments_com';
const BASE_URL = 'https://www.apartments.com';
const CURRENCY = 'USD';
const COUNTRY = 'United States';

/** US cities enumerated when a discover job omits an explicit `city`. */
const DEFAULT_CITIES: readonly string[] = [
  'New York, NY',
  'Los Angeles, CA',
  'Chicago, IL',
  'Austin, TX',
  'Miami, FL',
];

/** apartments.com detail URLs: `/<complex-city-slug>/<alnum-code>/`. */
const DETAIL_URL_RE = /https?:\/\/www\.apartments\.com\/[a-z0-9-]+\/[a-z0-9]+\/?/gi;

/** The raw payload apartments.com `fetch()` hands to `normalize()`. */
export interface ApartmentsComRaw {
  sourceId: string;
  url: string;
  listing: SchemaOrgListing;
}

function slugifyCity(city: string): string {
  return city
    .toLowerCase()
    .replace(/,/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function searchUrl(city: string): string {
  return `${BASE_URL}/${slugifyCity(city)}/`;
}

/** Derive the stable source id from a detail URL's final path segment. */
function sourceIdFromUrl(url: string): string {
  const pathname = new URL(url).pathname.replace(/\/+$/, '');
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? url;
}

/** Extract detail-page refs from a search page's HTML. */
export function parseApartmentsComSearch(html: string): ExternalListingRef[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(DETAIL_URL_RE)) {
    urls.add(match[0].replace(/\/?$/, '/'));
  }
  return [...urls].map((url) => ({ provider: PROVIDER_ID, sourceId: sourceIdFromUrl(url), url }));
}

/** Parse a detail page's HTML into the provider raw payload. */
export function parseApartmentsComDetail(html: string, ref: ExternalListingRef): ApartmentsComRaw {
  const listing = pickPrimaryListing(extractSchemaOrgListings(html));
  if (!listing) {
    throw new Error(`apartments_com: no schema.org listing found at ${ref.url}`);
  }
  return { sourceId: ref.sourceId, url: ref.url, listing };
}

/** Parse `"$1,650 - $3,200"` → 1650 (the low bound is the listing's "from"). */
function parsePriceRangeLow(range: string | undefined): number | undefined {
  if (!range) return undefined;
  const match = range.match(/[\d,.]+/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[0].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

function buildAddress(listing: SchemaOrgListing): NormalizedListingAddress {
  const address: NormalizedListingAddress = {
    street: listing.address.street ?? listing.address.locality ?? '',
    city: listing.address.locality ?? '',
    state: listing.address.region,
    country:
      listing.address.country && listing.address.country !== 'US' ? listing.address.country : COUNTRY,
    countryCode: 'US',
    postalCode: listing.address.postalCode,
  };
  if (listing.coordinates) {
    address.coordinates = listing.coordinates;
  }
  return address;
}

function asApartmentsCom(payload: unknown): ApartmentsComRaw {
  const record = payload as { sourceId?: unknown; url?: unknown; listing?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.listing !== 'object' ||
    record.listing === null
  ) {
    throw new Error('apartments_com provider received a payload that is not an ApartmentsComRaw');
  }
  return payload as ApartmentsComRaw;
}

export interface ApartmentsComProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
  ladderTiers?: readonly StrategyName[];
}

export class ApartmentsComProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['US'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly ladderTiers?: readonly StrategyName[];

  constructor(options: ApartmentsComProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.metrics = options.metrics ?? defaultProviderMetrics;
    this.ladderTiers = options.ladderTiers;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : DEFAULT_CITIES;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      if (yielded >= limit) return;
      const { html } = await fetchListingViaLadder(this.runtime, searchUrl(city), {
        provider: this.id,
        isChallenge: isUsPortalChallenge,
        metrics: this.metrics,
        init: { signal: job.signal },
        tiers: this.ladderTiers,
      });
      for (const ref of parseApartmentsComSearch(html)) {
        if (yielded >= limit) return;
        if (seen.has(ref.sourceId)) continue;
        seen.add(ref.sourceId);
        yield { provider: this.id, sourceId: ref.sourceId, url: ref.url };
        yielded += 1;
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isUsPortalChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
      tiers: this.ladderTiers,
    });
    return { ref, payload: parseApartmentsComDetail(html, ref) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, listing } = asApartmentsCom(raw.payload);
    const monthlyAmount = listing.price ?? parsePriceRangeLow(listing.priceRange);
    if (monthlyAmount === undefined) {
      throw new Error(`apartments_com: listing ${sourceId} has no resolvable price`);
    }

    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: buildAddress(listing),
      type: PropertyType.APARTMENT,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount, currency: listing.priceCurrency ?? CURRENCY },
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    const description = listing.description ?? listing.name;
    if (description !== undefined) result.description = description;
    if (listing.bedrooms !== undefined) result.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) result.bathrooms = listing.bathrooms;
    if (listing.squareFootage !== undefined) result.squareFootage = listing.squareFootage;

    return result;
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ${this.markets.join(', ')} via ${BASE_URL}`,
    };
  }
}
