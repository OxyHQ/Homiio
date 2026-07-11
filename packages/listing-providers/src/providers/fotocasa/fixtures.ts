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
 * Property detail JSON from `web.gw.fotocasa.es/.../property` (called with
 * `language=es`, so `features` labels are localized). Models the `features`
 * equipment array, structured `floor`, and the advertiser `contactInfo` node the
 * detail payload carries so the parser exercises amenity/floor/contact extraction.
 */
export const FOTOCASA_FIXTURE_PROPERTY_JSON = JSON.stringify({
  propertyId: '187654321',
  title: 'Piso en alquiler en Calle de Almagro',
  description: 'Piso reformado de tres habitaciones en Chamberí, con calefacción y ascensor.',
  detailUrl: '/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d',
  transaction: { type: 'RENT', price: 1850 },
  rooms: 3,
  baths: 2,
  surface: 95,
  floor: 3,
  street: 'Calle de Almagro',
  number: '30',
  address: {
    country: 'España',
    district: 'Chamberí',
    municipality: 'Madrid',
    province: 'Madrid',
  },
  location: { latitude: '40.4318', longitude: '-3.6931' },
  features: [
    { name: 'Ascensor', value: true },
    { name: 'Aire acondicionado', value: true },
    { name: 'Calefacción', value: true },
    { name: 'Terraza', value: true },
    { name: 'Amueblado', value: true },
    { name: 'Parking', value: false },
    { name: 'Buen estado', value: true },
    'Piscina',
  ],
  contactInfo: {
    phone: '911234567',
    email: 'agente@example-inmobiliaria.es',
    contactName: 'Agente Almagro',
    agencyName: 'Inmobiliaria Almagro',
  },
  multimedia: [
    { url: 'https://static.fotocasa.es/images/anuncios/187654321/1.jpg', type: 'image' },
    { url: 'https://static.fotocasa.es/images/anuncios/187654321/2.jpg', type: 'image' },
  ],
});

/** SSR search HTML embedding a `realEstates` JSON array. */
export const FOTOCASA_FIXTURE_SSR_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<script>window.__STATE__={"realEstates":[{"propertyId":"187654321","detailUrl":"/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d"},{"propertyId":"187654322","detailUrl":"/es/alquiler/vivienda/madrid-capital/terraza/187654322/d"}],"pageNumber":1};</script>
<main class="re-Searchresult"><h1>Alquiler Madrid</h1></main>
</body></html>`;
