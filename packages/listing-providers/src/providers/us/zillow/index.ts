/**
 * Zillow provider (United States).
 *
 * Zillow has no ingestion-grade public API and fronts pages with a PerimeterX
 * anti-bot wall, so this plugin scrapes seriously through the shared
 * {@link FetchRuntime} — it NEVER re-implements anti-bot infrastructure.
 * Acquisition/escalation (HTTP → headless browser → managed proxy) is owned by
 * the runtime's shared {@link StrategyLadder}; for Zillow especially the
 * browser/managed rungs carry the load, but the provider stays oblivious and
 * simply asks the runtime for bytes. `discover()` pages city rental search
 * results into {@link ExternalListingRef}s (stamping the buy/rent intent on
 * `hints.kind`); `fetch()` pulls a home-details page's HTML; the shared
 * {@link extractSchemaOrgListings} parser lifts the embedded schema.org
 * JSON-LD; `normalize()` maps it onto a first-party USD listing (long-term rent
 * or sale). Registered OFF by default (`PROVIDER_ZILLOW_ENABLED`).
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

const PROVIDER_ID: ProviderId = 'zillow';
const BASE_URL = 'https://www.zillow.com';
const CURRENCY = 'USD';
const COUNTRY = 'United States';

/** The buy/rent intent a Zillow listing was discovered under. */
export type ZillowKind = 'rent' | 'sale';

/** US cities enumerated when a discover job omits an explicit `city`. */
const DEFAULT_CITIES: readonly string[] = [
  'New York, NY',
  'Los Angeles, CA',
  'Chicago, IL',
  'Austin, TX',
  'Miami, FL',
];

/** Zillow home-details URLs end in `/<zpid>_zpid/`; the zpid is the source id. */
const DETAIL_URL_RE = /https?:\/\/www\.zillow\.com\/homedetails\/[^"'\s]+?\/(\d+)_zpid\/?/gi;

/** The raw payload Zillow `fetch()` hands to `normalize()`. */
export interface ZillowRaw {
  sourceId: string;
  url: string;
  kind: ZillowKind;
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
  return `${BASE_URL}/homes/for_rent/${slugifyCity(city)}/`;
}

/** Read the intent a ref was discovered under; defaults to long-term rent. */
function refKind(ref: ExternalListingRef): ZillowKind {
  return ref.hints?.kind === 'sale' ? 'sale' : 'rent';
}

/** Extract home-details refs from a search page's HTML, tagged with `kind`. */
export function parseZillowSearch(html: string, kind: ZillowKind = 'rent'): ExternalListingRef[] {
  const byId = new Map<string, ExternalListingRef>();
  for (const match of html.matchAll(DETAIL_URL_RE)) {
    const sourceId = match[1];
    if (!sourceId || byId.has(sourceId)) continue;
    byId.set(sourceId, {
      provider: PROVIDER_ID,
      sourceId,
      url: match[0].replace(/\/?$/, '/'),
      hints: { kind },
    });
  }
  return [...byId.values()];
}

/** Parse a home-details page's HTML into the provider raw payload. */
export function parseZillowDetail(html: string, ref: ExternalListingRef): ZillowRaw {
  const listing = pickPrimaryListing(extractSchemaOrgListings(html));
  if (!listing) {
    throw new Error(`zillow: no schema.org listing found at ${ref.url}`);
  }
  return { sourceId: ref.sourceId, url: ref.url, kind: refKind(ref), listing };
}

/** Map schema.org node types to a Homiio `PropertyType`. */
function resolvePropertyType(types: readonly string[]): PropertyType {
  const lower = types.map((type) => type.toLowerCase());
  if (lower.some((type) => type.includes('apartment'))) return PropertyType.APARTMENT;
  if (lower.some((type) => type === 'studio')) return PropertyType.STUDIO;
  if (
    lower.some(
      (type) =>
        type.includes('house') ||
        type.includes('residence') ||
        type.includes('townhouse') ||
        type.includes('dwelling'),
    )
  ) {
    return PropertyType.HOUSE;
  }
  return PropertyType.APARTMENT;
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

function asZillow(payload: unknown): ZillowRaw {
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
    throw new Error('zillow provider received a payload that is not a ZillowRaw');
  }
  return payload as ZillowRaw;
}

export interface ZillowProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
  /** Test-only: restrict which ladder tiers run (default http → browser → managed). */
  ladderTiers?: readonly StrategyName[];
}

export class ZillowProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['US'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;
  private readonly ladderTiers?: readonly StrategyName[];

  constructor(options: ZillowProviderOptions = {}) {
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
      for (const ref of parseZillowSearch(html, 'rent')) {
        if (yielded >= limit) return;
        if (seen.has(ref.sourceId)) continue;
        seen.add(ref.sourceId);
        yield ref;
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
    return { ref, payload: parseZillowDetail(html, ref) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const { sourceId, url, kind, listing } = asZillow(raw.payload);
    if (listing.price === undefined) {
      throw new Error(`zillow: listing ${sourceId} has no resolvable price`);
    }
    const currency = listing.priceCurrency ?? CURRENCY;

    const result: NormalizedListing = {
      source: this.id,
      sourceId,
      sourceUrl: url,
      address: buildAddress(listing),
      type: resolvePropertyType(listing.types),
      offerings: kind === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (kind === 'sale') {
      result.sale = { price: listing.price, currency };
    } else {
      result.longTermRent = { monthlyAmount: listing.price, currency };
    }

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
