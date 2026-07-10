/**
 * Blueground provider (Spain + United States).
 *
 * Blueground rents furnished, move-in-ready apartments by the month; its site
 * is backed by a structured JSON API, so this provider consumes JSON directly
 * through the shared {@link FetchRuntime} (still on the same rate-limit / retry
 * / escalation ladder — it never re-implements that infra) and needs no HTML
 * parsing. `discover()` pages the per-city search endpoint into
 * {@link ExternalListingRef}s; `fetch()` pulls one property's JSON; and
 * `normalize()` maps it onto a first-party {@link NormalizedListing} (always a
 * furnished monthly rental). Registered OFF by default
 * (`PROVIDER_BLUEGROUND_ENABLED`); `markets` reflect Blueground's ES + US
 * footprint.
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
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../types';
import {
  BLUEGROUND_BASE_URL,
  type BluegroundRawListing,
  type BluegroundRawPhoto,
  type BluegroundSearchResponse,
} from './fixtures';

const PROVIDER_ID: ProviderId = 'blueground';

/** Cities enumerated per market when a discover job omits an explicit `city`. */
const DEFAULT_CITIES: Readonly<Record<ListingMarket, readonly string[]>> = {
  ES: ['madrid', 'barcelona'],
  US: ['new-york', 'los-angeles', 'boston', 'chicago', 'washington-dc'],
};

/** Max search pages to page through per city in a single discover pass. */
const MAX_SEARCH_PAGES = 10;

const SUPPORTED_TYPES: ReadonlySet<string> = new Set(Object.values(PropertyType));

function resolvePropertyType(raw: string | undefined): PropertyType {
  return raw && SUPPORTED_TYPES.has(raw) ? (raw as PropertyType) : PropertyType.APARTMENT;
}

/** Build the per-city search endpoint URL for a 1-based page number. */
function searchUrl(city: string, page: number): string {
  return `${BLUEGROUND_BASE_URL}/api/v2/properties?city=${encodeURIComponent(city)}&page=${page}`;
}

/** Build the JSON detail endpoint URL for a property id. */
function detailUrl(sourceId: string): string {
  return `${BLUEGROUND_BASE_URL}/api/v2/properties/${encodeURIComponent(sourceId)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Validate a JSON payload into a {@link BluegroundRawListing}, throwing when a
 * required field is missing (a delisted unit or a challenge response yields a
 * shape without `id` / `monthlyRent` / `address.city`).
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
    typeof city !== 'string'
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

export class BluegroundProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES', 'US'] as const;

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const { runtime } = job;
    if (!runtime) {
      throw new Error('blueground discover requires a FetchRuntime on the job');
    }
    const cities = job.city ? [job.city] : DEFAULT_CITIES[job.market];
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded >= limit) return;
        const response = await runtime.fetchJson<BluegroundSearchResponse>(searchUrl(city, page), {
          signal: job.signal,
        });
        const properties = response?.properties ?? [];
        if (properties.length === 0) break;
        for (const property of properties) {
          if (yielded >= limit) return;
          if (!property?.id || seen.has(property.id)) continue;
          seen.add(property.id);
          yield {
            provider: this.id,
            sourceId: property.id,
            url: property.url ?? detailUrl(property.id),
          };
          yielded += 1;
        }
      }
    }
  }

  async fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing> {
    const json = await ctx.runtime.fetchJson<unknown>(detailUrl(ref.sourceId), { signal: ctx.signal });
    return { ref, payload: coerceBluegroundListing(json) };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = coerceBluegroundListing(raw.payload);
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
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ${this.markets.join(', ')} via ${BLUEGROUND_BASE_URL}`,
    };
  }
}
