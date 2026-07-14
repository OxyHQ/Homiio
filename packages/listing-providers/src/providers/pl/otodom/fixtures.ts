/** Recorded Otodom.pl fixtures (OLX vertical / __NEXT_DATA__). */

export const OTODOM_BASE_URL = 'https://www.otodom.pl';

/** Voivodeship slug for major Otodom discover cities. */
export const OTODOM_REGION_BY_CITY: Readonly<Record<string, string>> = {
  warszawa: 'mazowieckie',
  krakow: 'malopolskie',
  lodz: 'lodzkie',
  wroclaw: 'dolnoslaskie',
  poznan: 'wielkopolskie',
  gdansk: 'pomorskie',
  szczecin: 'zachodniopomorskie',
  bydgoszcz: 'kujawsko-pomorskie',
  lublin: 'lubelskie',
  katowice: 'slaskie',
};

export const OTODOM_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="pl">
<head><title>Mieszkania na wynajem: Kraków | Otodom.pl</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "data": {
        "searchAds": {
          "items": [
            {
              "id": 67155161,
              "title": "Bez prowizji - 2 pokoje - ul. Bunscha",
              "slug": "bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L",
              "href": "[lang]/ad/bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L",
              "estate": "FLAT",
              "transaction": "RENT",
              "totalPrice": { "value": 2900, "currency": "PLN" },
              "roomsNumber": "TWO",
              "areaInSquareMeters": 42,
              "location": {
                "reverseGeocoding": {
                  "locations": [
                    { "name": "małopolskie", "locationLevel": "voivodeship" },
                    { "name": "Kraków", "locationLevel": "city_or_village" }
                  ]
                }
              }
            },
            {
              "id": 67155162,
              "title": "Mieszkanie na sprzedaż",
              "slug": "mieszkanie-krakow-ID4xM7M",
              "href": "[lang]/ad/mieszkanie-krakow-ID4xM7M",
              "estate": "FLAT",
              "transaction": "SELL",
              "totalPrice": { "value": 650000, "currency": "PLN" },
              "roomsNumber": "THREE",
              "areaInSquareMeters": 58
            }
          ]
        }
      }
    }
  }
}
</script>
</body>
</html>`;

export const OTODOM_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="pl">
<head><title>Bez prowizji - 2 pokoje | Otodom.pl</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "id": "67155161",
      "contactDetails": {
        "name": "AFI Home",
        "type": "agency",
        "phones": ["+48698089999"]
      },
      "ad": {
        "id": 67155161,
        "title": "Bez prowizji - 2 pokoje - ul. Bunscha",
        "slug": "bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L",
        "url": "https://www.otodom.pl/pl/oferta/bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L",
        "estate": "FLAT",
        "description": "Nowoczesne mieszkanie w Ruczaju.",
        "totalPrice": { "value": 2900, "currency": "PLN" },
        "attributes": { "rooms_num": "TWO", "m": 42 },
        "location": {
          "address": { "street": { "name": "ul. Karola Bunscha", "number": "12" } },
          "reverseGeocoding": {
            "locations": [
              { "name": "Kraków", "locationLevel": "city_or_village" },
              { "name": "Ruczaj", "locationLevel": "residential" }
            ]
          },
          "coordinates": { "latitude": 50.02, "longitude": 19.92 }
        },
        "images": [
          { "large": "https://ireland.apollo.olxcdn.com/v1/files/example-67155161.jpg" }
        ]
      }
    }
  }
}
</script>
</body>
</html>`;

/**
 * Current Otodom detail markup: the headline price lives in
 * `unifiedAd.price.rentalPrice` / `ad.characteristics`, the operation in
 * `ad.adCategory.type`, and there is no `ad.totalPrice`. This is the shape the
 * live portal serves today — the legacy fixture above keeps the old-shape path
 * covered.
 */
export const OTODOM_FIXTURE_DETAIL_UNIFIED_HTML = `<!doctype html>
<html lang="pl">
<head><title>Mieszkanie 2- pokojowe Skorosze | Otodom.pl</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "id": "68201653",
      "contactDetails": {
        "name": "Marcin",
        "type": "private",
        "phones": ["+48733806496"]
      },
      "ad": {
        "id": 68201653,
        "title": "Mieszkanie 2- pokojowe, Skorosze przy Alejach Jerozolimskich",
        "slug": "mieszkanie-2-pokojowe-skorosze-ID4CamF",
        "url": "https://www.otodom.pl/pl/oferta/mieszkanie-2-pokojowe-skorosze-ID4CamF",
        "description": "Przytulne mieszkanie na Skoroszach.",
        "price": { "type": "VISIBLE" },
        "adCategory": { "id": 102, "name": "FLAT", "type": "RENT" },
        "target": { "OfferType": "wynajem", "Price": 3650, "Rooms_num": ["2"], "Area": 38 },
        "attributes": { "rooms_num": "2", "m": "38", "building_type": "apartment" },
        "characteristics": [
          { "key": "price", "value": "3650", "currency": "PLN", "localizedValue": "3650 zł" },
          { "key": "rent", "value": "950", "currency": "PLN", "localizedValue": "950 zł" },
          { "key": "m", "value": "38", "localizedValue": "38 m²", "currency": "" },
          { "key": "rooms_num", "value": "2", "localizedValue": "2", "currency": "" }
        ],
        "location": {
          "address": { "street": { "name": "al. Aleje Jerozolimskie", "number": null } },
          "reverseGeocoding": {
            "locations": [
              { "name": "mazowieckie", "locationLevel": "voivodeship" },
              { "name": "Warszawa", "locationLevel": "city_or_village" },
              { "name": "Skorosze", "locationLevel": "residential" }
            ]
          },
          "coordinates": { "latitude": 52.188404, "longitude": 20.912094 }
        },
        "images": [
          { "large": "https://ireland.apollo.olxcdn.com/v1/files/example-68201653-1.jpg" },
          { "large": "https://ireland.apollo.olxcdn.com/v1/files/example-68201653-2.jpg" }
        ]
      },
      "unifiedAd": {
        "id": 68201653,
        "title": "Mieszkanie 2- pokojowe, Skorosze przy Alejach Jerozolimskich",
        "attributes": { "rooms_num": "2", "m": "38" },
        "price": {
          "__typename": "RentalPrice",
          "rentalPrice": { "value": 3650, "currency": "PLN", "__typename": "Money" }
        }
      }
    }
  }
}
</script>
</body>
</html>`;

/**
 * Current Otodom detail markup with the FULL `attributes` bag the live portal
 * serves (captured 2026-07): grouped amenity arrays (`extras_types`,
 * `equipment_types`, `media_types`, `security_types`), the `floor_no` / `build_year`
 * structured fields, and `heating`. Proves amenities + floor + yearBuilt extraction.
 */
export const OTODOM_FIXTURE_DETAIL_ENRICHED_HTML = `<!doctype html>
<html lang="pl">
<head><title>NOWE 2 pokoje, 38 m² | Otodom.pl</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json" crossorigin="anonymous">
{
  "props": {
    "pageProps": {
      "id": "67968101",
      "contactDetails": {
        "name": "Joanna",
        "type": "private",
        "phones": ["+48787010420"]
      },
      "ad": {
        "id": 67968101,
        "title": "NOWE 2 pokoje, 38 m² | Interent w cenie !",
        "slug": "nowe-2-pokoje-38-m-interent-w-cenie-ID4BbBH",
        "url": "https://www.otodom.pl/pl/oferta/nowe-2-pokoje-38-m-interent-w-cenie-ID4BbBH",
        "advertiserType": "private",
        "description": "Nowe mieszkanie na Gocławku, internet w cenie.",
        "adCategory": { "id": 102, "name": "FLAT", "type": "RENT" },
        "attributes": {
          "rooms_num": "2",
          "m": "38",
          "floor_no": "floor_2",
          "build_year": "2026",
          "building_floors_num": "5",
          "building_type": "block",
          "construction_status": "ready_to_use",
          "heating": "urban",
          "extras_types": ["balcony", "garage", "lift"],
          "equipment_types": ["furniture", "washing_machine", "dishwasher", "fridge", "stove", "oven"],
          "media_types": ["internet"],
          "security_types": ["entryphone", "monitoring", "alarm", "closed_area"]
        },
        "characteristics": [
          { "key": "price", "value": "3400", "currency": "PLN", "localizedValue": "3400 zł" },
          { "key": "m", "value": "38", "localizedValue": "38 m²", "currency": "" },
          { "key": "floor_no", "value": "floor_2", "localizedValue": "", "currency": "" },
          { "key": "build_year", "value": "2026", "localizedValue": "2026", "currency": "" },
          { "key": "heating", "value": "urban", "localizedValue": "", "currency": "" },
          { "key": "rooms_num", "value": "2", "localizedValue": "2", "currency": "" }
        ],
        "location": {
          "address": { "street": { "name": "Ostrobramska 36B", "number": null } },
          "reverseGeocoding": {
            "locations": [
              { "name": "mazowieckie", "locationLevel": "voivodeship" },
              { "name": "Warszawa", "locationLevel": "city_or_village" },
              { "name": "Praga-Południe", "locationLevel": "district" },
              { "name": "Gocławek", "locationLevel": "residential" }
            ]
          },
          "coordinates": { "latitude": 52.232906, "longitude": 21.11893 }
        },
        "images": [
          { "large": "https://ireland.apollo.olxcdn.com/v1/files/enriched-67968101-1/image;s=2048x1536" },
          { "large": "https://ireland.apollo.olxcdn.com/v1/files/enriched-67968101-2/image;s=2048x1536" }
        ]
      },
      "unifiedAd": {
        "id": 67968101,
        "title": "NOWE 2 pokoje, 38 m² | Interent w cenie !",
        "attributes": {
          "rooms_num": "2",
          "m": "38",
          "floor_no": "floor_2",
          "build_year": "2026",
          "heating": "urban",
          "extras_types": ["balcony", "garage", "lift"],
          "equipment_types": ["furniture", "washing_machine", "dishwasher", "fridge", "stove", "oven"],
          "media_types": ["internet"],
          "security_types": ["entryphone", "monitoring", "alarm", "closed_area"]
        },
        "price": {
          "__typename": "RentalPrice",
          "rentalPrice": { "value": 3400, "currency": "PLN", "__typename": "Money" }
        }
      }
    }
  }
}
</script>
</body>
</html>`;
