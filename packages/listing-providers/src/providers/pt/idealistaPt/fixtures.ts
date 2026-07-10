/**
 * Recorded Idealista.pt fixtures (portal-shaped, hand-authored).
 */

export const IDEALISTA_PT_BASE_URL = 'https://www.idealista.pt';

export const IDEALISTA_PT_FIXTURE_DETAIL_HTML = `<!doctype html>
<html lang="pt">
<head>
<meta charset="utf-8" />
<title>Apartamento para arrendar na Avenida da Liberdade, Lisboa — idealista</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": ["Product", "Apartment"],
  "name": "Apartamento para arrendar na Avenida da Liberdade 120",
  "description": "T2 renovado no centro de Lisboa com elevador e varanda.",
  "url": "https://www.idealista.pt/imovel/76543210/",
  "image": [
    "https://img3.idealista.pt/blur/WEB_DETAIL/0/id.pro.pt.image.master/aa/bb/76543210-1.jpg",
    "https://img3.idealista.pt/blur/WEB_DETAIL/0/id.pro.pt.image.master/aa/bb/76543210-2.jpg"
  ],
  "numberOfRooms": 2,
  "numberOfBathroomsTotal": 1,
  "floorSize": { "@type": "QuantitativeValue", "value": "78", "unitCode": "MTK" },
  "amenityFeature": [
    { "@type": "LocationFeatureSpecification", "name": "Elevador", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Varanda", "value": true },
    { "@type": "LocationFeatureSpecification", "name": "Mobilado", "value": true }
  ],
  "offers": {
    "@type": "Offer",
    "price": "1450",
    "priceCurrency": "EUR",
    "businessFunction": "http://purl.org/goodrelations/v1#LeaseOut"
  },
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Avenida da Liberdade 120",
    "addressLocality": "Lisboa",
    "addressRegion": "Lisboa",
    "addressSubLocality": "Avenidas Novas",
    "postalCode": "1250-096",
    "addressCountry": "PT"
  },
  "geo": { "@type": "GeoCoordinates", "latitude": 38.7223, "longitude": -9.1500 }
}
</script>
</head>
<body><main><h1>Apartamento para arrendar na Avenida da Liberdade 120</h1></main></body>
</html>`;

export const IDEALISTA_PT_FIXTURE_SEARCH_HTML = `<!doctype html>
<html lang="pt"><body>
<section class="items-container">
  <article class="item"><a class="item-link" href="/imovel/76543210/" title="Apartamento">Apt 1</a></article>
  <article class="item"><a class="item-link" href="https://www.idealista.pt/imovel/76543211/" title="Apartamento">Apt 2</a></article>
  <article class="item"><a class="item-link" href="/imovel/76543210/#gallery">Duplicate</a></article>
  <article class="item"><a class="item-link" href="/imovel/76543212/" title="Estúdio">Studio</a></article>
</section>
</body></html>`;

export const IDEALISTA_PT_FIXTURE_GEOREACH_JSON = `{
  "total": 3,
  "page": 1,
  "items": [
    { "adId": "76543210", "url": "/imovel/76543210/" },
    { "adId": "76543211", "url": "/imovel/76543211/" },
    { "propertyCode": "76543212", "detailUrl": "https://www.idealista.pt/imovel/76543212/" }
  ]
}`;

export const IDEALISTA_PT_FIXTURE_CONTACT_JSON = `{
  "agencyName": "Agência Lisboa Centro",
  "phone": "+351 21 1234567",
  "email": "info@agencialisboacentro.example",
  "whatsapp": "351912345678",
  "advertiserType": "agency"
}`;

export const IDEALISTA_PT_FIXTURE_GEOREACH_CHALLENGE = `{
  "url": "https://geo.captcha-delivery.com/captcha/?initialCid=test"
}`;
