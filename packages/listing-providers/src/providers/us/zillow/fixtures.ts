/**
 * Recorded Zillow fixtures (Phase 3).
 *
 * Hand-authored, portal-SHAPED HTML — NOT copied real listings — carrying the
 * `<script type="application/ld+json">` schema.org blocks a Zillow home-details
 * page emits (a `SingleFamilyResidence`/`Apartment` node with a nested `offers`
 * Offer), for both a for-RENT and a for-SALE listing, plus a minimal search
 * page. They let discover → fetch → normalize (and `normalize()` in particular)
 * be unit tested WITHOUT hitting live Zillow in CI.
 *
 * `image` URLs point at example CDN hosts; the ingest pipeline fetches those
 * bytes once and re-hosts them via Sharp/S3 — never used as runtime image URLs.
 */

/** A recorded portal page with its (rent|sale) intent, URL and HTML body. */
export interface RecordedZillowPage {
  sourceId: string;
  url: string;
  kind: 'rent' | 'sale';
  html: string;
}

function detailHtml(params: {
  schemaType: string;
  name: string;
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  lat: number;
  lng: number;
  price: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  images: string[];
  url: string;
}): string {
  const ld = {
    '@context': 'https://schema.org',
    '@type': [params.schemaType, 'Product'],
    name: params.name,
    description: `${params.name} in ${params.locality}, ${params.region}.`,
    url: params.url,
    address: {
      '@type': 'PostalAddress',
      streetAddress: params.street,
      addressLocality: params.locality,
      addressRegion: params.region,
      postalCode: params.postalCode,
      addressCountry: 'US',
    },
    geo: { '@type': 'GeoCoordinates', latitude: params.lat, longitude: params.lng },
    image: params.images,
    numberOfBedrooms: params.bedrooms,
    numberOfBathroomsTotal: params.bathrooms,
    floorSize: { '@type': 'QuantitativeValue', value: params.sqft, unitCode: 'FTK' },
    offers: {
      '@type': 'Offer',
      price: params.price,
      priceCurrency: 'USD',
    },
  };
  return [
    '<!doctype html><html><head>',
    `<title>${params.name} | Zillow</title>`,
    '<meta name="description" content="zillow home details">',
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    '</head><body><main><h1>',
    params.name,
    '</h1><p>See full property details, photos, price history, tax records, nearby schools and a Zestimate on this Zillow listing.</p></main></body></html>',
  ].join('');
}

export const ZILLOW_DETAIL_FIXTURES: readonly RecordedZillowPage[] = [
  {
    sourceId: '2078342115',
    url: 'https://www.zillow.com/homedetails/512-Elm-St-Portland-OR-97209/2078342115_zpid/',
    kind: 'rent',
    html: detailHtml({
      schemaType: 'Apartment',
      name: '512 Elm St #4',
      street: '512 Elm St #4',
      locality: 'Portland',
      region: 'OR',
      postalCode: '97209',
      lat: 45.5289,
      lng: -122.6836,
      price: 2450,
      bedrooms: 2,
      bathrooms: 1,
      sqft: 850,
      images: [
        'https://photos.zillowstatic.com/example/512-elm-1.jpg',
        'https://photos.zillowstatic.com/example/512-elm-2.jpg',
      ],
      url: 'https://www.zillow.com/homedetails/512-Elm-St-Portland-OR-97209/2078342115_zpid/',
    }),
  },
  {
    sourceId: '3391120847',
    url: 'https://www.zillow.com/homedetails/88-Maple-Ave-Denver-CO-80205/3391120847_zpid/',
    kind: 'sale',
    html: detailHtml({
      schemaType: 'SingleFamilyResidence',
      name: '88 Maple Ave',
      street: '88 Maple Ave',
      locality: 'Denver',
      region: 'CO',
      postalCode: '80205',
      lat: 39.7599,
      lng: -104.9662,
      price: 615000,
      bedrooms: 3,
      bathrooms: 2,
      sqft: 1780,
      images: ['https://photos.zillowstatic.com/example/88-maple-1.jpg'],
      url: 'https://www.zillow.com/homedetails/88-Maple-Ave-Denver-CO-80205/3391120847_zpid/',
    }),
  },
];

/** A recorded for-rent search page linking to the rent detail fixture. */
export const ZILLOW_SEARCH_FIXTURE: string = [
  '<!doctype html><html><head><title>Portland OR Rental Listings | Zillow</title>',
  '<meta name="description" content="zillow rentals search results">',
  '</head><body><main><ul>',
  ...ZILLOW_DETAIL_FIXTURES.filter((page) => page.kind === 'rent').map(
    (page) => `<li><a href="${page.url}">${page.sourceId}</a></li>`,
  ),
  '</ul><p>Browse Zillow rentals with photos, floor plans, pricing and application details.</p></main></body></html>',
].join('');
