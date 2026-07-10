/**
 * Recorded Rightmove fixtures (portal-shaped, not live copies).
 */

export const RIGHTMOVE_BASE_URL = 'https://www.rightmove.co.uk';

export const RIGHTMOVE_FIXTURE_TYPEAHEAD_JSON = JSON.stringify({
  matches: [
    {
      id: '87490',
      type: 'REGION',
      displayName: 'London',
    },
  ],
});

export const RIGHTMOVE_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="en-GB">
<head><title>Property to rent in London</title>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"searchResults":{"properties":[
  {"id":90551949,"bedrooms":1,"bathrooms":1,"summary":"Finished to a high specification.","displayAddress":"Holland Street, London, SE1","countryCode":"GB","location":{"latitude":51.506931,"longitude":-0.10097},"images":[{"srcUrl":"https://media.rightmove.co.uk/property-photo/aa/90551949/aa.jpeg","url":"property-photo/aa/90551949/aa.jpeg"}],"propertySubType":"Apartment","price":{"amount":3400,"frequency":"monthly","currencyCode":"GBP"}},
  {"id":90551950,"bedrooms":0,"bathrooms":0,"summary":"Secure garage.","displayAddress":"Rye Hill Park, London, SE15","countryCode":"GB","location":{"latitude":51.46,"longitude":-0.05},"images":[],"propertySubType":"Garage","price":{"amount":217,"frequency":"monthly","currencyCode":"GBP"}},
  {"id":90551951,"bedrooms":3,"bathrooms":2,"summary":"Family house.","displayAddress":"Amies Street, Battersea, SW11","countryCode":"GB","location":{"latitude":51.466,"longitude":-0.162},"images":[{"srcUrl":"https://media.rightmove.co.uk/property-photo/bb/90551951/bb.jpeg"}],"propertySubType":"Terraced","price":{"amount":4500,"frequency":"monthly","currencyCode":"GBP"}}
]}}}}
</script>
</head>
<body><main>search</main></body>
</html>`;

/** Compressed __PAGE_MODEL graph for a rent apartment (hand-authored). */
const PAGE_MODEL_DATA = JSON.stringify([
  { propertyData: 1 },
  {
    id: 2,
    bedrooms: 3,
    bathrooms: 4,
    propertySubType: 5,
    channel: 6,
    transactionType: 7,
    text: 8,
    prices: 9,
    address: 10,
    location: 11,
    images: 12,
    contactInfo: 13,
    customer: 14,
  },
  90551949,
  1,
  1,
  'Apartment',
  'RENT',
  'RENT',
  { description: 15, shortDescription: 16 },
  { primaryPrice: 17 },
  { displayAddress: 18, countryCode: 19, outcode: 20, incode: 21 },
  { latitude: 22, longitude: 23 },
  [{ url: 24, caption: 25 }],
  { telephoneNumbers: 26 },
  { branchDisplayName: 27, companyName: 28 },
  'Finished to a high specification the property features an open plan reception room.',
  'High-spec apartment',
  '£3,400 pcm',
  'Holland Street, London, SE1',
  'GB',
  'SE1',
  '9JF',
  51.506931,
  -0.10097,
  'https://media.rightmove.co.uk/property-photo/aa/90551949/aa.jpeg',
  'Living room',
  { localNumber: 29, internationalNumber: null },
  'Savills Lettings, Wapping',
  'Savills',
  '020 3872 4805',
]);

export const RIGHTMOVE_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="en-GB">
<head><title>1 bedroom apartment for rent in Holland Street, London, SE1</title></head>
<body>
<script>
window.__PAGE_MODEL = ${JSON.stringify({ data: PAGE_MODEL_DATA, encoding: 'json' })};
</script>
</body>
</html>`;
