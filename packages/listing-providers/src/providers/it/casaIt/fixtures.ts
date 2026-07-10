/**
 * Casa.it fixtures (JSON-LD + search links).
 */

export const CASA_IT_BASE_URL = 'https://www.casa.it';

export const CASA_IT_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="it">
<head>
<title>Appartamento in affitto — Casa.it</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["Residence", "Product"],
  "name": "Trilocale in Via Tortona",
  "description": "Trilocale luminoso a Milano, con terrazzo.",
  "url": "https://www.casa.it/immobili/123456789/",
  "image": ["https://cdn.casa.it/images/123456789-1.jpg"],
  "numberOfRooms": 3,
  "numberOfBathroomsTotal": 1,
  "floorSize": { "@type": "QuantitativeValue", "value": "90" },
  "amenityFeature": [
    { "@type": "LocationFeatureSpecification", "name": "Terrazzo", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Ascensore", "value": true }
  ],
  "offers": {
    "@type": "Offer",
    "price": "2100",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Via Tortona 15",
    "addressLocality": "Milano",
    "addressRegion": "Lombardia",
    "postalCode": "20144",
    "addressCountry": "IT"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 45.4521, "longitude": 9.1684 }
}
</script>
</head>
<body>
<script type="application/json" id="listing-contact">
{"agencyName":"Casa Milano Agency","phone":"+39 02 11223344","email":"info@casamilano.example","whatsapp":"393401122334","type":"agency"}
</script>
<main><h1>Trilocale in Via Tortona</h1></main>
</body>
</html>`;

export const CASA_IT_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="it"><body>
<a href="/immobili/123456789/">listing</a>
<a href="https://www.casa.it/immobili/123456790/">listing2</a>
<a href="/immobili/123456789/?ref=dup">dup</a>
</body></html>`;

export const CASA_IT_FIXTURE_SEARCH_JSON = `{
  "listings": [
    { "id": "123456789", "url": "/immobili/123456789/" },
    { "id": 123456790, "detailUrl": "https://www.casa.it/immobili/123456790/" },
    { "propertyId": "123456791", "link": "/immobili/123456791/" }
  ]
}`;
