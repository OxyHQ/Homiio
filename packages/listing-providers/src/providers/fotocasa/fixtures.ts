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

/** searchads AJAX `{ realEstates: [...] }` discover payload. */
export const FOTOCASA_FIXTURE_SEARCHADS_JSON = JSON.stringify({
  realEstates: [
    {
      propertyId: '187654321',
      detailUrl: '/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d',
      transaction: { type: 'RENT', price: 1850 },
      rooms: 3,
      baths: 2,
      surface: 95,
    },
    {
      propertyId: '187654322',
      detailUrl: 'https://www.fotocasa.es/es/alquiler/vivienda/madrid-capital/terraza/187654322/d',
      transaction: { type: 'RENT', price: 1200 },
    },
    {
      id: '187654323',
      uris: [{ value: '/es/alquiler/vivienda/madrid-capital/exterior/187654323/d' }],
    },
  ],
  totalItems: 3,
});

/** Build a searchads page fixture with distinct property ids. */
export function fotocasaSearchadsPageFixture(page: number, count = 2): string {
  const baseId = page * 100_000;
  const realEstates = Array.from({ length: count }, (_, index) => ({
    propertyId: String(baseId + index),
    detailUrl: `/es/alquiler/vivienda/madrid-capital/page-${page}/${baseId + index}/d`,
  }));
  return JSON.stringify({ realEstates, pageNumber: page, totalItems: count });
}

/** urllocationsegments AJAX response for Madrid-capital. */
export const FOTOCASA_FIXTURE_LOCATION_SEGMENTS_JSON = JSON.stringify({
  ids: '724,14,28,173,0,28079,0,0,0',
  coordinates: { latitude: 40.4096, longitude: -3.68624 },
});

/** PerimeterX challenge HTML served instead of searchads/property JSON. */
export const FOTOCASA_FIXTURE_SEARCHADS_CHALLENGE =
  '<!DOCTYPE html><html><body><div id="px-captcha">Verifica que eres una persona</div></body></html>';

/**
 * A REAL Fotocasa searchads card (Barcelona long-term rental, id 186718824),
 * captured 2026-07-11 via a warmed PerimeterX Playwright session through a
 * residential ES proxy and trimmed to the fields the parser reads (multimedia
 * cut to three images, description shortened). This is the exact shape the
 * discover searchads path hands `fotocasaRecordToListing` in production, so it
 * pins the bug that shipped `bedrooms/bathrooms/m²/amenities/contact` empty:
 *
 *   - dimensions live in `features[]` as `{ key, value }` (`rooms`/`bathrooms`/
 *     `surface`/`floor`), NOT as top-level `rooms`/`baths`/`surface`;
 *   - amenities are English snake_case `features[].key` values (`elevator`,
 *     `parking`, `terrace`, …), NOT localized labels;
 *   - the advertiser is the TOP-LEVEL `phone` + `clientAlias` (+ `clientType`),
 *     NOT a nested `contactInfo` node;
 *   - price is `rawPrice`, the detail path is `detail["es-ES"]`, coordinates are
 *     under `coordinates`, and the postal code is `address.zipCode`.
 */
export const FOTOCASA_FIXTURE_SEARCH_CARD: Record<string, unknown> = {
  id: 186718824,
  buildingType: 'Flat',
  buildingSubtype: 'Flat',
  clientAlias: 'Nolkers Consulting',
  clientId: 9202768176409,
  clientType: 'professional',
  clientTypeId: 3,
  description:
    'Ubicado en el exclusivo barrio de tres torres, se ubica este magnífico piso de 223 m2. Vivienda completamente exterior con entrada principal y servicio. Amplio salón comedor con salida a terraza.',
  detail: {
    'es-ES':
      '/es/alquiler/vivienda/barcelona-capital/calefaccion-parking-jardin-terraza-ascensor-se-aceptan-mascotas-no-amueblado/186718824/d',
  },
  detailWithParams: {
    'es-ES':
      '/es/alquiler/vivienda/barcelona-capital/calefaccion-parking-jardin-terraza-ascensor-se-aceptan-mascotas-no-amueblado/186718824/d?from=list',
  },
  address: {
    country: 'España',
    district: 'Sarrià - Sant Gervasi',
    neighborhood: 'Les Tres Torres',
    zipCode: '08017',
    municipality: 'Barcelona',
    province: 'Barcelona',
    city: 'Barcelona',
    regionLevel1: 'Cataluña',
  },
  coordinates: { latitude: 41.39739562695459, longitude: 2.1289727231295443, accuracy: 0 },
  location: 'Les Tres Torres',
  features: [
    { key: 'cabinets', value: 2, maxValue: 0, minValue: 0 },
    { key: 'heating', value: 3, maxValue: 0, minValue: 0 },
    { key: 'parking', value: 5, maxValue: 0, minValue: 0 },
    { key: 'private_garden', value: 7, maxValue: 0, minValue: 0 },
    { key: 'parquet', value: 9, maxValue: 0, minValue: 0 },
    { key: 'terrace', value: 10, maxValue: 0, minValue: 0 },
    { key: 'elevator', value: 13, maxValue: 0, minValue: 0 },
    { key: 'household_appliances', value: 21, maxValue: 0, minValue: 0 },
    { key: 'porter_service', value: 28, maxValue: 0, minValue: 0 },
    { key: 'pets_allowed', value: 49, maxValue: 0, minValue: 0 },
    { key: 'laundry', value: 109, maxValue: 0, minValue: 0 },
    { key: 'not_furnished', value: 130, maxValue: 0, minValue: 0 },
    { key: 'equiped_kitchen', value: 131, maxValue: 0, minValue: 0 },
    { key: 'bathrooms', value: 4, maxValue: 0, minValue: 0 },
    { key: 'conservationStatus', value: 3, maxValue: 0, minValue: 0 },
    { key: 'floor', value: 10, maxValue: 0, minValue: 0 },
    { key: 'rooms', value: 5, maxValue: 0, minValue: 0 },
    { key: 'surface', value: 223, maxValue: 0, minValue: 0 },
  ],
  multimedia: [
    { type: 'image', src: 'https://static.fotocasa.es/images/ads/20f35295-0d38-4444-a929-e06b3888a72a?rule=original', roomType: null },
    { type: 'image', src: 'https://static.fotocasa.es/images/ads/fc9a9543-b9b2-4f39-b9bf-aff5e102d2dc?rule=original', roomType: null },
    { type: 'image', src: 'https://static.fotocasa.es/images/ads/bba58a62-8849-4274-9d0e-1a66179d7a8d?rule=original', roomType: null },
  ],
  phone: '+34670501198',
  price: '3.690 €',
  rawPrice: 3690,
  periodicityId: 3,
  transactionTypeId: 3,
  typeId: 2,
};

/**
 * The same real card served as a `/property` JSON body (the property API returns
 * the same record shape). Exercises the `parseFotocasaPropertyJson` path.
 */
export const FOTOCASA_FIXTURE_PROPERTY_JSON = JSON.stringify(FOTOCASA_FIXTURE_SEARCH_CARD);

/** SSR search HTML embedding a `realEstates` JSON array. */
export const FOTOCASA_FIXTURE_SSR_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<script>window.__STATE__={"realEstates":[{"propertyId":"187654321","detailUrl":"/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d"},{"propertyId":"187654322","detailUrl":"/es/alquiler/vivienda/madrid-capital/terraza/187654322/d"}],"pageNumber":1};</script>
<main class="re-Searchresult"><h1>Alquiler Madrid</h1></main>
</body></html>`;
