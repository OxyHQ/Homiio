/**
 * Bayut (UAE) fixtures — `__NEXT_DATA__` embedded JSON (hb-captcha-gated live).
 */

export const BAYUT_BASE_URL = 'https://www.bayut.com';

const SEARCH_PAGE_PROPS = {
  searchResult: {
    hits: [
      {
        externalID: '7891234',
        slug: 'spacious-1br-sea-view-dubai-marina-7891234',
        purpose: 'for-rent',
        price: 95000,
        rentFrequency: 'yearly',
        rooms: 1,
        baths: 2,
        area: 850.5,
        title: 'Spacious 1BR | Sea View | High Floor',
        description: 'Bright apartment with marina views and premium finishes.',
        category: [{ slug: 'apartments' }],
        location: [
          { name: 'UAE' },
          { name: 'Dubai' },
          { name: 'Dubai Marina' },
        ],
        coverPhoto: {
          url: 'https://bayut-production.s3.eu-central-1.amazonaws.com/image/example-rent.jpg',
        },
        photos: [
          { url: 'https://bayut-production.s3.eu-central-1.amazonaws.com/image/example-rent.jpg' },
          { url: 'https://bayut-production.s3.eu-central-1.amazonaws.com/image/example-rent-2.jpg' },
        ],
        agency: { name: 'Premium Properties LLC' },
        contactName: 'John Smith',
        phoneNumber: { mobile: '+971501234567' },
        geo: { lat: 25.0805, lng: 55.1403 },
      },
      {
        externalID: '7891235',
        slug: 'luxury-2br-downtown-dubai-7891235',
        purpose: 'for-sale',
        price: 2500000,
        rooms: 2,
        baths: 3,
        area: 1200,
        title: 'Luxury 2BR in Downtown Dubai',
        description: 'Corner unit with Burj Khalifa views.',
        category: [{ slug: 'apartments' }],
        location: [
          { name: 'UAE' },
          { name: 'Dubai' },
          { name: 'Downtown Dubai' },
        ],
        coverPhoto: {
          url: 'https://bayut-production.s3.eu-central-1.amazonaws.com/image/example-sale.jpg',
        },
        photos: [{ url: 'https://bayut-production.s3.eu-central-1.amazonaws.com/image/example-sale.jpg' }],
        agency: { name: 'Elite Homes Real Estate' },
        contactName: 'Sarah Khan',
        phoneNumber: { mobile: '+971509876543' },
        geo: { lat: 25.1972, lng: 55.2744 },
      },
    ],
    total: 2,
    page: 1,
    totalPages: 1,
  },
};

const DETAIL_PAGE_PROPS = {
  property: SEARCH_PAGE_PROPS.searchResult.hits[0],
};

function buildNextDataHtml(pageProps: Record<string, unknown>): string {
  const nextData = {
    props: { pageProps },
    page: '/search',
    query: {},
    buildId: 'fixture',
  };
  return `<!DOCTYPE html><html><head><title>Bayut</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
</body></html>`;
}

export const BAYUT_FIXTURE_SEARCH_HTML = buildNextDataHtml(SEARCH_PAGE_PROPS);
export const BAYUT_FIXTURE_DETAIL_HTML = buildNextDataHtml(DETAIL_PAGE_PROPS);

export const BAYUT_LOCATION_IDS: Readonly<Record<string, string>> = {
  dubai: '5002',
  'abu-dhabi': '6020',
};
