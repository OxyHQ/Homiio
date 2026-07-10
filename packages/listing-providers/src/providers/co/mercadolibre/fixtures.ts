/**
 * MercadoLibre Colombia inmuebles — general classifieds, HOUSING ONLY.
 */

export const MERCADOLIBRE_CO_BASE_URL = 'https://inmuebles.mercadolibre.com.co';

export const MERCADOLIBRE_CO_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  'inmuebles',
  'departamentos',
  'casas',
  'monoambientes',
  'ph',
  'habitaciones',
  'terrenos',
  'oficinas',
  'locales',
  'alquiler',
  'venta',
]);

export const MERCADOLIBRE_CO_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [
    {
      id: 'MCO-2847653074',
      permalink:
        'https://departamento.mercadolibre.com.co/MCO-2847653074-arriendo-apartamento-2-habitaciones-chapinero-_JM',
      title: 'Arriendo apartamento 2 habitaciones Chapinero',
      price: 2800000,
      currency_id: 'COP',
      category_id: 'MCO1459',
      domain_id: 'MCO-APARTMENTS_FOR_RENT',
      location: {
        city: { name: 'Bogotá D.C.' },
        state: { name: 'Cundinamarca' },
        neighborhood: { name: 'Chapinero' },
        address_line: 'Chapinero',
      },
      attributes: [
        { id: 'BEDROOMS', value_name: '2' },
        { id: 'FULL_BATHROOMS', value_name: '2' },
        { id: 'COVERED_AREA', value_name: '68 m²' },
      ],
      thumbnail: 'https://http2.mlstatic.com/fixture-ml-co-1.jpg',
      seller: { nickname: 'InmoCO', phone: { number: '6017654321' } },
    },
  ],
});

export const MERCADOLIBRE_CO_FIXTURE_NON_HOUSING_JSON = JSON.stringify({
  results: [
    {
      id: 'MCO-999000111',
      permalink: 'https://auto.mercadolibre.com.co/MCO-999000111-renault-_JM',
      title: 'Renault Duster 2021',
      price: 85000000,
      currency_id: 'COP',
      category_id: 'MCO1744',
      domain_id: 'CARS_AND_VANS',
      location: { city: { name: 'Bogotá D.C.' } },
    },
  ],
});

export const MERCADOLIBRE_CO_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"name":"Arriendo apartamento 2 habitaciones Chapinero","image":"https://http2.mlstatic.com/fixture-ml-co-1.jpg","offers":{"price":2800000,"availability":"https://schema.org/InStock","url":"https://departamento.mercadolibre.com.co/MCO-2847653074-arriendo-apartamento-2-habitaciones-chapinero-_JM","@type":"Offer","priceCurrency":"COP"},"sku":"MCO2847653074","@context":"https://schema.org","@type":"Product","productID":"MCO2847653074"}
</script>
</head><body>
<script>var x={"domain_id":"MCO-APARTMENTS_FOR_RENT","city":"Bogotá D.C.","neighborhood":"Chapinero","state":"Cundinamarca"};</script>
<a href="tel:+576017654321">Llamar</a>
<h1>Arriendo apartamento</h1>
</body></html>`;

export const MERCADOLIBRE_CO_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${MERCADOLIBRE_CO_FIXTURE_SEARCH_JSON};</script>
<a href="https://departamento.mercadolibre.com.co/MCO-2847653074-arriendo-apartamento-2-habitaciones-chapinero-_JM">Apto</a>
</body></html>`;
