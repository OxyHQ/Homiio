/**
 * Recorded Fotocasa fixtures for unit tests.
 *
 * Hand-authored, portal-SHAPED HTML snapshots (NOT copies of real listings)
 * modelling the schema.org JSON-LD a Fotocasa detail page ships and the detail
 * links a search page carries. They exercise the full parse → normalize path
 * without touching the live portal (behind anti-bot walls; feature flag OFF).
 *
 * Fotocasa is a Next.js app whose detail URLs end in `…/<id>/d`. `image` URLs
 * point at an example CDN host and are used ONCE at ingest to re-host bytes via
 * Sharp/S3 — never hotlinked at runtime.
 */

export const FOTOCASA_BASE_URL = 'https://www.fotocasa.es';

/** A rent detail page carrying the listing as schema.org JSON-LD. */
export const FOTOCASA_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Piso en alquiler en Chamberí, Madrid — Fotocasa</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["Residence", "Product"],
  "name": "Piso en alquiler en Calle de Almagro",
  "description": "Piso reformado de tres habitaciones en Chamberí, con calefacción y ascensor.",
  "url": "https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d",
  "image": [
    "https://static.fotocasa.es/images/anuncios/187654321/1.jpg",
    "https://static.fotocasa.es/images/anuncios/187654321/2.jpg",
    "https://static.fotocasa.es/images/anuncios/187654321/3.jpg"
  ],
  "numberOfRooms": 3,
  "numberOfBathroomsTotal": 2,
  "floorSize": { "@type": "QuantitativeValue", "value": "95", "unitCode": "MTK" },
  "amenityFeature": [
    { "@type": "LocationFeatureSpecification", "name": "Ascensor", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Calefacción", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Aire acondicionado", "value": true }
  ],
  "offers": {
    "@type": "Offer",
    "price": "1850",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Calle de Almagro 30",
    "addressLocality": "Madrid",
    "addressRegion": "Madrid",
    "addressSubLocality": "Chamberí",
    "postalCode": "28010",
    "addressCountry": "ES"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 40.4318, "longitude": -3.6931 }
}
</script>
</head>
<body><main><h1>Piso en alquiler en Calle de Almagro</h1></main></body>
</html>`;

/** A search-results page carrying several Fotocasa detail links. */
export const FOTOCASA_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<div class="re-Searchresult">
  <a class="re-Card-link" href="/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d">Piso 1</a>
  <a class="re-Card-link" href="https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/terraza/187654322/d">Piso 2</a>
  <a class="re-Card-link" href="/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d">Duplicate</a>
  <a class="re-Card-link" href="/es/alquiler/vivienda/madrid-capital/exterior/187654323/d">Estudio</a>
</div>
</body></html>`;

/** Fotocasa detail page using schema.org RealEstateListing with nested `about`. */
export const FOTOCASA_FIXTURE_REAL_ESTATE_LISTING_HTML = `<!doctype html>
<html lang="es">
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "RealEstateListing",
  "name": "Piso en alquiler en Calle de Almagro",
  "description": "Piso reformado de tres habitaciones en Chamberí.",
  "url": "https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d",
  "offers": {
    "@type": "Offer",
    "price": "1850",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "about": {
    "@type": "Apartment",
    "numberOfRooms": 3,
    "numberOfBathroomsTotal": 2,
    "floorSize": { "@type": "QuantitativeValue", "value": "95", "unitCode": "MTK" },
    "image": ["https://static.fotocasa.es/images/anuncios/187654321/1.jpg"],
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Calle de Almagro 30",
      "addressLocality": "Madrid",
      "addressRegion": "Madrid",
      "postalCode": "28010",
      "addressCountry": "ES"
    },
    "geo": { "@type": "GeoCoordinates", "latitude": 40.4318, "longitude": -3.6931 }
  }
}
</script>
</head>
<body></body>
</html>`;

/** Detail page with listing data only in __NEXT_DATA__ (no JSON-LD). */
export const FOTOCASA_FIXTURE_NEXT_DATA_HTML = `<!doctype html>
<html lang="es">
<head>
<script id="__NEXT_DATA__" type="application/json">{
  "props": {
    "pageProps": {
      "realEstate": {
        "id": 187654321,
        "title": "Piso en alquiler en Chamberí",
        "description": "Piso reformado con ascensor.",
        "url": "https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d",
        "price": 1850,
        "currency": "EUR",
        "rooms": 3,
        "bathrooms": 2,
        "surface": 95,
        "address": {
          "streetAddress": "Calle de Almagro 30",
          "addressLocality": "Madrid",
          "addressRegion": "Madrid",
          "postalCode": "28010",
          "addressCountry": "ES"
        },
        "geo": { "latitude": 40.4318, "longitude": -3.6931 },
        "images": ["https://static.fotocasa.es/images/anuncios/187654321/1.jpg"]
      }
    }
  }
}</script>
</head>
<body></body>
</html>`;

/**
 * Recorded searchads AJAX JSON (portal-shaped, hand-authored).
 *
 * Fotocasa's `web.gw.fotocasa.es/v2/propertysearch/searchads` returns
 * `{ realEstates: [{ propertyId, detailUrl, price, ... }] }`. Used only in unit tests.
 */
export const FOTOCASA_FIXTURE_SEARCHADS_JSON = `{
  "total": 3,
  "pageNumber": 1,
  "realEstates": [
    {
      "propertyId": 187654321,
      "detailUrl": "/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d",
      "transactionType": "RENT",
      "price": { "amount": 1850 }
    },
    {
      "propertyId": 187654322,
      "detailUrl": "https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/terraza/187654322/d",
      "transactionType": "RENT",
      "price": { "amount": 1600 }
    },
    {
      "propertyId": 187654323,
      "detailUrl": "/es/alquiler/vivienda/madrid-capital/exterior/187654323/d",
      "transactionType": "RENT",
      "price": { "amount": 1200 }
    }
  ]
}`;

/** urllocationsegments JSON for Madrid-capital (portal-shaped). */
export const FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON = `{
  "ids": "724,14,28,173,0,28079,0,0,0",
  "coordinates": { "latitude": 40.4096, "longitude": -3.68624 },
  "locationLiteral": "Madrid"
}`;

/** PerimeterX challenge HTML returned instead of searchads JSON when cold/blocked. */
export const FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE = `<!DOCTYPE html><html><head><title>SENTIMOS LA INTERRUPCIÓN</title></head><body></body></html>`;

/** Property detail JSON from `web.gw.fotocasa.es/.../property` (portal-shaped). */
export const FOTOCASA_FIXTURE_PROPERTY_JSON = `{
  "propertyId": "187654321",
  "description": "Piso reformado de tres habitaciones en Chamberí.",
  "rooms": 3,
  "baths": 2,
  "surface": 95,
  "transactionType": "RENT",
  "zipCode": "28010",
  "street": "Calle de Almagro 30",
  "uris": [
    { "value": "/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d", "language": "es_ES" }
  ],
  "prices": [{ "amount": 1850 }],
  "location": {
    "latitude": 40.4318,
    "longitude": -3.6931,
    "level5Name": "Madrid",
    "level2Name": "Madrid",
    "level7Name": "Chamberí"
  },
  "multimedia": [
    { "url": "https://static.fotocasa.es/images/anuncios/187654321/1.jpg", "type": "2", "position": 1 }
  ]
}`;

/** SSR search page embedding realEstates (no separate searchads XHR). */
export const FOTOCASA_FIXTURE_SSR_SEARCH_HTML = `<!doctype html><html><body><script>{
  "realEstates": [
    { "propertyId": 187654321, "detailUrl": "/es/alquiler/vivienda/madrid-capital/x/187654321/d" },
    { "propertyId": 187654324, "detailUrl": "/es/alquiler/vivienda/madrid-capital/x/187654324/d" }
  ],
  "total": 2
}</script></body></html>`;
