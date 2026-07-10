export const MERCADOLIBRE_EC_BASE_URL = 'https://inmuebles.mercadolibre.com.ec';

export const MERCADOLIBRE_EC_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  'inmuebles', 'departamentos', 'casas', 'habitaciones', 'suites', 'quintas', 'terrenos', 'alquiler', 'venta',
]);

export const MERCADOLIBRE_EC_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [{
    id: 'MEC-1234567890',
    permalink: 'https://departamento.mercadolibre.com.ec/MEC-1234567890-alquiler-depto-quito-_JM',
    title: 'Alquiler departamento 2 dormitorios Quito',
    price: 450,
    currency_id: 'USD',
    category_id: 'MEC1459',
    domain_id: 'REAL_ESTATE_APARTMENTS_FOR_RENT',
    location: { city: { name: 'Quito' }, state: { name: 'Pichincha' }, address_line: 'La Carolina' },
    attributes: [
      { id: 'BEDROOMS', value_name: '2' },
      { id: 'FULL_BATHROOMS', value_name: '1' },
      { id: 'COVERED_AREA', value_name: '75 m²' },
    ],
    thumbnail: 'https://http2.mlstatic.com/fixture-ml-1.jpg',
    seller: { nickname: 'InmoEC', phone: { number: '0998877665' } },
  }],
});

export const MERCADOLIBRE_EC_FIXTURE_NON_HOUSING_JSON = JSON.stringify({
  results: [{
    id: 'MEC-999000111',
    permalink: 'https://auto.mercadolibre.com.ec/MEC-999000111-toyota-_JM',
    title: 'Toyota Corolla 2020',
    price: 15000,
    currency_id: 'USD',
    category_id: 'MEC1744',
    domain_id: 'CARS_AND_VANS',
    location: { city: { name: 'Quito' } },
  }],
});

export const MERCADOLIBRE_EC_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Alquiler departamento 2 dormitorios Quito","description":"Depto amueblado","url":"https://departamento.mercadolibre.com.ec/MEC-1234567890-alquiler-depto-quito-_JM","offers":{"@type":"Offer","price":450,"priceCurrency":"USD"},"address":{"@type":"PostalAddress","streetAddress":"La Carolina","addressLocality":"Quito","addressRegion":"Pichincha","addressCountry":"EC"},"image":["https://http2.mlstatic.com/fixture-ml-1.jpg"]}
</script>
</head><body></body></html>`;

export const MERCADOLIBRE_EC_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${MERCADOLIBRE_EC_FIXTURE_SEARCH_JSON};</script>
</body></html>`;
