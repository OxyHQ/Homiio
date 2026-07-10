/**
 * Habitaclia provider (Spain).
 *
 * Habitaclia (habitaclia.com) is a large ES rental/sale portal with no public
 * API, so this plugin scrapes seriously through the shared {@link FetchRuntime}
 * strategy ladder (HTTP → Playwright → managed) — it NEVER re-implements
 * anti-bot infrastructure. `discover()` pages ES city search results into
 * {@link ExternalListingRef}s; `fetch()` pulls a detail page's HTML; the pure
 * parser in `./parse` extracts the embedded schema.org JSON-LD into a
 * {@link HabitacliaRawListing}; `normalize()` maps that onto a first-party
 * {@link NormalizedListing}. It sits behind the SAME contract as every other
 * provider and is registered OFF by default (`PROVIDER_HABITACLIA_ENABLED`).
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
  ListingProvider,
  ProviderHealth,
  RawListing,
} from '../../types';
import { HABITACLIA_BASE_URL, type HabitacliaRawListing } from './fixtures';
import { habitacliaSourceIdFromUrl, parseHabitacliaDetail, parseHabitacliaSearch } from './parse';

const PROVIDER_ID: ProviderId = 'habitaclia';

/** ES cities enumerated when a discover job omits an explicit `city`. */
const DEFAULT_CITIES: readonly string[] = ['barcelona', 'madrid', 'valencia', 'sevilla', 'malaga'];

/** Max search pages to page through per city in a single discover pass. */
const MAX_SEARCH_PAGES = 5;

const SUPPORTED_TYPES: ReadonlySet<string> = new Set(Object.values(PropertyType));

function resolvePropertyType(raw: string): PropertyType {
  return SUPPORTED_TYPES.has(raw) ? (raw as PropertyType) : PropertyType.APARTMENT;
}

function resolveFurnished(furnished: boolean | undefined): NormalizedListing['furnishedStatus'] {
  if (furnished === true) return 'furnished';
  if (furnished === false) return 'unfurnished';
  return 'not_specified';
}

/** Slugify a city name for the search URL path. */
function citySlug(city: string): string {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Build a Habitaclia rental search URL for a city + 1-based page number. */
function searchUrl(city: string, page: number): string {
  const slug = citySlug(city);
  return page <= 1
    ? `${HABITACLIA_BASE_URL}/alquiler-${slug}.htm`
    : `${HABITACLIA_BASE_URL}/alquiler-${slug}-${page}.htm`;
}

/** Narrow an opaque `RawListing.payload` back to a {@link HabitacliaRawListing}. */
function asHabitaclia(payload: unknown): HabitacliaRawListing {
  const record = payload as { id?: unknown; url?: unknown } | null;
  if (!record || typeof record.id !== 'string' || typeof record.url !== 'string') {
    throw new Error('habitaclia provider received a payload that is not a HabitacliaRawListing');
  }
  return payload as HabitacliaRawListing;
}

function toRemoteImages(raw: HabitacliaRawListing): NormalizedRemoteImage[] {
  return raw.images.map((image, index) => ({
    url: image.url,
    caption: image.caption,
    isPrimary: image.isPrimary ?? index === 0,
  }));
}

export class HabitacliaProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const { runtime } = job;
    if (!runtime) {
      throw new Error('habitaclia discover requires a FetchRuntime on the job');
    }
    const cities = job.city ? [job.city] : DEFAULT_CITIES;
    const limit = job.limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    let yielded = 0;

    for (const city of cities) {
      for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
        if (yielded >= limit) return;
        const html = await runtime.fetchText(searchUrl(city, page), { signal: job.signal });
        const refs = parseHabitacliaSearch(html);
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
    const html = await ctx.runtime.fetchText(ref.url, { signal: ctx.signal });
    const payload = parseHabitacliaDetail(html, ref.url);
    return { ref, payload };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asHabitaclia(raw.payload);
    const offerings =
      listing.operation === 'sale' ? [OfferingType.SALE] : [OfferingType.LONG_TERM_RENT];

    return {
      source: this.id,
      sourceId: listing.id,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street ?? listing.address.city,
        city: listing.address.city,
        state: listing.address.region,
        country: listing.address.country,
        countryCode: listing.address.countryCode ?? 'ES',
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
        coordinates:
          listing.address.lat !== undefined && listing.address.lng !== undefined
            ? { lat: listing.address.lat, lng: listing.address.lng }
            : undefined,
      },
      type: resolvePropertyType(listing.propertyType),
      offerings,
      longTermRent:
        listing.operation === 'sale'
          ? undefined
          : { monthlyAmount: listing.price, currency: listing.currency },
      sale:
        listing.operation === 'sale'
          ? { price: listing.price, currency: listing.currency }
          : undefined,
      description: listing.description,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      squareFootage: listing.squareMeters,
      floor: listing.floor,
      amenities: listing.amenities,
      furnishedStatus: resolveFurnished(listing.furnished),
      remoteImages: toRemoteImages(listing),
      status: 'published',
    };
  }

  async health(): Promise<ProviderHealth> {
    return {
      provider: this.id,
      status: 'healthy',
      detail: `Serving ${this.markets.join(', ')} via ${HABITACLIA_BASE_URL}`,
    };
  }
}

export { habitacliaSourceIdFromUrl };
