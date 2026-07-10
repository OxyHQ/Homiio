/**
 * Leboncoin immobilier fixtures — housing categories only (9 ventes / 10 locations).
 */

export const LEBONCOIN_BASE_URL = 'https://www.leboncoin.fr';
export const LEBONCOIN_FINDER_URL = 'https://api.leboncoin.fr/finder/search';

/** Housing category ids — never scrape site-wide classifieds. */
export const LEBONCOIN_HOUSING_CATEGORY_IDS: ReadonlySet<string> = new Set(['9', '10']);

export const LEBONCOIN_FIXTURE_FINDER_JSON = JSON.stringify({
  total: 2,
  total_all: 2,
  ads: [
    {
      list_id: 2654321098,
      first_publication_date: '2026-07-01',
      index_date: '2026-07-01',
      status: 'active',
      category_id: '10',
      category_name: 'Locations',
      subject: 'Appartement T2 meublé centre Paris',
      body: 'Bel appartement 2 pièces 45 m².',
      price: [1650],
      url: 'https://www.leboncoin.fr/ad/locations/2654321098',
      images: {
        urls: ['https://img.leboncoin.fr/api/v1/fixture/1.jpg'],
        urls_large: ['https://img.leboncoin.fr/api/v1/fixture/1-large.jpg'],
      },
      location: {
        city: 'Paris',
        zipcode: '75011',
        lat: 48.857,
        lng: 2.38,
        region_name: 'Ile-de-France',
      },
      attributes: [
        { key: 'real_estate_type', value: '2', value_label: 'Appartement' },
        { key: 'rooms', value: '2', value_label: '2' },
        { key: 'square', value: '45', value_label: '45 m²' },
        { key: 'furnished', value: '1', value_label: 'Meublé' },
      ],
      owner: {
        name: 'Agence Lumière',
        type: 'pro',
        phone: '01 44 55 66 77',
      },
    },
    {
      list_id: 2654321099,
      category_id: '2',
      category_name: 'Voitures',
      subject: 'Peugeot 208',
      body: 'Voiture occasion',
      price: [8900],
      url: 'https://www.leboncoin.fr/ad/voitures/2654321099',
      location: { city: 'Lyon', zipcode: '69001' },
      owner: { name: 'Jean', type: 'private', phone: '06 11 22 33 44' },
    },
  ],
});

export const LEBONCOIN_FIXTURE_DETAIL_JSON = JSON.stringify({
  list_id: 2654321098,
  category_id: '10',
  category_name: 'Locations',
  subject: 'Appartement T2 meublé centre Paris',
  body: 'Bel appartement 2 pièces 45 m² proche métro.',
  price: [1650],
  url: 'https://www.leboncoin.fr/ad/locations/2654321098',
  images: {
    urls: [
      'https://img.leboncoin.fr/api/v1/fixture/1.jpg',
      'https://img.leboncoin.fr/api/v1/fixture/2.jpg',
    ],
  },
  location: {
    city: 'Paris',
    zipcode: '75011',
    lat: 48.857,
    lng: 2.38,
  },
  attributes: [
    { key: 'real_estate_type', value_label: 'Appartement' },
    { key: 'rooms', value: '2' },
    { key: 'square', value: '45' },
    { key: 'furnished', value: '1' },
  ],
  owner: {
    name: 'Agence Lumière',
    type: 'pro',
    phone: '01 44 55 66 77',
    email: 'contact@agence-lumiere.example',
  },
});
