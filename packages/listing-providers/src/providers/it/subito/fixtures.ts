/**
 * Subito.it housing fixtures. General classifieds — housing category only.
 *
 * Shapes mirror the real portal: the search page embeds full ad objects in
 * `__NEXT_DATA__` at `props.pageProps.initialState.items.originalList`, each ad
 * carrying price/size/rooms inside a `features` dict keyed by `/price`, `/size`,
 * `/room`, … and its offering encoded in `type.key` (`u` = affitto, `s` =
 * vendita). Images are CDN base URLs that need a `?rule=…` query to render.
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

/** A real-shaped housing ad node (`originalList[i]`). */
function housingAd(id: string, subject: string, price: string, rooms: string): string {
  return `{
    "kind": "AdItem",
    "urn": "id:ad:${id}00:list:${id}",
    "type": { "key": "u", "value": "In affitto", "weight": 0 },
    "category": { "id": "7", "label": "Appartamenti", "friendlyName": "appartamenti" },
    "subject": "${subject}",
    "body": "Bilocale arredato vicino alla metro.",
    "images": [{ "cdnBaseUrl": "https://images.sbito.it/api/v1/sbt-ads-images-pro/images/c8/${id}" }],
    "features": {
      "/price": { "type": "number", "uri": "/price", "label": "Affitto mensile", "values": [{ "key": "${price}", "value": "${price} €" }] },
      "/size": { "type": "number", "uri": "/size", "label": "Superficie", "values": [{ "key": "51", "value": "51 mq" }] },
      "/room": { "type": "list", "uri": "/room", "label": "Locali", "values": [{ "key": "${rooms}", "value": "${rooms}" }] },
      "/bathrooms": { "type": "list", "uri": "/bathrooms", "label": "Bagni", "values": [{ "key": "1", "value": "1" }] },
      "/furnished": { "type": "bool", "uri": "/furnished", "label": "Arredato", "values": [{ "key": "1", "value": "Sì" }] }
    },
    "geo": {
      "region": { "value": "Lombardia" },
      "city": { "value": "Milano", "label": "Provincia" },
      "town": { "value": "Milano" }
    },
    "advertiser": { "name": "Tempocasa Milano", "company": true, "phone": "+39 02 55667788", "shopName": "Tempocasa Milano" },
    "urls": { "default": "https://www.subito.it/appartamenti/${subject
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')}-milano-${id}.htm" }
  }`;
}

const AD_632623436 = housingAd('632623436', 'Appartamento a Milano 2 locali', '1000', '2');
const AD_632623437 = housingAd('632623437', 'Trilocale Milano', '1400', '3');

/** A non-housing ad node (must be rejected by the housing guards). */
const AD_AUTO_999888777 = `{
    "kind": "AdItem",
    "urn": "id:ad:99988877700:list:999888777",
    "type": { "key": "s", "value": "In vendita", "weight": 0 },
    "category": { "id": "1", "label": "Auto", "friendlyName": "auto" },
    "subject": "Fiat Punto usata",
    "features": { "/price": { "type": "number", "uri": "/price", "label": "Prezzo", "values": [{ "key": "3500", "value": "3500 €" }] } },
    "geo": { "city": { "value": "Salerno" } },
    "urls": { "default": "https://www.subito.it/auto/fiat-punto-salerno-999888777.htm" }
  }`;

function searchPage(ads: string[]): string {
  return `<!doctype html>
<html lang="it"><head><title>Appartamenti in affitto Milano — Subito</title></head>
<body>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"pageName":"listing","initialState":{"items":{"total":${ads.length},"totalPages":1,"originalList":[${ads.join(',')}],"galleryList":[]}}}}}
</script>
</body></html>`;
}

export const SUBITO_FIXTURE_DETAIL_HTML = searchPage([AD_632623436]);

/** Non-housing detail — must be rejected by parse/normalize. */
export const SUBITO_FIXTURE_NON_HOUSING_HTML = searchPage([AD_AUTO_999888777]);

/** Search page with two housing ads plus one car (car must be filtered out). */
export const SUBITO_FIXTURE_SEARCH_HTML = searchPage([AD_632623436, AD_632623437, AD_AUTO_999888777]);

/** Portal-shaped JSON search response (housing categories + one car to reject). */
export const SUBITO_FIXTURE_SEARCH_JSON = `{
  "ads": [
    {
      "urn": "id:ad:632623436:list:632623436",
      "urls": { "default": "https://www.subito.it/appartamenti/appartamento-a-milano-2-locali-milano-632623436.htm" },
      "category": { "uri": "/appartamenti" }
    },
    {
      "urn": "id:ad:632623437:list:632623437",
      "urls": { "default": "https://www.subito.it/appartamenti/trilocale-milano-632623437.htm" },
      "category": { "uri": "/appartamenti" }
    },
    {
      "urn": "id:ad:999888777:list:999888777",
      "urls": { "default": "https://www.subito.it/auto/fiat-punto-999888777.htm" },
      "category": { "uri": "/auto" }
    }
  ]
}`;
