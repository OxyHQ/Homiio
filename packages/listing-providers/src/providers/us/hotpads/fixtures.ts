/**
 * Recorded HotPads JSON fixtures (portal-shaped, hand-authored).
 */

export const HOTPADS_API_BASE =
  'https://hotpads-api-gke-prod-1-west-20250228-public.hotpads.com/hotpads-api/api/v2';
export const HOTPADS_BASE_URL = 'https://hotpads.com';

export interface HotpadsListingFixture {
  aliasEncoded: string;
  lotIdEncoded: string;
  uriMalone: string;
  title: string;
  propertyType: string;
  listingType: string;
  address: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
  geo: { lat: number; lon: number };
  modelSummary: {
    minBeds: number;
    maxBeds: number;
    minPrice: number;
    maxPrice: number;
    minBaths: number;
    maxBaths: number;
    minSqft: number;
    maxSqft: number;
  };
  medPhotoUrl: string;
  medPhotoUrls: string[];
}

export const HOTPADS_AREA_FIXTURE = {
  status: 'OK',
  success: true,
  data: {
    id: '216213232',
    resourceId: 'austin-tx',
    name: 'Austin',
    state: 'TX',
    city: 'Austin',
    minLat: 30.06787,
    maxLat: 30.51948,
    minLon: -98.090558,
    maxLon: -97.541748,
    coordinates: { lon: -97.816153, lat: 30.293677 },
  },
};

export const HOTPADS_LISTING_FIXTURE: HotpadsListingFixture = {
  aliasEncoded: '4gcqnjtt6yd4g',
  lotIdEncoded: '249j0mr',
  uriMalone: '/alexan-braker-pointe-austin-tx-78759-249j0mr/pad',
  title: 'Alexan Braker Pointe',
  propertyType: 'large',
  listingType: 'rental',
  address: {
    street: '10801 N Mopac Expy',
    city: 'Austin',
    state: 'TX',
    zip: '78759',
  },
  geo: { lat: 30.395722, lon: -97.731548 },
  modelSummary: {
    minBeds: 0,
    maxBeds: 2,
    minPrice: 1728,
    maxPrice: 2731,
    minBaths: 1,
    maxBaths: 2,
    minSqft: 616,
    maxSqft: 1236,
  },
  medPhotoUrl: 'https://photos.zillowstatic.com/fp/example-hotpads-1.webp',
  medPhotoUrls: ['https://photos.zillowstatic.com/fp/example-hotpads-2.webp'],
};

export const HOTPADS_SEARCH_FIXTURE = {
  status: 'OK',
  success: true,
  data: {
    numListingsAvailable: 1,
    numListingsIncluded: 1,
    buildings: [
      {
        lotIdEncoded: HOTPADS_LISTING_FIXTURE.lotIdEncoded,
        geo: { lat: HOTPADS_LISTING_FIXTURE.geo.lat, lon: HOTPADS_LISTING_FIXTURE.geo.lon },
        uri: HOTPADS_LISTING_FIXTURE.uriMalone.replace('/pad', '/building'),
        listings: [HOTPADS_LISTING_FIXTURE],
      },
    ],
  },
};
