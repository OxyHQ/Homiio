/**
 * Recorded OnTheMarket fixtures (portal-shaped).
 */

export const ONTHEMARKET_BASE_URL = 'https://www.onthemarket.com';

export const ONTHEMARKET_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="en-GB">
<body>
<a href="/details/19901416/">3 bed flat</a>
<a href="/details/19890062/">Garage to rent</a>
<a href="/details/19901417/">2 bed apartment</a>
</body>
</html>`;

const PROPERTY_JSON = {
  id: 19901416,
  displayAddress: 'Amies Street, Battersea, SW11 London',
  addressLocality: 'London',
  humanisedPropertyType: 'Flat',
  propSubId: 'flat',
  bedrooms: 3,
  bathrooms: 2,
  toRent: true,
  searchType: 'to-rent',
  price: '£5,500 pcm (£1,269 pw)',
  shortPrice: '£5,500',
  priceRaw: 5500,
  summary: 'A bright three bedroom flat in Battersea.',
  description: '<p>A bright three bedroom flat in Battersea.</p>',
  location: { lat: 51.466426, lon: -0.162671 },
  images: [
    {
      largeUrl: 'https://media.onthemarket.com/properties/19901416/image-0-1024x1024.jpg',
    },
  ],
  agent: {
    name: 'Example Lettings',
    companyName: 'Example Lettings Ltd',
    telephone: '020 8022 7422',
  },
  whatsappLink: 'https://wa.me/442080227422',
};

export const ONTHEMARKET_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="en-GB">
<head><title>Amies Street Flat to rent</title>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{},"initialReduxState":{"property":${JSON.stringify(PROPERTY_JSON)}}}}
</script>
</head>
<body><h1>Flat to rent</h1></body>
</html>`;

export const ONTHEMARKET_FIXTURE_GARAGE_HTML = `<!doctype html>
<html lang="en-GB">
<head>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"initialReduxState":{"property":{"id":19890062,"humanisedPropertyType":"Garage","propSubId":"garages","toRent":true,"price":"£217 pcm","priceRaw":217,"displayAddress":"Rye Hill Park","images":[],"agent":{"telephone":"0330 098 2744"}}}}}
</script>
</head>
<body></body>
</html>`;
