/**
 * Immobiliare.it fixtures — `__NEXT_DATA__` JSON is the primary payload shape.
 */

export const IMMOBILIARE_BASE_URL = 'https://www.immobiliare.it';

/** Search-list AJAX-shaped JSON (portal-shaped, hand-authored). */
export const IMMOBILIARE_FIXTURE_SEARCH_JSON = `{
  "count": 3,
  "results": [
    {
      "id": 112233445,
      "seoUrl": "https://www.immobiliare.it/annunci/112233445/",
      "title": "Bilocale via del Corso",
      "price": { "value": 1450 },
      "surface": 58,
      "rooms": 2,
      "bathrooms": 1,
      "typology": { "name": "Appartamento" },
      "contract": "affitto",
      "location": {
        "city": "Roma",
        "province": "Roma",
        "region": "Lazio",
        "macrozone": "Centro",
        "latitude": 41.9028,
        "longitude": 12.4964,
        "address": "Via del Corso 10"
      },
      "medias": [
        { "url": "https://pic.immobiliare.it/112233445/1.jpg" },
        { "url": "https://pic.immobiliare.it/112233445/2.jpg" }
      ],
      "advertiser": {
        "agencyName": "Immobiliare Centro SRL",
        "phone": "+39 06 98765432",
        "email": "contatti@immobiliarecentro.example",
        "whatsapp": "393339876543",
        "type": "agency"
      }
    },
    {
      "id": 112233446,
      "url": "/annunci/112233446/",
      "price": { "value": 1200 },
      "location": { "city": "Roma", "address": "Via Veneto 5" }
    },
    {
      "realEstate": { "id": 112233447 },
      "link": "https://www.immobiliare.it/annunci/112233447/"
    }
  ]
}`;

/** Detail `__NEXT_DATA__` page (JSON-first). */
export const IMMOBILIARE_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="it">
<head><title>Bilocale via del Corso — Immobiliare.it</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "detailData": {
        "realEstate": {
          "id": 112233445,
          "title": "Bilocale via del Corso",
          "price": { "value": 1450 },
          "surface": 58,
          "rooms": 2,
          "bathrooms": 1,
          "floor": 3,
          "description": "Bilocale luminoso in centro storico, arredato.",
          "contract": "affitto",
          "typology": { "name": "Appartamento" },
          "properties": [
            {
              "surface": 58,
              "rooms": 2,
              "bathrooms": 1,
              "floor": "3",
              "ga4Garage": "No",
              "ga4Heating": "Autonomo"
            }
          ],
          "location": {
            "city": "Roma",
            "province": "Roma",
            "region": "Lazio",
            "macrozone": "Centro",
            "latitude": 41.9028,
            "longitude": 12.4964,
            "address": "Via del Corso 10",
            "postalCode": "00186"
          },
          "photos": [
            { "urls": { "large": "https://pic.immobiliare.it/112233445/1.jpg" } },
            { "urls": { "large": "https://pic.immobiliare.it/112233445/2.jpg" } }
          ],
          "advertiser": {
            "agency": {
              "displayName": "Immobiliare Centro SRL",
              "phone": "+39 06 98765432",
              "email": "contatti@immobiliarecentro.example",
              "whatsappPhone": "393339876543",
              "type": "agency"
            }
          }
        },
        "seoData": {
          "url": "https://www.immobiliare.it/annunci/112233445/"
        }
      }
    }
  }
}
</script>
</body>
</html>`;

export const IMMOBILIARE_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="it"><body>
<a href="/annunci/112233445/">listing</a>
<a href="https://www.immobiliare.it/annunci/112233446/">listing2</a>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"dehydratedState":{"queries":[{"state":{"data":{"results":[{"id":112233447,"seoUrl":"https://www.immobiliare.it/annunci/112233447/"}]}}}]}}}}
</script>
</body></html>`;
