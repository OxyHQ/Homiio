/**
 * realestate.com.au fixtures — `window.ArgonautExchange` embedded JSON (Kasada-gated live).
 */

export const REALESTATE_COM_AU_BASE_URL = 'https://www.realestate.com.au';

const LISTING_RENT = {
  id: '143029712',
  propertyType: { display: 'House' },
  description: 'Set in the sought-after Aurora Estate, this family home offers four bedrooms.',
  _links: {
    canonical: { href: 'https://www.realestate.com.au/property-house-vic-wollert-143029712' },
  },
  address: {
    suburb: 'Wollert',
    state: 'Vic',
    postcode: '3750',
    display: {
      shortAddress: '12 Geary Avenue',
      fullAddress: '12 Geary Avenue, Wollert, Vic 3750',
      geocode: { latitude: -37.5123, longitude: 144.9981 },
    },
  },
  propertySizes: {
    building: { displayValue: '195.1', sizeUnit: { displayValue: 'm²' } },
  },
  generalFeatures: {
    bedrooms: { value: 4 },
    bathrooms: { value: 2 },
    parkingSpaces: { value: 2 },
  },
  price: { display: '$620 per week' },
  priceValue: 620,
  channel: 'rent',
  media: {
    images: [
      { templatedUrl: 'https://i2.au.reastatic.net/{size}/abc111/image.jpg' },
      { templatedUrl: 'https://i2.au.reastatic.net/{size}/abc222/image.jpg' },
    ],
  },
  listingCompany: {
    name: 'Carvera Property',
    businessPhone: '0466229631',
  },
  listers: [
    {
      name: 'Alex Carter',
      phoneNumber: { display: '0466229631' },
    },
  ],
};

const LISTING_SALE = {
  id: '143160680',
  propertyType: { display: 'House' },
  description: 'Renowned Real Estate proudly presents this sensational opportunity in Tarneit.',
  _links: {
    canonical: { href: 'https://www.realestate.com.au/property-house-vic-tarneit-143160680' },
  },
  address: {
    suburb: 'Tarneit',
    state: 'Vic',
    postcode: '3029',
    display: {
      shortAddress: '28 Chantelle Parade',
      fullAddress: '28 Chantelle Parade, Tarneit, Vic 3029',
      geocode: { latitude: -37.8527, longitude: 144.6633 },
    },
  },
  propertySizes: {
    land: { displayValue: '336', sizeUnit: { displayValue: 'm²' } },
  },
  generalFeatures: {
    bedrooms: { value: 4 },
    bathrooms: { value: 2 },
    parkingSpaces: { value: 2 },
  },
  price: { display: '$650,000' },
  priceValue: 650000,
  channel: 'buy',
  media: {
    images: [{ templatedUrl: 'https://i2.au.reastatic.net/{size}/def333/image.jpg' }],
  },
  listingCompany: {
    name: 'Renowned Real Estate - CRAIGIEBURN',
    businessPhone: '0452060566',
  },
};

function buildArgonautScript(
  experienceKey: string,
  innerData: Record<string, unknown>,
): string {
  const cachePayload = JSON.stringify({
    'query-hash-1': { data: JSON.stringify(innerData) },
  });
  const exchange = JSON.stringify({
    [experienceKey]: { urqlClientCache: cachePayload },
  });
  return `<!DOCTYPE html><html><head><title>Search</title></head><body>
<script>window.ArgonautExchange=${exchange};</script>
</body></html>`;
}

const SEARCH_INNER = {
  results: {
    exact: {
      items: [{ listing: LISTING_RENT }, { listing: LISTING_SALE }],
    },
    pagination: { maxPageNumberAvailable: 2 },
  },
};

const DETAIL_INNER = {
  details: { listing: LISTING_RENT },
};

export const REALESTATE_COM_AU_FIXTURE_SEARCH_HTML = buildArgonautScript(
  'resi-property_search-experience-web',
  SEARCH_INNER,
);

export const REALESTATE_COM_AU_FIXTURE_DETAIL_HTML = buildArgonautScript(
  'resi-property_listing-experience-web',
  DETAIL_INNER,
);

export { LISTING_RENT, LISTING_SALE };
