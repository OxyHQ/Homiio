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
  /** Present on partner-network inventory; never treat as firm monthly rent. */
  businessModel?: string;
  partnerSlug?: string;
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

/** The base host used to build absolute Blueground detail URLs. */
export const BLUEGROUND_BASE_URL = 'https://www.theblueground.com';

/** Recorded raw payloads: one Madrid (EUR) unit and one New York (USD) unit. */
export const BLUEGROUND_FIXTURES: readonly BluegroundRawListing[] = [
  {
    id: 'mad-1490341p',
    slug: 'mad-1490341p',
    url: 'https://www.theblueground.com/p/furnished-apartments/mad-1490341p',
    title: 'Furnished 2-bedroom apartment in Salamanca, Madrid',
    description:
      'Turnkey furnished two-bedroom apartment in the Salamanca district, steps from Retiro Park, with A/C, high-speed wifi and a fully equipped kitchen.',
    propertyType: 'apartment',
    monthlyRent: { amount: 3473, currency: 'EUR' },
    bedrooms: 1,
    bathrooms: 1,
    furnished: true,
    amenities: ['air_conditioning', 'wifi', 'elevator', 'washer', 'heating'],
    address: {
      line1: 'Calle de San Bartolomé',
      neighborhood: 'Chueca Justicia',
      city: 'Madrid',
      region: 'Community of Madrid',
      country: 'Spain',
      countryCode: 'ES',
    },
    photos: [
      {
        url: 'https://photos2.theblueground.com/736/partner-network/flat-sweet-home/de-live/flat-sweet-home/full/9f7a6a9e83c151fa.jpg',
        caption: 'Living room',
        isCover: true,
      },
      {
        url: 'https://photos2.theblueground.com/736/partner-network/flat-sweet-home/de-live/flat-sweet-home/full/ba1d419ad8356312.jpg',
        caption: 'Primary bedroom',
      },
    ],
  },
  {
    id: 'nyc-1234567p',
    slug: 'nyc-1234567p',
    url: 'https://www.theblueground.com/p/furnished-apartments/nyc-1234567p',
    title: 'Furnished 1-bedroom apartment in Midtown, New York',
    description:
      'Move-in-ready one-bedroom in Midtown Manhattan with a doorman, in-unit laundry and skyline views.',
    propertyType: 'apartment',
    monthlyRent: { amount: 4200, currency: 'USD' },
    bedrooms: 1,
    bathrooms: 1,
    furnished: true,
    amenities: ['air_conditioning', 'wifi', 'doorman', 'washer', 'gym'],
    address: {
      line1: '350 W 42nd St',
      neighborhood: 'Midtown',
      city: 'New York',
      region: 'New York',
      country: 'United States',
      countryCode: 'US',
    },
    photos: [
      {
        url: 'https://photos2.theblueground.com/736/partner-network/sample/nyc-living-room.jpg',
        caption: 'Living room',
        isCover: true,
      },
    ],
  },
];
