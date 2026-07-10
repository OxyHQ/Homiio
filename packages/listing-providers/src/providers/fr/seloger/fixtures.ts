/**
 * SeLoger fixtures — embedded `window["initialData"]` JSON (portal-shaped).
 */

export const SELOGER_BASE_URL = 'https://www.seloger.com';

const INITIAL_DATA = {
  cards: {
    list: [
      {
        cardType: 'classified',
        id: 201234567,
        pricing: { rawPrice: '1450', price: '1 450 €' },
        surface: 52,
        rooms: 2,
        bedrooms: 1,
        title: 'Appartement 2 pièces',
        city: 'Paris',
        zipCode: '75011',
        estateType: 'Appartement',
        photos: ['https://v.seloger.com/fixture/1.jpg'],
        position: { lat: 48.857, lng: 2.38 },
        contact: {
          phone: '01 40 00 00 00',
          agencyName: 'Century 21 République',
          name: 'Century 21 République',
        },
      },
      {
        cardType: 'classified',
        id: 201234568,
        pricing: { rawPrice: '520000' },
        surface: 78,
        rooms: 3,
        bedrooms: 2,
        title: 'Appartement 3 pièces',
        city: 'Paris',
        zipCode: '75003',
        estateType: 'Appartement',
        transactionType: 'buy',
        photos: ['https://v.seloger.com/fixture/2.jpg'],
        contact: { phone: '01 42 00 00 00', agencyName: 'Orpi Marais' },
      },
      {
        cardType: 'advertisement',
        id: 999,
        title: 'Promo',
      },
    ],
  },
  navigation: { page: 1 },
};

function escapeForInitialData(json: string): string {
  return json.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export const SELOGER_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="fr">
<head><title>Locations Paris</title>
<script>
window["initialData"] = JSON.parse("${escapeForInitialData(JSON.stringify(INITIAL_DATA))}");
</script>
</head>
<body><main><article class="item">search</article></main></body>
</html>`;

const DETAIL_NEXT = {
  props: {
    pageProps: {
      listingData: {
        listing: {
          id: 201234567,
          pricing: { price: 1450, priceLabel: '1 450 €' },
          surface: 52,
          rooms: 2,
          bedrooms: 1,
          title: 'Appartement 2 pièces République',
          description: 'Bel appartement lumineux proche métro.',
          city: 'Paris',
          zipCode: '75011',
          estateType: 'Appartement',
          transactionType: 'rent',
          photos: [
            { url: 'https://v.seloger.com/fixture/1.jpg' },
            { url: 'https://v.seloger.com/fixture/1b.jpg' },
          ],
          coordinates: { latitude: 48.857, longitude: 2.38 },
          contact: {
            phoneNumber: '01 40 00 00 00',
            agencyName: 'Century 21 République',
            email: 'agence@century21.example',
          },
        },
      },
    },
  },
};

export const SELOGER_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="fr">
<head><title>Appartement Paris</title>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(DETAIL_NEXT)}</script>
</head>
<body><main><h1>Appartement</h1></main></body>
</html>`;
