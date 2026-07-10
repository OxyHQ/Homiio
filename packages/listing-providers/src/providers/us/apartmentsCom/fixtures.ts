/**
 * Recorded apartments.com fixtures (Phase 3).
 *
 * Hand-authored, portal-SHAPED HTML — NOT copied real listings — carrying the
 * exact `<script type="application/ld+json">` schema.org blocks apartments.com
 * emits, plus a minimal search page with detail links. They exist so the
 * discover → fetch → normalize path (and especially `normalize()`) is unit
 * tested WITHOUT ever hitting the live portal in CI.
 *
 * `image` URLs point at example CDN hosts; the ingest pipeline fetches those
 * bytes once and re-hosts them via Sharp/S3 — they are never runtime image URLs.
 */

/** A recorded portal page: the URL it was "fetched" from and its HTML body. */
export interface RecordedPage {
  sourceId: string;
  url: string;
  html: string;
}

function detailHtml(params: {
  name: string;
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  lat: number;
  lng: number;
  priceRange?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  images: string[];
  url: string;
}): string {
  const ld = {
    '@context': 'https://schema.org',
    '@type': ['Product', 'ApartmentComplex'],
    name: params.name,
    description: `${params.name} — pet-friendly rentals in ${params.locality}.`,
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
    floorSize: params.sqft
      ? { '@type': 'QuantitativeValue', value: params.sqft, unitCode: 'FTK' }
      : undefined,
    priceRange: params.priceRange,
    offers: params.price
      ? { '@type': 'Offer', price: params.price, priceCurrency: 'USD' }
      : undefined,
  };
  return [
    '<!doctype html><html><head>',
    `<title>${params.name}</title>`,
    '<meta name="description" content="apartments.com listing">',
    `<script type="application/ld+json">${JSON.stringify(ld)}</script>`,
    '</head><body><main><h1>',
    params.name,
    '</h1><p>Contact the property for current availability and pricing details, floor plans, amenities and lease terms.</p></main></body></html>',
  ].join('');
}

export const APARTMENTS_COM_DETAIL_FIXTURES: readonly RecordedPage[] = [
  {
    sourceId: '9wz8k2p',
    url: 'https://www.apartments.com/the-harlow-austin-tx/9wz8k2p/',
    html: detailHtml({
      name: 'The Harlow',
      street: '1600 Barton Springs Rd',
      locality: 'Austin',
      region: 'TX',
      postalCode: '78704',
      lat: 30.2617,
      lng: -97.7712,
      priceRange: '$1,650 - $3,200',
      bedrooms: 2,
      bathrooms: 2,
      sqft: 980,
      images: [
        'https://images.apartments.com/example/the-harlow-1.jpg',
        'https://images.apartments.com/example/the-harlow-2.jpg',
      ],
      url: 'https://www.apartments.com/the-harlow-austin-tx/9wz8k2p/',
    }),
  },
  {
    sourceId: '4tt1m0e',
    url: 'https://www.apartments.com/gramercy-flats-chicago-il/4tt1m0e/',
    html: detailHtml({
      name: 'Gramercy Flats',
      street: '210 W Chicago Ave',
      locality: 'Chicago',
      region: 'IL',
      postalCode: '60654',
      lat: 41.8963,
      lng: -87.6341,
      price: 2100,
      bedrooms: 1,
      bathrooms: 1,
      sqft: 720,
      images: ['https://images.apartments.com/example/gramercy-1.jpg'],
      url: 'https://www.apartments.com/gramercy-flats-chicago-il/4tt1m0e/',
    }),
  },
];

/** A recorded search-results page with links to the detail fixtures above. */
export const APARTMENTS_COM_SEARCH_FIXTURE: string = [
  '<!doctype html><html><head><title>Apartments in Austin, TX</title>',
  '<meta name="description" content="apartments.com search results for rentals">',
  '</head><body><main><ul>',
  ...APARTMENTS_COM_DETAIL_FIXTURES.map(
    (page) => `<li><a href="${page.url}">${page.sourceId}</a></li>`,
  ),
  '</ul><p>Browse thousands of verified rentals with photos, floor plans and up to date pricing.</p></main></body></html>',
].join('');
