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
/**
 * The SSR search payload the LIVE site serves, captured 2026-09-20 from a
 * Barcelona rental search through the production residential proxy. Three
 * listings, two images each, descriptions cut; every other field shape is the
 * portal's own.
 *
 * **THIS EXISTS BECAUSE THE FIXTURE BELOW STOPPED RESEMBLING THE SITE.** That
 * one carries `window.__STATE__={"realEstates":[{propertyId, detailUrl}]}`;
 * the live page carries `<script id="__initial_props__">` with
 * `initialSearch.result.realEstates` and `id` / `detail`. Both parse, so the
 * suite stayed green while production collected ONE ref from a page holding
 * thirty — a fixture that has drifted from reality cannot fail for the right
 * reason. Re-capture this one when the portal changes rather than editing it
 * to match a parser.
 */
export const FOTOCASA_FIXTURE_SSR_SEARCH_HTML_LIVE =
  '<!doctype html><html lang="es"><head></head><body>' +
  '<script id="__initial_props__" type="application/json">' +
  "{\"initialSearch\":{\"result\":{\"realEstates\":[{\"accuracy\":false,\"address\":{\"country\":\"España\",\"district\":\"Sant Andreu\",\"neighborhood\":\"La Sagrera\",\"zipCode\":\"08027\",\"municipality\":\"Barcelona\",\"province\":\"Barcelona\",\"city\":\"Barcelona\",\"cityZone\":null,\"county\":\"Barcelonès\",\"regionLevel1\":\"Cataluña\",\"regionLevel2\":\"Barcelona\",\"upperLevel\":\"La Sagrera\"},\"brandInfo\":{\"barColor\":\"#0E0D70\",\"logo\":null,\"textColor\":\"#FFFFFF\"},\"buildingSubtype\":\"Flat\",\"buildingType\":\"Flat\",\"clientAlias\":\"Spotahome\",\"clientId\":9202774813254,\"clientType\":\"professional\",\"clientTypeId\":3,\"clientUrl\":\"/es/pro/spotahome-5/\",\"coordinates\":{\"latitude\":41.4235221164913,\"longitude\":2.185777884149343,\"accuracy\":0},\"date\":{\"diff\":10,\"unit\":\"HOURS\",\"timestamp\":1789862409567},\"dateOriginal\":{\"diff\":10,\"unit\":\"HOURS\",\"timestamp\":1789862409567},\"description\":\"Descubre este encantador apartamento de 2 habitaciones en La Sagrera. La propiedad está completamente amueblada y cuenta\",\"detail\":{\"es-ES\":\"/es/alquiler/vivienda/barcelona-capital/aire-acondicionado-calefaccion-amueblado-internet/190879649/d\"},\"detailWithParams\":{\"es-ES\":\"/es/alquiler/vivienda/barcelona-capital/aire-acondicionado-calefaccion-amueblado-internet/190879649/d?from=list\"},\"dynamicFeatures\":[\"IS_EXTERIOR\"],\"externalContactUrl\":null,\"features\":[{\"key\":\"air_conditioner\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"heating\",\"value\":3,\"maxValue\":0,\"minValue\":0},{\"key\":\"furnished\",\"value\":19,\"maxValue\":0,\"minValue\":0},{\"key\":\"balcony\",\"value\":32,\"maxValue\":0,\"minValue\":0},{\"key\":\"internet\",\"value\":52,\"maxValue\":0,\"minValue\":0},{\"key\":\"equiped_kitchen\",\"value\":131,\"maxValue\":0,\"minValue\":0},{\"key\":\"bathrooms\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"rooms\",\"value\":2,\"maxValue\":0,\"minValue\":0},{\"key\":\"surface\",\"value\":68,\"maxValue\":0,\"minValue\":0}],\"hasListLogo\":true,\"hasPhoneVisibility\":false,\"hasSubsidies\":false,\"hasVideo\":0,\"hasQualitySeal\":false,\"hasFloorPlans\":false,\"id\":190879649,\"isBareOwnership\":false,\"isCompleted\":null,\"isDiscarded\":false,\"isExternalContact\":false,\"isHighlighted\":false,\"isMainTypology\":false,\"isNew\":true,\"isNewConstruction\":false,\"isOccupied\":false,\"isAuctioned\":false,\"isRentedWithTenants\":false,\"isOpportunity\":false,\"isPackAdvancePriority\":false,\"isPackBasicPriority\":false,\"isPackMinimalPriority\":false,\"isPackPremiumPriority\":false,\"isPremium\":false,\"isPromotion\":false,\"isTemporaryRental\":true,\"isTop\":false,\"isTopPlus\":false,\"isTrackedPhone\":null,\"isVirtualTour\":false,\"isVisited\":false,\"hasOpenHouse\":false,\"location\":\"La Sagrera\",\"minPrice\":0,\"multimedia\":[{\"type\":\"image\",\"src\":\"https://static.fotocasa.es/images/ads/1b2bdb69-be6d-4816-aaac-72dacb15a222?rule=original\",\"roomType\":\"bathroom\"},{\"type\":\"image\",\"src\":\"https://static.fotocasa.es/images/ads/89257593-a6d9-4c18-a234-23d28645728e?rule=original\",\"roomType\":\"bedroom\"}],\"otherFeaturesCount\":0,\"periodicityId\":3,\"phone\":null,\"price\":\"2.000 €\",\"promotionId\":0,\"promotionLogo\":\"https://static.fotocasa.es/images/client/b36f634a-a17b-4290-b804-c693e11bec8a/20250506164632?rule=original\",\"promotionUrl\":null,\"promotionTitle\":null,\"promotionTypologiesCounter\":null,\"promotionTypologies\":[],\"parent\":null,\"publisherId\":\"b36f634a-a17b-4290-b804-c693e11bec8a\",\"rawPrice\":2000,\"realEstateAdId\":\"59c813d0-ebcf-42c0-aa79-7cded568505e\",\"reducedPrice\":null,\"subtypeId\":1,\"transactionTypeId\":3,\"typeId\":2,\"userId\":null},{\"accuracy\":false,\"address\":{\"country\":\"España\",\"district\":\"Ciutat Vella\",\"neighborhood\":\"La Barceloneta\",\"zipCode\":\"08003\",\"municipality\":\"Barcelona\",\"province\":\"Barcelona\",\"city\":\"Barcelona\",\"cityZone\":null,\"county\":\"Barcelonès\",\"regionLevel1\":\"Cataluña\",\"regionLevel2\":\"Barcelona\",\"upperLevel\":\"La Barceloneta\"},\"brandInfo\":{\"barColor\":\"#F5F5F5\",\"logo\":null,\"textColor\":\"#1D1D1D\"},\"buildingSubtype\":\"Flat\",\"buildingType\":\"Flat\",\"clientAlias\":\"On Urbe - Pisos Sant Antoni Mar\",\"clientId\":9202762863451,\"clientType\":\"professional\",\"clientTypeId\":3,\"clientUrl\":\"/es/pro/on-urbe-pisos-sant-antoni-mar/\",\"coordinates\":{\"latitude\":41.37874391319404,\"longitude\":2.1885139662160764,\"accuracy\":0},\"date\":{\"diff\":21,\"unit\":\"HOURS\",\"timestamp\":1789825246470},\"dateOriginal\":{\"diff\":21,\"unit\":\"HOURS\",\"timestamp\":1789825246470},\"description\":\"VIVE EL SUEÑO MEDITERRÁNEO EN LA BARCELONETA – PISO REFORMADO Y EQUIPADO A 5 MINUTOS DEL MAR\\n\\n\\nDescubre este acogedor pi\",\"detail\":{\"es-ES\":\"/es/alquiler/vivienda/barcelona-capital/aire-acondicionado-calefaccion-amueblado-television/190877064/d\"},\"detailWithParams\":{\"es-ES\":\"/es/alquiler/vivienda/barcelona-capital/aire-acondicionado-calefaccion-amueblado-television/190877064/d?from=list\"},\"dynamicFeatures\":[\"HAS_VIEW_TO_BEACH\",\"IS_EXTERIOR\",\"IS_ON_SEAFRONT\"],\"externalContactUrl\":null,\"features\":[{\"key\":\"air_conditioner\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"heating\",\"value\":3,\"maxValue\":0,\"minValue\":0},{\"key\":\"ceramic_stoneware\",\"value\":6,\"maxValue\":0,\"minValue\":0},{\"key\":\"furnished\",\"value\":19,\"maxValue\":0,\"minValue\":0},{\"key\":\"household_appliances\",\"value\":21,\"maxValue\":0,\"minValue\":0},{\"key\":\"oven\",\"value\":22,\"maxValue\":0,\"minValue\":0},{\"key\":\"washing_machine\",\"value\":23,\"maxValue\":0,\"minValue\":0},{\"key\":\"microwave\",\"value\":24,\"maxValue\":0,\"minValue\":0},{\"key\":\"fridge\",\"value\":25,\"maxValue\":0,\"minValue\":0},{\"key\":\"tv\",\"value\":29,\"maxValue\":0,\"minValue\":0},{\"key\":\"equiped_kitchen\",\"value\":131,\"maxValue\":0,\"minValue\":0},{\"key\":\"antiquity\",\"value\":8,\"maxValue\":0,\"minValue\":0},{\"key\":\"bathrooms\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"floor\",\"value\":3,\"maxValue\":0,\"minValue\":0},{\"key\":\"hotWater\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"rooms\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"surface\",\"value\":40,\"maxValue\":0,\"minValue\":0}],\"hasListLogo\":true,\"hasPhoneVisibility\":true,\"hasSubsidies\":false,\"hasVideo\":0,\"hasQualitySeal\":false,\"hasFloorPlans\":false,\"id\":190877064,\"isBareOwnership\":false,\"isCompleted\":null,\"isDiscarded\":false,\"isExternalContact\":false,\"isHighlighted\":false,\"isMainTypology\":false,\"isNew\":true,\"isNewConstruction\":false,\"isOccupied\":false,\"isAuctioned\":false,\"isRentedWithTenants\":false,\"isOpportunity\":false,\"isPackAdvancePriority\":false,\"isPackBasicPriority\":false,\"isPackMinimalPriority\":false,\"isPackPremiumPriority\":false,\"isPremium\":false,\"isPromotion\":false,\"isTemporaryRental\":false,\"isTop\":false,\"isTopPlus\":false,\"isTrackedPhone\":true,\"isVirtualTour\":false,\"isVisited\":false,\"hasOpenHouse\":false,\"location\":\"Mar, La Barceloneta\",\"minPrice\":0,\"multimedia\":[{\"type\":\"image\",\"src\":\"https://static.fotocasa.es/images/ads/62c38770-f074-4768-9419-96047cadae2c?rule=original\",\"roomType\":\"kitchen\"},{\"type\":\"image\",\"src\":\"https://static.fotocasa.es/images/ads/3e277804-55d1-4805-b2ce-a2808f8c178a?rule=original\",\"roomType\":\"kitchen\"}],\"otherFeaturesCount\":0,\"periodicityId\":3,\"phone\":\"+34934417220\",\"price\":\"1.200 €\",\"promotionId\":0,\"promotionLogo\":\"https://static.fotocasa.es/images/client/2858daad-e18e-4592-81d6-c3f4bbd279a1/20260701091832?rule=original\",\"promotionUrl\":null,\"promotionTitle\":null,\"promotionTypologiesCounter\":null,\"promotionTypologies\":[],\"parent\":null,\"publisherId\":\"2858daad-e18e-4592-81d6-c3f4bbd279a1\",\"rawPrice\":1200,\"realEstateAdId\":\"7dce90c2-cd82-426b-b8b3-12575df0267f\",\"reducedPrice\":null,\"subtypeId\":1,\"transactionTypeId\":3,\"typeId\":2,\"userId\":null},{\"accuracy\":true,\"address\":{\"country\":\"España\",\"district\":\"Sant Martí\",\"neighborhood\":\"La Vila Olímpica del Poblenou\",\"zipCode\":\"08005\",\"municipality\":\"Barcelona\",\"province\":\"Barcelona\",\"city\":\"Barcelona\",\"cityZone\":null,\"county\":\"Barcelonès\",\"regionLevel1\":\"Cataluña\",\"regionLevel2\":\"Barcelona\",\"upperLevel\":\"La Vila Olímpica del Poblenou\"},\"brandInfo\":{\"barColor\":\"#85DFF0\",\"logo\":null,\"textColor\":\"#1D1D1D\"},\"buildingSubtype\":\"Flat\",\"buildingType\":\"Flat\",\"clientAlias\":\"iad ESPAÑA\",\"clientId\":9202759792663,\"clientType\":\"professional\",\"clientTypeId\":3,\"clientUrl\":\"/es/pro/iad-espana/\",\"coordinates\":{\"latitude\":41.3935315,\"longitude\":2.2018543,\"accuracy\":1},\"date\":{\"diff\":1,\"unit\":\"DAYS\",\"timestamp\":1789803090590},\"dateOriginal\":{\"diff\":1,\"unit\":\"DAYS\",\"timestamp\":1789803090590},\"description\":\"Referencia: 169930\\n\\nALQUILER CORTA ESTANCIA Encantador piso con terraza orientada al sur a un paso de la playa en la vil\",\"detail\":{\"es-ES\":\"/es/alquiler/vivienda/barcelona-capital/la-vila-olimpica-del-poblenou/190875203/d\"},\"detailWithParams\":{\"es-ES\":\"/es/alquiler/vivienda/barcelona-capital/la-vila-olimpica-del-poblenou/190875203/d?from=list\"},\"dynamicFeatures\":[\"HAS_VIEW_TO_BEACH\",\"IS_EXTERIOR\",\"IS_ON_SEAFRONT\",\"IS_TEMPORARY\"],\"externalContactUrl\":null,\"features\":[{\"key\":\"antiquity\",\"value\":6,\"maxValue\":0,\"minValue\":0},{\"key\":\"bathrooms\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"rooms\",\"value\":1,\"maxValue\":0,\"minValue\":0},{\"key\":\"surface\",\"value\":76,\"maxValue\":0,\"minValue\":0}],\"hasListLogo\":true,\"hasPhoneVisibility\":true,\"hasSubsidies\":false,\"hasVideo\":0,\"hasQualitySeal\":false,\"hasFloorPlans\":false,\"id\":190875203,\"isBareOwnership\":false,\"isCompleted\":null,\"isDiscarded\":false,\"isExternalContact\":false,\"isHighlighted\":false,\"isMainTypology\":false,\"isNew\":false,\"isNewConstruction\":false,\"isOccupied\":false,\"isAuctioned\":false,\"isRentedWithTenants\":false,\"isOpportunity\":false,\"isPackAdvancePriority\":false,\"isPackBasicPriority\":false,\"isPackMinimalPriority\":false,\"isPackPremiumPriority\":false,\"isPremium\":false,\"isPromotion\":false,\"isTemporaryRental\":true,\"isTop\":false,\"isTopPlus\":false,\"isTrackedPhone\":true,\"isVirtualTour\":false,\"isVisited\":false,\"hasOpenHouse\":false,\"location\":\" Calle jaume vicens i vives 11, 11, La Vila Olímpica del Poblenou\",\"minPrice\":0,\"multimedia\":[{\"type\":\"image\",\"src\":\"https://static.fotocasa.es/images/ads/aad7849e-dd74-4811-9eec-d8254ccb6ba0?rule=original\",\"roomType\":\"terrace\"},{\"type\":\"image\",\"src\":\"https://static.fotocasa.es/images/ads/d82c3ae9-f5d7-44de-92f0-4ca4793be50b?rule=original\",\"roomType\":\"other\"}],\"otherFeaturesCount\":0,\"periodicityId\":3,\"phone\":\"+34609132899\",\"price\":\"1.500 €\",\"promotionId\":0,\"promotionLogo\":\"https://static.fotocasa.es/images/client/06481eb5-eeba-47ae-86da-6d3b24339f8a/20251027144431?rule=original\",\"promotionUrl\":null,\"promotionTitle\":null,\"promotionTypologiesCounter\":null,\"promotionTypologies\":[],\"parent\":null,\"publisherId\":\"06481eb5-eeba-47ae-86da-6d3b24339f8a\",\"rawPrice\":1500,\"realEstateAdId\":\"f51a88bc-9256-4479-878d-8a79676cf056\",\"reducedPrice\":null,\"subtypeId\":1,\"transactionTypeId\":3,\"typeId\":2,\"userId\":null}]}}}" +
  '</script></body></html>';

export const FOTOCASA_FIXTURE_SSR_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<script>window.__STATE__={"realEstates":[{"propertyId":"187654321","detailUrl":"/es/alquiler/vivienda/madrid-capital/calefaccion-ascensor/187654321/d"},{"propertyId":"187654322","detailUrl":"/es/alquiler/vivienda/madrid-capital/terraza/187654322/d"}],"pageNumber":1};</script>
<main class="re-Searchresult"><h1>Alquiler Madrid</h1></main>
</body></html>`;
