/**
 * Recorded fixtures for the `blueground` provider.
 *
 * Blueground (theblueground.com) lets furnished, move-in-ready apartments by
 * the month across the US and parts of Europe (incl. Spain). Its site is a
 * structured web app backed by a JSON API, so — unlike the HTML ES portals —
 * this provider consumes JSON directly and needs no HTML parsing. These
 * HAND-AUTHORED, API-SHAPED fixtures (NOT real listings) exercise the
 * `normalize()` map for both a EUR (Madrid) and a USD (New York) property so CI
 * never hits the live API. `photos[].url` point at an example CDN host; the
 * ingest pipeline fetches those bytes ONCE and re-hosts them (Sharp/S3) — they
 * are never used as runtime image URLs.
 */

/** A raw Blueground photo (API-shaped, pre-normalization). */
export interface BluegroundRawPhoto {
  url: string;
  caption?: string;
  isCover?: boolean;
}

/** A raw Blueground property payload as returned by the JSON API. */
export interface BluegroundRawListing {
  id: string;
  slug: string;
  url: string;
  title?: string;
  description?: string;
  /** Blueground property category (`apartment`, `studio`, `house`, …). */
  propertyType?: string;
  monthlyRent: {
    amount: number;
    currency: string;
  };
  bedrooms?: number;
  bathrooms?: number;
  sizeSqm?: number;
  floor?: number;
  /** Blueground inventory is furnished; kept explicit for the normalizer. */
  furnished: boolean;
  amenities?: string[];
  address: {
    line1?: string;
    neighborhood?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
  };
  photos: BluegroundRawPhoto[];
}

/** The JSON shape returned by the Blueground property-search endpoint. */
export interface BluegroundSearchResponse {
  properties: Array<Pick<BluegroundRawListing, 'id' | 'slug' | 'url'>>;
}

/** The base host used to build absolute Blueground API/detail URLs. */
export const BLUEGROUND_BASE_URL = 'https://www.theblueground.com';

/** Recorded raw payloads: one Madrid (EUR) unit and one New York (USD) unit. */
export const BLUEGROUND_FIXTURES: readonly BluegroundRawListing[] = [
  {
    id: 'bg-mad-4471',
    slug: 'madrid-salamanca-2br-4471',
    url: 'https://www.theblueground.com/furnished-apartments-madrid-spain/madrid-salamanca-2br-4471',
    title: 'Furnished 2-bedroom apartment in Salamanca, Madrid',
    description:
      'Turnkey furnished two-bedroom apartment in the Salamanca district, steps from Retiro Park, with A/C, high-speed wifi and a fully equipped kitchen.',
    propertyType: 'apartment',
    monthlyRent: { amount: 2650, currency: 'EUR' },
    bedrooms: 2,
    bathrooms: 2,
    sizeSqm: 88,
    floor: 4,
    furnished: true,
    amenities: ['air_conditioning', 'wifi', 'elevator', 'washer', 'heating'],
    address: {
      line1: 'Calle de Velázquez 50',
      neighborhood: 'Salamanca',
      city: 'Madrid',
      region: 'Community of Madrid',
      postalCode: '28001',
      country: 'Spain',
      countryCode: 'ES',
      latitude: 40.4256,
      longitude: -3.6845,
    },
    photos: [
      {
        url: 'https://static.theblueground.com/units/bg-mad-4471/living-room.jpg',
        caption: 'Living room',
        isCover: true,
      },
      {
        url: 'https://static.theblueground.com/units/bg-mad-4471/bedroom.jpg',
        caption: 'Primary bedroom',
      },
    ],
  },
  {
    id: 'bg-nyc-9182',
    slug: 'new-york-midtown-1br-9182',
    url: 'https://www.theblueground.com/furnished-apartments-new-york-ny/new-york-midtown-1br-9182',
    title: 'Furnished 1-bedroom apartment in Midtown, New York',
    description:
      'Move-in-ready one-bedroom in Midtown Manhattan with a doorman, in-unit laundry and skyline views.',
    propertyType: 'apartment',
    monthlyRent: { amount: 4200, currency: 'USD' },
    bedrooms: 1,
    bathrooms: 1,
    sizeSqm: 65,
    floor: 18,
    furnished: true,
    amenities: ['air_conditioning', 'wifi', 'doorman', 'washer', 'gym'],
    address: {
      line1: '350 W 42nd St',
      neighborhood: 'Midtown',
      city: 'New York',
      region: 'New York',
      postalCode: '10036',
      country: 'United States',
      countryCode: 'US',
      latitude: 40.7579,
      longitude: -73.9911,
    },
    photos: [
      {
        url: 'https://static.theblueground.com/units/bg-nyc-9182/living-room.jpg',
        caption: 'Living room',
        isCover: true,
      },
    ],
  },
];
