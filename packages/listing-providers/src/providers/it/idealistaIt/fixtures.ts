/**
 * Recorded Idealista.it fixtures (portal-shaped, hand-authored).
 */

export const IDEALISTA_IT_BASE_URL = 'https://www.idealista.it';

export const IDEALISTA_IT_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>Appartamento in affitto a Via Nazionale, Roma — idealista</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["Product", "Apartment"],
  "name": "Appartamento in affitto in Via Nazionale 42",
  "description": "Luminoso bilocale nel centro di Roma, con ascensore e balcone.",
  "url": "https://www.idealista.it/immobile/87654321/",
  "image": [
    "https://img3.idealista.it/blur/WEB_DETAIL/0/id.pro.it.image.master/aa/bb/87654321-1.jpg",
    "https://img3.idealista.it/blur/WEB_DETAIL/0/id.pro.it.image.master/aa/bb/87654321-2.jpg"
  ],
  "numberOfRooms": 2,
  "numberOfBathroomsTotal": 1,
  "floorSize": { "@type": "QuantitativeValue", "value": "65", "unitCode": "MTK" },
  "amenityFeature": [
    { "@type": "LocationFeatureSpecification", "name": "Ascensore", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Balcone", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Arredato", "value": true }
  ],
  "offers": {
    "@type": "Offer",
    "price": "1600",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Via Nazionale 42",
    "addressLocality": "Roma",
    "addressRegion": "Lazio",
    "addressSubLocality": "Centro Storico",
    "postalCode": "00184",
    "addressCountry": "IT"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 41.9015, "longitude": 12.4942 }
}
</script>
</head>
<body><main><h1>Appartamento in affitto in Via Nazionale 42</h1></main></body>
</html>`;

export const IDEALISTA_IT_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="it"><body>
<section class="items-container">
  <article class="item"><a class="item-link" href="/immobile/87654321/" title="Appartamento">App 1</a></article>
  <article class="item"><a class="item-link" href="https://www.idealista.it/immobile/87654322/" title="Appartamento">App 2</a></article>
  <article class="item"><a class="item-link" href="/immobile/87654321/#gallery">Duplicate</a></article>
  <article class="item"><a class="item-link" href="/immobile/87654323/" title="Monolocale">Studio</a></article>
</section>
</body></html>`;

export const IDEALISTA_IT_FIXTURE_GEOREACH_JSON = `{
  "total": 3,
  "page": 1,
  "items": [
    { "adId": "87654321", "url": "/immobile/87654321/" },
    { "adId": "87654322", "url": "/immobile/87654322/" },
    { "propertyCode": "87654323", "detailUrl": "https://www.idealista.it/immobile/87654323/" }
  ]
}`;

export const IDEALISTA_IT_FIXTURE_CONTACT_JSON = `{
  "agencyName": "Agenzia Roma Centro",
  "phone": "+39 06 12345678",
  "email": "info@agenziaromacentro.example",
  "whatsapp": "393331234567",
  "advertiserType": "agency"
}`;

export const IDEALISTA_IT_FIXTURE_GEOREACH_CHALLENGE = `{
  "url": "https://geo.captcha-delivery.com/captcha/?initialCid=test"
}`;
