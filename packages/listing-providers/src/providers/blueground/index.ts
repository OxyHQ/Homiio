/**
 * Blueground provider (global furnished rentals — ES/US/IT/GB/DE/FR).
 *
 * Blueground retired the unauthenticated `/api/v2/properties` JSON API (404).
 * This provider now scrapes SSR city search pages and property detail pages
 * through the shared anti-bot {@link fetchListingViaLadder} (HTTP → browser →
 * managed). `discover()` pages per-city search results into
 * {@link ExternalListingRef}s; `fetch()` pulls a detail page's HTML; `normalize()`
 * maps the parsed payload onto a first-party furnished monthly rental.
 */

import {
  OfferingType,
  PropertyType,
  type ListingMarket,
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
import { validateMonthlyRentAmount } from '../../parse/price';
import {
  BLUEGROUND_BASE_URL,
  type BluegroundRawListing,
  type BluegroundRawPhoto,
} from './fixtures';
import {
  BluegroundPartnerListingError,
  bluegroundCitySearchUrl,
  isBluegroundPartnerListing,
  parseBluegroundDetail,
  parseBluegroundSearch,
} from './parse';

export {
  BluegroundPartnerListingError,
  isBluegroundPartnerListing,
  readBluegroundLowestRent,
  readBluegroundPartnerSignals,
} from './parse';

const PROVIDER_ID: ProviderId = 'blueground';

/** City slugs for `/m/furnished-apartments/<slug>` search pages. */
const DEFAULT_CITIES: Readonly<Partial<Record<ListingMarket, readonly string[]>>> = {
  ES: ['madrid-esp', 'barcelona-esp', 'valencia-esp', 'sevilla-esp'],
  US: ['nyc-usa', 'los-angeles-usa', 'boston-usa', 'chicago-usa', 'washington-dc-usa', 'miami-usa', 'san-francisco-usa'],
  IT: ['rome-ita', 'milan-ita'],
  GB: ['london-gbr'],
  DE: ['berlin-deu'],
  FR: ['paris-fra'],
};

const SUPPORTED_TYPES: ReadonlySet<string> = new Set(Object.values(PropertyType));

/** HTML markers of a Blueground challenge/empty shell (common on bot-blocked US pages). */
export function isBluegroundChallenge(html: string): boolean {
  if (html.trim().length < 1024) return true;
  return /access denied|cf-browser-verification|datadome/i.test(html);
}

function resolvePropertyType(raw: string | undefined): PropertyType {
  return raw && SUPPORTED_TYPES.has(raw) ? (raw as PropertyType) : PropertyType.APARTMENT;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Validate a parsed payload into a {@link BluegroundRawListing}, throwing when a
 * required field is missing.
 */
export function coerceBluegroundListing(payload: unknown): BluegroundRawListing {
  const record = asRecord(payload);
  const monthlyRent = asRecord(record?.['monthlyRent']);
  const address = asRecord(record?.['address']);
  const amount = monthlyRent?.['amount'];
  const city = address?.['city'];
  if (
    !record ||
    typeof record['id'] !== 'string' ||
    typeof record['url'] !== 'string' ||
    typeof amount !== 'number' ||
    typeof city !== 'string' ||
    city.length === 0
  ) {
    throw new Error('blueground provider received a payload that is not a BluegroundRawListing');
  }
  return payload as BluegroundRawListing;
}

function toRemoteImages(photos: readonly BluegroundRawPhoto[]): NormalizedRemoteImage[] {
  return photos.map((photo, index) => ({
    url: photo.url,
    caption: photo.caption,
    isPrimary: photo.isCover ?? index === 0,
  }));
}

export interface BluegroundProviderOptions {
  runtime?: FetchRuntime;
  metrics?: ProviderMetricsSink & ProviderMetricsReader;
}

export class BluegroundProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES', 'US', 'IT', 'GB', 'DE', 'FR'] as const;

  private readonly runtime: FetchRuntime;
  private readonly metrics: ProviderMetricsSink & ProviderMetricsReader;

  constructor(options: BluegroundProviderOptions = {}) {
    this.runtime = options.runtime ?? createFetchRuntime();
    this.metrics = options.metrics ?? defaultProviderMetrics;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const cities = job.city
      ? [job.city]
      : (DEFAULT_CITIES[job.market] ?? DEFAULT_CITIES.ES ?? ['madrid-esp']);
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      if (yielded >= limit) return;
      const { html } = await fetchListingViaLadder(job.runtime ?? this.runtime, bluegroundCitySearchUrl(city), {
        provider: this.id,
        isChallenge: isBluegroundChallenge,
        metrics: this.metrics,
        init: { signal: job.signal },
      });
      for (const ref of parseBluegroundSearch(html)) {
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
      isChallenge: isBluegroundChallenge,
      init: { signal: ctx.signal },
      metrics: this.metrics,
    });
    return { ref, payload: parseBluegroundDetail(html, ref) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = coerceBluegroundListing(raw.payload);
    if (
      isBluegroundPartnerListing({
        businessModel: listing.businessModel,
        partnerSlug: listing.partnerSlug,
      })
    ) {
      throw new BluegroundPartnerListingError(
        listing.id,
        `unreliable lowestRent for ${listing.partnerSlug ?? listing.businessModel ?? 'partner'} (dates required for price)`,
      );
    }

    const priceError = validateMonthlyRentAmount(
      listing.monthlyRent.amount,
      listing.monthlyRent.currency,
      { bedrooms: listing.bedrooms },
    );
    if (priceError) {
      throw new Error(`blueground: rejecting listing ${listing.id}: ${priceError}`);
    }

    return {
      source: this.id,
      sourceId: listing.id,
      sourceUrl: listing.url,
      address: {
        street: listing.address.line1 ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: listing.address.country,
        countryCode: listing.address.countryCode,
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
        coordinates:
          listing.address.latitude !== undefined && listing.address.longitude !== undefined
            ? { lat: listing.address.latitude, lng: listing.address.longitude }
            : undefined,
      },
      type: resolvePropertyType(listing.propertyType),
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: {
        monthlyAmount: listing.monthlyRent.amount,
        currency: listing.monthlyRent.currency,
      },
      description: listing.description,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      squareFootage: listing.sizeSqm,
      floor: listing.floor,
      amenities: listing.amenities,
      furnishedStatus: listing.furnished ? 'furnished' : 'not_specified',
      remoteImages: toRemoteImages(listing.photos),
      status: 'published',
    };
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
      detail: `Serving ${this.markets.join(', ')} via ${BLUEGROUND_BASE_URL} (HTML ladder)`,
    };
  }
}
