/** Recorded Funda.nl fixtures (mobile JSON API shape, hand-authored). */

export const FUNDA_BASE_URL = 'https://www.funda.nl';
export const FUNDA_SEARCH_URL = 'https://listing-search-wonen.funda.io/_msearch/template';
export const FUNDA_DETAIL_BASE_URL = 'https://listing-detail-page.funda.io/api/v4/listing/object/nl';

export const FUNDA_SEARCH_INDEX = 'listings-wonen-searcher-alias-prod';
export const FUNDA_SEARCH_TEMPLATE_ID = 'search_result_20250805';

export const FUNDA_FIXTURE_SEARCH_JSON = `{
  "responses": [
    {
      "hits": {
        "hits": [
          {
            "_source": {
              "global_id": "abc123-global",
              "object_guid": "abc123-global",
              "tiny_id": 43117443,
              "offering_type": "rent",
              "price": { "rent_price": 1850, "rent_price_formatted": "€ 1.850 p/m" },
              "address": {
                "city": "Amsterdam",
                "street_name": "Herengracht",
                "house_number": "100",
                "postcode": "1015 BS"
              },
              "object_type": "apartment",
              "number_of_rooms": 3,
              "floor_area": 72,
              "publication_date": "2026-07-01",
              "detail_page_relative_url": "/detail/huur/amsterdam/appartement-herengracht/43117443/"
            }
          },
          {
            "_source": {
              "global_id": "def456-global",
              "tiny_id": 43117444,
              "offering_type": "buy",
              "price": { "selling_price": 575000, "selling_price_formatted": "€ 575.000 k.k." },
              "address": {
                "city": "Rotterdam",
                "street_name": "Coolsingel",
                "house_number": "12"
              },
              "object_type": "house",
              "number_of_rooms": 5,
              "floor_area": 140,
              "detail_page_relative_url": "/detail/koop/rotterdam/huis-coolsingel/43117444/"
            }
          }
        ]
      }
    }
  ]
}`;

export const FUNDA_FIXTURE_DETAIL_JSON = `{
  "global_id": "abc123-global",
  "tiny_id": 43117443,
  "offering_type": "rent",
  "price": { "rent_price": 1850 },
  "address": {
    "city": "Amsterdam",
    "street_name": "Herengracht",
    "house_number": "100",
    "postcode": "1015 BS",
    "latitude": 52.378,
    "longitude": 4.884
  },
  "object_type": "apartment",
  "number_of_rooms": 3,
  "number_of_bedrooms": 2,
  "floor_area": 72,
  "description": "Characteristic canal apartment.",
  "media": [
    { "url": "https://cloud.funda.nl/example/43117443-1.jpg", "media_type": "photo" }
  ],
  "broker": {
    "name": "Funda Test Makelaar",
    "phone": "+31201234567",
    "email": "info@testmakelaar.nl"
  },
  "detail_page_relative_url": "/detail/huur/amsterdam/appartement-herengracht/43117443/"
}`;

/** Funda `selected_area` slugs for major cities. */
export const FUNDA_AREA_BY_CITY: Readonly<Record<string, string>> = {
  amsterdam: 'amsterdam',
  rotterdam: 'rotterdam',
  'the-hague': 'den-haag',
  'den-haag': 'den-haag',
  utrecht: 'utrecht',
  eindhoven: 'eindhoven',
  groningen: 'groningen',
  tilburg: 'tilburg',
  almere: 'almere',
  breda: 'breda',
  nijmegen: 'nijmegen',
};
