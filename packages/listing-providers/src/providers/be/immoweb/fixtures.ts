/** Recorded Immoweb fixtures for unit tests (portal-shaped, hand-authored). */

export const IMMOWEB_BASE_URL = 'https://www.immoweb.be';

export const IMMOWEB_FIXTURE_SEARCH_JSON = `{
  "criteria": {
    "countries": "BE",
    "propertyTypes": "APARTMENT",
    "provinces": [{ "queryValue": "BRUSSELS", "slug": "brussels" }],
    "transactionTypes": "FOR_RENT",
    "page": "1"
  },
  "sort": "relevance",
  "results": [
    {
      "id": 21703816,
      "customerName": "RealtyCare",
      "property": {
        "type": "APARTMENT",
        "subtype": "APARTMENT",
        "title": "Uccle - Churchill | 1 bedroom apartment with garden!",
        "bedroomCount": 1,
        "location": {
          "country": "Belgium",
          "region": "Brussels",
          "province": "Brussels",
          "locality": "Uccle",
          "postalCode": "1180",
          "street": "Rue Marianne",
          "number": "35",
          "latitude": 50.8130679,
          "longitude": 4.3522967
        }
      },
      "transaction": { "type": "FOR_RENT" },
      "price": { "mainValue": 1250, "mainDisplayPrice": "€1,250/month" },
      "media": {
        "pictures": [
          {
            "largeUrl": "https://media-resize.immowebstatic.be/classifieds/example/large.jpg",
            "extralargeUrl": "https://media-resize.immowebstatic.be/classifieds/example/xl.jpg"
          }
        ]
      }
    },
    {
      "id": 21703817,
      "customerName": "Home Agency",
      "property": {
        "type": "APARTMENT",
        "title": "Ixelles studio",
        "bedroomCount": 0,
        "location": {
          "country": "Belgium",
          "locality": "Ixelles",
          "postalCode": "1050",
          "street": "Avenue Louise",
          "latitude": 50.83,
          "longitude": 4.36
        }
      },
      "transaction": { "type": "FOR_SALE" },
      "price": { "mainValue": 295000, "mainDisplayPrice": "€295,000" },
      "media": { "pictures": [] }
    }
  ],
  "totalItems": 2
}`;

export const IMMOWEB_FIXTURE_DETAIL_JSON = `{
  "classified": {
    "id": 21703816,
    "property": {
      "type": "APARTMENT",
      "subtype": "APARTMENT",
      "title": "Uccle - Churchill | 1 bedroom apartment with garden!",
      "bedroomCount": 1,
      "bathroomCount": 1,
      "netHabitableSurface": 62,
      "constructionYear": 1965,
      "hasLift": true,
      "hasGarden": true,
      "gardenSurface": 40,
      "hasTerrace": true,
      "terraceSurface": 8,
      "parkingCountIndoor": 1,
      "parkingCountOutdoor": 0,
      "isFurnished": true,
      "kitchen": { "type": "HYPER_EQUIPPED" },
      "description": "Bright apartment near Churchill.",
      "location": {
        "country": "Belgium",
        "region": "Brussels",
        "province": "Brussels",
        "locality": "Uccle",
        "postalCode": "1180",
        "street": "Rue Marianne",
        "number": "35",
        "latitude": 50.8130679,
        "longitude": 4.3522967
      }
    },
    "transaction": { "type": "FOR_RENT", "rental": { "monthlyRentalPrice": 1250 } },
    "customers": [
      {
        "type": "AGENCY",
        "name": "RealtyCare",
        "phoneNumber": "+3224505656",
        "email": "contact@realtycare.test"
      }
    ],
    "media": {
      "pictures": [
        {
          "extralargeUrl": "https://media-resize.immowebstatic.be/classifieds/example/xl.jpg"
        }
      ]
    }
  }
}`;

/** Discover city label → Immoweb `provinces=` API token. */
export const IMMOWEB_PROVINCE_BY_CITY: Readonly<Record<string, string>> = {
  brussels: 'BRUSSELS',
  antwerp: 'ANTWERP',
  ghent: 'EAST-FLANDERS',
  charleroi: 'HAINAUT',
  liege: 'LIEGE',
  bruges: 'WEST-FLANDERS',
  namur: 'NAMUR',
  leuven: 'FLEMISH-BRABANT',
  mons: 'HAINAUT',
  mechelen: 'ANTWERP',
};
