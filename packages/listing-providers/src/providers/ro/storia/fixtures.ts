/**
 * Recorded Storia.ro fixtures for unit tests (portal-shaped, not live copies).
 */

export const STORIA_BASE_URL = 'https://www.storia.ro';

/** Search page with `__NEXT_DATA__` searchAds.items (JSON-first discover). */
export const STORIA_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="ro">
<head><title>Apartamente de vânzare: Bucuresti | Storia.ro</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "data": {
        "searchAds": {
          "items": [
            {
              "id": 9001001,
              "title": "Apartament 2 camere Titan",
              "slug": "apartament-2-camere-titan-IDTEST1",
              "estate": "FLAT",
              "transaction": "SELL",
              "href": "/ro/oferta/apartament-2-camere-titan-IDTEST1",
              "totalPrice": { "value": 89000, "currency": "EUR" },
              "areaInSquareMeters": 49,
              "roomsNumber": "TWO",
              "location": {
                "reverseGeocoding": {
                  "locations": [
                    { "id": "bucuresti", "name": "Bucuresti", "locationLevel": "county" },
                    { "id": "bucuresti/sectorul-3/titan", "name": "Titan", "locationLevel": "district" }
                  ]
                }
              }
            },
            {
              "id": 9001002,
              "title": "Garsoniera Militari",
              "slug": "garsoniera-militari-IDTEST2",
              "estate": "FLAT",
              "transaction": "SELL",
              "href": "/ro/oferta/garsoniera-militari-IDTEST2",
              "totalPrice": { "value": 65000, "currency": "EUR" },
              "areaInSquareMeters": 32,
              "roomsNumber": "ONE"
            }
          ],
          "pagination": { "totalItems": 2, "totalPages": 1, "currentPage": 1, "itemsPerPage": 36 }
        }
      }
    }
  }
}
</script>
</body>
</html>`;

/** Detail page with unifiedAd + contactDetails (phones for Homiio contact UI). */
export const STORIA_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="ro">
<head><title>Apartament 2 camere Titan | Storia.ro</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "id": "9001001",
      "contactDetails": {
        "name": "Agent Test",
        "type": "agency",
        "phones": ["+40700000001"],
        "imageUrl": "https://example.cdn/agent.jpg"
      },
      "ad": {
        "id": 9001001,
        "title": "Apartament 2 camere Titan",
        "slug": "apartament-2-camere-titan-IDTEST1",
        "url": "https://www.storia.ro/ro/oferta/apartament-2-camere-titan-IDTEST1",
        "description": "Apartament decomandat in Titan.",
        "images": [
          { "large": "https://example.cdn/storia/9001001-1.jpg" },
          { "large": "https://example.cdn/storia/9001001-2.jpg" }
        ],
        "location": {
          "coordinates": { "latitude": 44.41626, "longitude": 26.149668 },
          "address": { "street": { "name": "Bulevardul Camil Ressu", "number": null } },
          "reverseGeocoding": {
            "locations": [
              { "id": "bucuresti", "name": "Bucuresti", "locationLevel": "county" },
              { "id": "bucuresti/sectorul-3", "name": "Sectorul 3", "locationLevel": "sector" },
              { "id": "bucuresti/sectorul-3/titan", "name": "Titan", "locationLevel": "district" }
            ]
          }
        },
        "attributes": {
          "m": "49",
          "rooms_num": "2",
          "floor_no": "floor_1",
          "build_year": "1972",
          "market": "secondary"
        }
      },
      "unifiedAd": {
        "id": "9001001",
        "title": "Apartament 2 camere Titan",
        "description": "Apartament decomandat in Titan.",
        "price": {
          "__typename": "SalePrice",
          "salePrice": { "value": 89000, "currency": "EUR" }
        },
        "attributes": {
          "m": "49",
          "rooms_num": "2",
          "floor_no": "floor_1"
        }
      }
    }
  }
}
</script>
</body>
</html>`;

/** Rent detail (inchiriere) for LONG_TERM_RENT mapping. */
export const STORIA_FIXTURE_RENT_DETAIL_HTML = `<!doctype html>
<html lang="ro">
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "contactDetails": {
        "name": "Proprietar Test",
        "type": "private",
        "phones": ["+40700000002"]
      },
      "ad": {
        "id": 9002001,
        "title": "Apartament 3 camere inchiriere",
        "slug": "apartament-3-camere-inchiriere-IDRENT1",
        "url": "https://www.storia.ro/ro/oferta/apartament-3-camere-inchiriere-IDRENT1",
        "description": "Apartament mobilat pentru inchiriere.",
        "images": [{ "large": "https://example.cdn/storia/9002001-1.jpg" }],
        "location": {
          "coordinates": { "latitude": 44.43, "longitude": 26.1 },
          "reverseGeocoding": {
            "locations": [
              { "id": "bucuresti", "name": "Bucuresti", "locationLevel": "county" }
            ]
          }
        },
        "attributes": { "m": "78", "rooms_num": "3", "floor_no": "floor_2" }
      },
      "unifiedAd": {
        "id": "9002001",
        "title": "Apartament 3 camere inchiriere",
        "price": {
          "__typename": "RentPrice",
          "rentPrice": { "value": 750, "currency": "EUR" }
        },
        "attributes": { "m": "78", "rooms_num": "3" }
      }
    }
  }
}
</script>
</body>
</html>`;
