/**
 * Recorded fixtures for the `habitaclia` provider (Spain).
 *
 * Habitaclia detail pages embed a schema.org JSON-LD block describing the
 * listing (a `RealEstateListing`/`Residence`/`Product` node with `offers`,
 * `address`, `geo`, room counts and `image[]`). These HAND-AUTHORED,
 * portal-SHAPED fixtures (NOT real listings) exercise the HTML→raw parser and
 * the `normalize()` map end to end WITHOUT ever hitting the live portal, so CI
 * never scrapes. The `image[]` URLs point at an example CDN host; the ingest
 * pipeline fetches those bytes ONCE and re-hosts them (Sharp/S3) — they are
 * never used as runtime image URLs.
 */

/** A raw Habitaclia image (portal-shaped, pre-normalization). */
export interface HabitacliaRawImage {
  url: string;
  caption?: string;
  isPrimary?: boolean;
}

/** Raw Habitaclia listing payload, extracted from the detail page's JSON-LD. */
export interface HabitacliaRawListing {
  /** Stable Habitaclia listing id (the trailing `-i<digits>` in the URL). */
  id: string;
  url: string;
  /** Raw property category derived from the JSON-LD `@type` / title. */
  propertyType: string;
  title?: string;
  description?: string;
  price: number;
  currency: string;
  /** Whether the listing is a rental or a sale (drives the priced block). */
  operation: 'rent' | 'sale';
  address: {
    street?: string;
    city: string;
    region?: string;
    postalCode?: string;
    country?: string;
    countryCode?: string;
    neighborhood?: string;
    lat?: number;
    lng?: number;
  };
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  floor?: number;
  furnished?: boolean;
  amenities?: string[];
  images: HabitacliaRawImage[];
}

/**
 * A recorded Habitaclia DETAIL page (trimmed to the JSON-LD Homiio parses). It
 * carries a decoy `BreadcrumbList` node first to prove the parser skips
 * non-listing JSON-LD and selects the real-estate node.
 */
export const HABITACLIA_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="es">
<head>
<title>Piso en alquiler en Carrer de Provença, Barcelona</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Alquiler Barcelona"}]}
</script>
<script type="application/ld+json">
{
  "@context":"https://schema.org",
  "@type":["Product","Residence"],
  "name":"Piso en alquiler en Carrer de Provença",
  "description":"Luminoso piso reformado en la Esquerra de l'Eixample, con balcón, ascensor y aire acondicionado.",
  "url":"https://www.habitaclia.com/alquiler-piso-esquerra_de_leixample-barcelona-i12345678900000.htm",
  "image":[
    "https://fotos.habitaclia.com/fotosnav/12345678900000/salon-1.jpg",
    "https://fotos.habitaclia.com/fotosnav/12345678900000/dormitorio-1.jpg"
  ],
  "offers":{
    "@type":"Offer",
    "price":"1600",
    "priceCurrency":"EUR",
    "businessFunction":"http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address":{
    "@type":"PostalAddress",
    "streetAddress":"Carrer de Provença 210",
    "addressLocality":"Barcelona",
    "addressRegion":"Barcelona",
    "postalCode":"08037",
    "addressCountry":"ES"
  },
  "geo":{"@type":"GeoCoordinates","latitude":41.3959,"longitude":2.1631},
  "numberOfRooms":3,
  "numberOfBathroomsTotal":2,
  "floorSize":{"@type":"QuantitativeValue","value":95,"unitCode":"MTK"},
  "amenityFeature":[
    {"@type":"LocationFeatureSpecification","name":"Ascensor","value":true},
    {"@type":"LocationFeatureSpecification","name":"Aire acondicionado","value":true},
    {"@type":"LocationFeatureSpecification","name":"Amueblado","value":true},
    {"@type":"LocationFeatureSpecification","name":"Terraza","value":false}
  ]
}
</script>
</head>
<body><h1>Piso en alquiler en Carrer de Provença</h1></body>
</html>`;

/**
 * A recorded Habitaclia SEARCH-results page (trimmed to the anchors the
 * discover parser reads). Includes non-listing links to prove they are ignored.
 */
export const HABITACLIA_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<ul class="list-items">
  <li><a class="list-item-link" href="/alquiler-piso-esquerra_de_leixample-barcelona-i12345678900000.htm">Piso en Provença</a></li>
  <li><a class="list-item-link" href="https://www.habitaclia.com/alquiler-atico-gracia-barcelona-i98765432100000.htm">Ático en Gràcia</a></li>
  <li><a href="/agencias/inmobiliaria-ejemplo/">Inmobiliaria Ejemplo</a></li>
  <li><a href="/alquiler-piso-esquerra_de_leixample-barcelona-i12345678900000.htm">Duplicate link</a></li>
</ul>
</body></html>`;

/** The base host used to build absolute Habitaclia URLs during discovery. */
export const HABITACLIA_BASE_URL = 'https://www.habitaclia.com';
