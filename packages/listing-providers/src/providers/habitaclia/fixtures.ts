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
  /** Floor level, from a "Planta N" detail characteristic. */
  floor?: number;
  /** Construction year, from an "Año construcción: YYYY" detail characteristic. */
  yearBuilt?: number;
  /** Parking-space count, from an "N plazas de parking" detail characteristic. */
  parkingSpaces?: number;
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
<body>
<h1>Piso en alquiler en Carrer de Provença</h1>
<ul class="feature-list">
  <li>Planta 5ª</li>
  <li>Año construcción 2005</li>
  <li>1 plaza de parking</li>
</ul>
</body>
</html>`;

/**
 * A recorded Habitaclia SEARCH-results page (trimmed to the anchors the
 * discover parser reads). Live pages use `data-href` on cards; legacy pages use `href`.
 */
export const HABITACLIA_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<ul class="list-items">
  <li data-href="/alquiler-piso-esquerra_de_leixample-barcelona-i12345678900000.htm?from=list">Piso card</li>
  <li data-href="https://www.habitaclia.com/alquiler-atico-gracia-barcelona-i98765432100000.htm">Ático card</li>
  <li><a class="list-item-link" href="/alquiler-piso-esquerra_de_leixample-barcelona-i12345678900000.htm">Piso en Provença</a></li>
  <li><a href="/agencias/inmobiliaria-ejemplo/">Inmobiliaria Ejemplo</a></li>
</ul>
<input name="Filtros.Geo.CodProv" value="1" />
<input name="Filtros.Geo.NomPobBuscador" value="barcelona" />
</body></html>`;

/** Trimmed live detail page (microdata + meta; no JSON-LD). */
export const HABITACLIA_FIXTURE_DETAIL_HTML_LIVE = `<!doctype html>
<html lang="es"><head>
<meta property="og:url" content="https://www.habitaclia.com/alquiler-piso-gracia-barcelona-i55551000004519.htm" />
<meta name="description" content="Luminoso piso en Gràcia con terraza." />
<meta property="og:image" content="//images.habimg.com/imgh/55551-4519/sample-xl.jpg" />
</head><body>
<section class="summary">
  <span itemprop="price">1.600 &#x20AC;</span>
  <h1>Alquiler piso reformado con terraza en Gràcia en Barcelona</h1>
  <a id="js-ver-mapa-zona" title="Gràcia">Gràcia</a>
  <ul class="feature-container">
    <li class="feature"><strong>95</strong> m<sup>2</sup></li>
    <li class="feature"><strong>3</strong> hab.</li>
    <li class="feature"><strong>2</strong> baños</li>
  </ul>
</section>
<p id="js-detail-description" class="detail-description">Luminoso piso reformado en Gràcia.</p>
<ul class="feature-list"><li>Ascensor </li><li>Terraza </li><li>Planta 4ª</li><li>Año construcción 1998</li><li>2 plazas de garaje</li></ul>
<img itemprop="image" src="//images.habimg.com/imgh/55551-4519/sample-g.jpg" />
</body></html>`;

/**
 * REAL captured markup (trimmed) from a Habitaclia detail page that re-lists a
 * Spotahome unit with NO reported surface. Habitaclia paints a `1 m²` PLACEHOLDER
 * in `#js-feature-container` (its own title reads "…de 1 metros…" and its
 * datalayer emits `"superficie":"undefined"`), so the microdata parser would
 * ingest `squareMeters: 1` — the bug behind the "1 m²" listings in production.
 * The `1.250,00 €/m²` price-per-m² row is included verbatim to prove it is NOT
 * mistaken for the surface. Source: alquiler-piso-barceloneta-barcelona-i55551000001220.
 */
export const HABITACLIA_FIXTURE_DETAIL_HTML_PLACEHOLDER_SURFACE = `<!doctype html>
<html lang="es"><head>
<title>Piso por 1.250 &#x20AC; de 1 metros apartamento de 2 dormitorios en alquiler en la barceloneta, barcelona en Barceloneta Barcelona - habitaclia</title>
<meta property="og:url" content="https://www.habitaclia.com/alquiler-piso-barceloneta-barcelona-i55551000001220.htm" />
<meta name="description" content="Descubre este acogedor apartamento de 2 habitaciones disponible para alquilar en La Barceloneta, Barcelona." />
</head><body>
<h1>Alquiler piso apartamento de 2 dormitorios en alquiler en la Barceloneta, en Barcelona</h1>
<a id="js-ver-mapa-zona" class="jqVerMapaZonaTooltip link-map-location" title="Barceloneta">Ver Barceloneta</a>
<span class="font-2" itemscope itemtype="http://schema.org/Offer" itemprop="price">1.250 &#x20AC;</span>
<article id="js-feature-container">
<h4 class="hidden">Caracter&#xED;sticas principales</h4>
<ul class="feature-container">
<li class="feature">
<strong>1</strong> m<sup>2</sup>
</li>
<li class="feature"> <strong>2</strong> hab.</li>
<li class="feature">
<strong>1</strong> ba&#xF1;o
</li>
<li class="feature feature-surface"><strong>1.250,00</strong> €/m<sup>2</sup></li>
</ul>
</article>
</body></html>`;

/** The base host used to build absolute Habitaclia URLs during discovery. */
export const HABITACLIA_BASE_URL = 'https://www.habitaclia.com';
