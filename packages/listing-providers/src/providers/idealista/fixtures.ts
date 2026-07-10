/**
 * Recorded Idealista fixtures for unit tests.
 *
 * These are hand-authored, portal-SHAPED HTML snapshots (NOT copies of real
 * listings) modelling the embedded schema.org JSON-LD an Idealista detail page
 * ships and the `/inmueble/<id>/` links a search-results page carries. They let
 * the full parse → normalize path be tested without ever touching the live
 * portal (which is behind anti-bot walls and a feature flag default OFF).
 *
 * `image` URLs point at an example CDN host; they are only ever used ONCE at
 * ingest time to re-host the bytes via Sharp/S3 — never hotlinked at runtime.
 */

export const IDEALISTA_BASE_URL = 'https://www.idealista.com';

/** A rent detail page: one schema.org node carrying the full listing. */
export const IDEALISTA_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Piso en alquiler en Carrer de Mallorca, Barcelona — idealista</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["Product", "Residence"],
  "name": "Piso en alquiler en Carrer de Mallorca 250",
  "description": "Luminoso piso de dos habitaciones en el Eixample, con balcón y ascensor.",
  "url": "https://www.idealista.com/inmueble/98765432/",
  "image": [
    "https://img3.idealista.com/blur/WEB_DETAIL/0/id.pro.es.image.master/aa/bb/98765432-1.jpg",
    "https://img3.idealista.com/blur/WEB_DETAIL/0/id.pro.es.image.master/aa/bb/98765432-2.jpg"
  ],
  "numberOfRooms": 2,
  "numberOfBathroomsTotal": 1,
  "floorSize": { "@type": "QuantitativeValue", "value": "78", "unitCode": "MTK" },
  "amenityFeature": [
    { "@type": "LocationFeatureSpecification", "name": "Ascensor", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Aire acondicionado", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Terraza", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Amueblado", "value": true }
  ],
  "offers": {
    "@type": "Offer",
    "price": "1450",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Carrer de Mallorca 250",
    "addressLocality": "Barcelona",
    "addressRegion": "Barcelona",
    "addressSubLocality": "L'Antiga Esquerra de l'Eixample",
    "postalCode": "08008",
    "addressCountry": "ES"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 41.3947, "longitude": 2.1636 }
}
</script>
</head>
<body><main><h1>Piso en alquiler en Carrer de Mallorca 250</h1></main></body>
</html>`;

/** A sale detail page (venta), used to prove the SALE offering mapping. */
export const IDEALISTA_FIXTURE_SALE_DETAIL_HTML = `<!doctype html>
<html lang="es">
<head>
<title>Casa en venta — idealista</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["Product", "House"],
  "name": "Casa en venta en Pozuelo de Alarcón",
  "url": "https://www.idealista.com/inmueble/11223344/",
  "image": ["https://img3.idealista.com/blur/WEB_DETAIL/0/id.pro.es.image.master/cc/dd/11223344-1.jpg"],
  "numberOfRooms": 4,
  "numberOfBathroomsTotal": 3,
  "floorSize": { "@type": "QuantitativeValue", "value": "220" },
  "offers": {
    "@type": "Offer",
    "price": "685000",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#Sell"
  },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Calle de la Vega 12",
    "addressLocality": "Pozuelo de Alarcón",
    "addressRegion": "Madrid",
    "postalCode": "28223",
    "addressCountry": "ES"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 40.4361, "longitude": -3.8134 }
}
</script>
</head>
<body><main><h1>Casa en venta</h1></main></body>
</html>`;

/** A search-results page carrying several `/inmueble/<id>/` detail links. */
export const IDEALISTA_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="es"><body>
<section class="items-container">
  <article class="item"><a class="item-link" href="/inmueble/98765432/" title="Piso">Piso 1</a></article>
  <article class="item"><a class="item-link" href="https://www.idealista.com/inmueble/98765433/" title="Piso">Piso 2</a></article>
  <article class="item"><a class="item-link" href="/inmueble/98765432/#gallery">Duplicate</a></article>
  <article class="item"><a class="item-link" href="/inmueble/98765434/" title="Estudio">Estudio</a></article>
</section>
</body></html>`;

/**
 * Recorded georeach AJAX JSON (portal-shaped, hand-authored).
 *
 * Idealista's georeach endpoint returns listing ids for map/infinite-scroll UI.
 * Exact field names vary; this fixture models a common `{ items: [{ adId, url }] }`
 * envelope observed in third-party scrapers. Used only in unit tests.
 */
export const IDEALISTA_FIXTURE_GEOREACH_JSON = `{
  "total": 3,
  "page": 1,
  "items": [
    { "adId": "98765432", "url": "/inmueble/98765432/" },
    { "adId": "98765433", "url": "/inmueble/98765433/" },
    { "propertyCode": "98765434", "detailUrl": "https://www.idealista.com/inmueble/98765434/" }
  ]
}`;

/** Georeach body that embeds listing HTML instead of a typed items array. */
export const IDEALISTA_FIXTURE_GEOREACH_HTML_JSON = `{
  "html": "<article class=\\"item\\"><a href=\\"/inmueble/55556666/\\">Piso</a></article><article class=\\"item\\"><a href=\\"/inmueble/55557777/\\">Estudio</a></article>"
}`;

/** DataDome captcha JSON returned by georeach when the session is cold/blocked. */
export const IDEALISTA_FIXTURE_GEOREACH_CHALLENGE = `{
  "url": "https://geo.captcha-delivery.com/captcha/?initialCid=x&cid=y",
  "cookie": "datadome=blocked"
}`;

/** DataDome interstitial HTML served with HTTP 200 before clearance. */
export const IDEALISTA_FIXTURE_DATADOME_HTML = `<!doctype html>
<html lang="es"><head><title>idealista.com</title>
<script src="https://ct.captcha-delivery.com/c.js"></script></head>
<body><p>Comprueba que eres humano</p></body></html>`;

/** contact-phones AJAX sample (portal-shaped). */
export const IDEALISTA_FIXTURE_CONTACT_PHONES_JSON = `{
  "phones": [
    { "phoneNumber": "+34 612 345 678", "formattedPhone": "612 345 678" },
    { "phoneNumber": "934001122" }
  ]
}`;

/** adContactInfoForDetail AJAX sample (portal-shaped). */
export const IDEALISTA_FIXTURE_CONTACT_INFO_JSON = `{
  "agencyName": "Inmobiliaria Eixample SL",
  "email": "contacto@eixample-example.es",
  "whatsapp": "34612345678",
  "phone": "934001122"
}`;
