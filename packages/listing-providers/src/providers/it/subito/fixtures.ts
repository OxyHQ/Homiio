/**
 * Subito.it housing fixtures. General classifieds — housing category only.
 */

export const SUBITO_BASE_URL = 'https://www.subito.it';

/** Housing category path segments allowed for discover. */
export const SUBITO_HOUSING_CATEGORIES = [
  'appartamenti',
  'camere-posti-letto',
  'ville-singole-e-a-schiera',
  'terreni-e-rustici',
  'garage-e-box',
  'uffici-e-locali-commerciali',
] as const;

export const SUBITO_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="it">
<head>
<title>Appartamento a Milano 2 locali — Subito</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Appartamento a Milano 2 locali",
  "description": "Bilocale arredato vicino alla metro.",
  "url": "https://www.subito.it/appartamenti/appartamento-a-milano-2-locali-milano-632623436.htm",
  "image": ["https://images.subito.it/632623436/1.jpg"],
  "offers": {
    "@type": "Offer",
    "price": "1000",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address": {
    "@type": "PostalAddress",
    "addressLocality": "Milano",
    "addressRegion": "Lombardia",
    "addressCountry": "IT"
  }
}
</script>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "ad": {
        "urn": "id:ad:632623436:list:1001",
        "subject": "Appartamento a Milano 2 locali",
        "body": "Bilocale arredato vicino alla metro.",
        "category": { "label": "Appartamenti", "uri": "/appartamenti" },
        "features": {
          "rooms": { "value": "2" },
          "bathroom": { "value": "1" },
          "size": { "value": "51" },
          "furnished": { "value": "1" }
        },
        "geo": {
          "city": { "value": "Milano" },
          "region": { "value": "Lombardia" },
          "town": { "value": "Milano" }
        },
        "price": { "value": 1000 },
        "urls": { "default": "https://www.subito.it/appartamenti/appartamento-a-milano-2-locali-milano-632623436.htm" },
        "images": [{ "cdnBaseUrl": "https://images.subito.it/632623436/1.jpg" }],
        "advertiser": {
          "name": "Tempocasa Milano",
          "phones": [{ "value": "+39 02 55667788" }],
          "type": 1
        }
      }
    }
  }
}
</script>
</head>
<body><main><h1>Appartamento a Milano 2 locali</h1></main></body>
</html>`;

/** Non-housing fixture — must be rejected by normalize. */
export const SUBITO_FIXTURE_NON_HOUSING_HTML = `<!doctype html>
<html lang="it">
<head>
<script id="__NEXT_DATA__" type="application/json">
{
  "props": {
    "pageProps": {
      "ad": {
        "urn": "id:ad:999888777:list:2",
        "subject": "Fiat Punto usata",
        "category": { "label": "Auto", "uri": "/auto" },
        "price": { "value": 3500 },
        "urls": { "default": "https://www.subito.it/auto/fiat-punto-salerno-999888777.htm" },
        "geo": { "city": { "value": "Salerno" } }
      }
    }
  }
}
</script>
</head>
<body></body>
</html>`;

export const SUBITO_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="it"><body>
<a href="/appartamenti/appartamento-a-milano-2-locali-milano-632623436.htm">a</a>
<a href="https://www.subito.it/appartamenti/trilocale-milano-632623437.htm">b</a>
<a href="/auto/fiat-punto-999888777.htm">car — must be ignored by housing search parser</a>
</body></html>`;

export const SUBITO_FIXTURE_SEARCH_JSON = `{
  "ads": [
    {
      "urn": "id:ad:632623436:list:1001",
      "urls": { "default": "https://www.subito.it/appartamenti/appartamento-a-milano-2-locali-milano-632623436.htm" },
      "category": { "uri": "/appartamenti" }
    },
    {
      "urn": "id:ad:632623437:list:1001",
      "urls": { "default": "https://www.subito.it/appartamenti/trilocale-milano-632623437.htm" },
      "category": { "uri": "/appartamenti" }
    },
    {
      "urn": "id:ad:999888777:list:2",
      "urls": { "default": "https://www.subito.it/auto/fiat-punto-999888777.htm" },
      "category": { "uri": "/auto" }
    }
  ]
}`;
