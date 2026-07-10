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
              "href": "/pl/oferta/bez-prowizji-2-pokoje-ul-bunscha-ID4xM7L",
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
              "href": "/pl/oferta/mieszkanie-krakow-ID4xM7M",
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
