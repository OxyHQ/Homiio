/**
 * Kleinanzeigen provider (Germany) — immobilien section ONLY.
 *
 * General classifieds portal: `discover()` only hits housing category URLs
 * (Wohnung/Haus mieten/kaufen, WG-Zimmer). `normalize()` rejects any ad whose
 * category id is outside the housing allowlist. Prefer JSON when a session
 * unlocks it; otherwise parse housing HTML (og: + attributes) via the shared
 * ladder. Contact (tel / WhatsApp / email) is best-effort from the detail page.
 *
 * Registered OFF by default (`PROVIDER_KLEINANZEIGEN_ENABLED`).
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
import { NonHousingListingError } from '../../../classifieds';
import { createFetchRuntime } from '../../../runtime';
import { ChallengeError, fetchListingViaLadder } from '../../../strategy';
import { defaultProviderMetrics, type ProviderMetricsReader, type ProviderMetricsSink } from '../../../metrics';
import { KLEINANZEIGEN_BASE_URL } from './fixtures';
import {
  isKleinanzeigenChallenge,
  isKleinanzeigenHousingCategory,
  kleinanzeigenHousingSearchUrl,
  kleinanzeigenSourceIdFromUrl,
  parseKleinanzeigenDetail,
  parseKleinanzeigenSearch,
  type KleinanzeigenRawListing,
} from './parse';

const PROVIDER_ID: ProviderId = 'kleinanzeigen';

const DEFAULT_CITIES: readonly string[] = [
  'berlin',
  'hamburg',
  'muenchen',
  'koeln',
  'frankfurt',
  'stuttgart',
];

const MAX_SEARCH_PAGES = 3;

/** Housing categories enumerated per city (rent-first). */
const DISCOVER_CATEGORIES: readonly string[] = ['203', '205'];

export interface KleinanzeigenProviderOptions {
  runtime?: FetchRuntime;
  cities?: readonly string[];
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

function asKleinanzeigenRaw(payload: unknown): KleinanzeigenRawListing {
  const record = payload as { sourceId?: unknown; url?: unknown; categoryId?: unknown } | null;
  if (
    !record ||
    typeof record.sourceId !== 'string' ||
    typeof record.url !== 'string' ||
    typeof record.categoryId !== 'string'
  ) {
    throw new Error('kleinanzeigen: normalize received a payload that is not a KleinanzeigenRawListing');
  }
  return payload as KleinanzeigenRawListing;
}

function toRemoteImages(urls: readonly string[]): NormalizedRemoteImage[] {
  return urls.map((url, index) => ({ url, isPrimary: index === 0 }));
}

export class KleinanzeigenProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['DE'] as const;

  private readonly runtime: FetchRuntime;
  private readonly cities: readonly string[];
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: KleinanzeigenProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.cities = options.cities && options.cities.length > 0 ? options.cities : DEFAULT_CITIES;
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city ? [job.city] : this.cities;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;
    const runtime = job.runtime ?? this.runtime;

    for (const city of cities) {
      for (const categoryId of DISCOVER_CATEGORIES) {
        for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
          if (yielded >= limit) return;
          const searchUrl = kleinanzeigenHousingSearchUrl(city, page, categoryId);
          try {
            const { html } = await fetchListingViaLadder(runtime, searchUrl, {
              provider: this.id,
              isChallenge: isKleinanzeigenChallenge,
              metrics: this.metrics,
              init: { signal: job.signal },
            });
            const refs = parseKleinanzeigenSearch(html);
            if (refs.length === 0) break;
            for (const ref of refs) {
              if (yielded >= limit) return;
              if (seen.has(ref.sourceId)) continue;
              if (!isKleinanzeigenHousingCategory(ref.categoryId)) continue;
              seen.add(ref.sourceId);
              yield {
                provider: this.id,
                sourceId: ref.sourceId,
                url: ref.url,
                hints: { categoryId: ref.categoryId },
              };
              yielded += 1;
            }
          } catch (error) {
            if (error instanceof ChallengeError) return;
            throw error;
          }
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const { html } = await fetchListingViaLadder(ctx.runtime, ref.url, {
      provider: this.id,
      isChallenge: isKleinanzeigenChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    const payload = parseKleinanzeigenDetail(html, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asKleinanzeigenRaw(raw.payload);
    if (!isKleinanzeigenHousingCategory(listing.categoryId)) {
      throw new NonHousingListingError(
        this.id,
        listing.sourceId,
        `category ${listing.categoryId} is not housing`,
      );
    }
    if (listing.price === undefined) {
      throw new Error(`kleinanzeigen: listing ${listing.sourceId} has no resolvable price`);
    }
    const city = listing.address.city || listing.address.region || listing.address.neighborhood || '';
    const street = listing.address.street || city;
    if (!city || !street) {
      throw new Error(`kleinanzeigen: listing ${listing.sourceId} missing address city/street`);
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
        neighborhood: listing.address.neighborhood,
        coordinates:
          listing.address.lat !== undefined && listing.address.lng !== undefined
            ? { lat: listing.address.lat, lng: listing.address.lng }
            : undefined,
      },
      type: listing.categoryId === '205' || listing.categoryId === '207' ? PropertyType.HOUSE : PropertyType.APARTMENT,
      offerings: isSale ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT],
      longTermRent: isSale ? undefined : { monthlyAmount: listing.price, currency: listing.currency },
      sale: isSale ? { price: listing.price, currency: listing.currency } : undefined,
      remoteImages: toRemoteImages(listing.images),
      status: 'published',
    };

    if (listing.description ?? listing.title) {
      result.description = listing.description ?? listing.title;
    }
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
      detail: `Serving DE housing-only via ${KLEINANZEIGEN_BASE_URL} (categories ${[...DISCOVER_CATEGORIES].join(',')})`,
    };
  }
}

export {
  kleinanzeigenSourceIdFromUrl,
  kleinanzeigenHousingSearchUrl,
  parseKleinanzeigenSearch,
  parseKleinanzeigenDetail,
  isKleinanzeigenHousingCategory,
};
