/**
 * Fixture provider (Phase 0).
 *
 * A fully in-process provider backed by the bundled {@link FIXTURE_LISTINGS}
 * dataset. It implements the real {@link ListingProvider} contract end to end —
 * discover yields refs, fetch returns the raw payload, normalize maps it to a
 * {@link NormalizedListing} — so the ingest path can be exercised and tested
 * without touching any external portal. Real portal plugins (Idealista,
 * Fotocasa, …) land in later phases behind the SAME contract.
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
import { FIXTURE_LISTINGS, type FixtureRawListing } from './fixtures';

const PROVIDER_ID: ProviderId = 'fixture';

/** The `PropertyType` values the fixture data may declare. */
const SUPPORTED_TYPES: ReadonlySet<string> = new Set(Object.values(PropertyType));

/** Map a fixture's declared type onto a `PropertyType`, defaulting to apartment. */
function resolvePropertyType(raw: string): PropertyType {
  return SUPPORTED_TYPES.has(raw) ? (raw as PropertyType) : PropertyType.APARTMENT;
}

/** Map a fixture's furnished flag onto the property `furnishedStatus`. */
function resolveFurnished(furnished: boolean | undefined): NormalizedListing['furnishedStatus'] {
  if (furnished === true) return 'furnished';
  if (furnished === false) return 'unfurnished';
  return 'not_specified';
}

function toRemoteImages(raw: FixtureRawListing): NormalizedRemoteImage[] {
  return raw.images.map((image, index) => ({
    url: image.url,
    caption: image.caption,
    isPrimary: image.isPrimary ?? index === 0,
  }));
}

/** Narrow an opaque `RawListing.payload` back to a {@link FixtureRawListing}. */
function asFixture(payload: unknown): FixtureRawListing {
  if (!payload || typeof payload !== 'object' || typeof (payload as { id?: unknown }).id !== 'string') {
    throw new Error('fixture provider received a payload that is not a FixtureRawListing');
  }
  return payload as FixtureRawListing;
}

export class FixtureProvider implements ListingProvider {
  readonly id: ProviderId = PROVIDER_ID;
  readonly markets = ['ES'] as const;

  private readonly listings: readonly FixtureRawListing[];

  constructor(listings: readonly FixtureRawListing[] = FIXTURE_LISTINGS) {
    this.listings = listings;
  }

  async *discover(job: DiscoverJob): AsyncIterable<ExternalListingRef> {
    const limit = job.limit ?? this.listings.length;
    let yielded = 0;
    for (const listing of this.listings) {
      if (yielded >= limit) break;
      yield {
        provider: this.id,
        sourceId: listing.id,
        url: listing.url,
      };
      yielded += 1;
    }
  }

  async fetch(ref: ExternalListingRef, _ctx: FetchContext): Promise<RawListing> {
    const listing = this.listings.find((item) => item.id === ref.sourceId);
    if (!listing) {
      throw new Error(`fixture provider has no listing for sourceId "${ref.sourceId}"`);
    }
    return { ref, payload: listing };
  }

  normalize(raw: RawListing): NormalizedListing {
    const listing = asFixture(raw.payload);
    return {
      source: this.id,
      sourceId: listing.id,
      sourceUrl: listing.url,
      address: {
        street: listing.address.street,
        city: listing.address.city,
        state: listing.address.state,
        country: listing.address.country,
        countryCode: listing.address.countryCode,
        postalCode: listing.address.postalCode,
        neighborhood: listing.address.neighborhood,
        coordinates: { lat: listing.address.lat, lng: listing.address.lng },
      },
      type: resolvePropertyType(listing.propertyType),
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: {
        monthlyAmount: listing.monthlyRent,
        currency: listing.currency,
      },
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
      status: this.listings.length > 0 ? 'healthy' : 'degraded',
      detail: `${this.listings.length} fixture listing(s) available`,
    };
  }
}
