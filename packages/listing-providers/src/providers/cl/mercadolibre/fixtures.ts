/**
 * MercadoLibre Chile inmuebles — general classifieds, HOUSING ONLY.
 */

export const MERCADOLIBRE_CL_BASE_URL = 'https://inmuebles.mercadolibre.cl';

export const MERCADOLIBRE_CL_HOUSING_SLUGS: ReadonlySet<string> = new Set([
  'inmuebles',
  'departamentos',
  'casas',
  'monoambientes',
  'ph',
  'habitaciones',
  'terrenos',
  'oficinas',
  'locales',
  'arriendo',
  'venta',
]);

export const MERCADOLIBRE_CL_FIXTURE_SEARCH_JSON = JSON.stringify({
  results: [
    {
      id: 'MLC-1847653074',
      permalink:
        'https://departamento.mercadolibre.cl/MLC-1847653074-arriendo-departamento-2-dormitorios-providencia-_JM',
      title: 'Arriendo departamento 2 dormitorios Providencia',
      price: 650000,
      currency_id: 'CLP',
      category_id: 'MLC1459',
      domain_id: 'MLC-APARTMENTS_FOR_RENT',
      location: {
        city: { name: 'Santiago' },
        state: { name: 'Región Metropolitana' },
        neighborhood: { name: 'Providencia' },
        address_line: 'Providencia',
      },
      attributes: [
        { id: 'BEDROOMS', value_name: '2' },
        { id: 'FULL_BATHROOMS', value_name: '1' },
        { id: 'COVERED_AREA', value_name: '52 m²' },
      ],
      thumbnail: 'https://http2.mlstatic.com/fixture-ml-cl-1.jpg',
      seller: { nickname: 'InmoCL', phone: { number: '56987654321' } },
    },
  ],
});

export const MERCADOLIBRE_CL_FIXTURE_NON_HOUSING_JSON = JSON.stringify({
  results: [
    {
      id: 'MLC-999000111',
      permalink: 'https://auto.mercadolibre.cl/MLC-999000111-toyota-_JM',
      title: 'Toyota Yaris 2020',
      price: 9500000,
      currency_id: 'CLP',
      category_id: 'MLC1744',
      domain_id: 'CARS_AND_VANS',
      location: { city: { name: 'Santiago' } },
    },
  ],
});

export const MERCADOLIBRE_CL_FIXTURE_DETAIL_HTML = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"name":"Arriendo departamento 2 dormitorios Providencia","image":"https://http2.mlstatic.com/fixture-ml-cl-1.jpg","offers":{"price":650000,"availability":"https://schema.org/InStock","url":"https://departamento.mercadolibre.cl/MLC-1847653074-arriendo-departamento-2-dormitorios-providencia-_JM","@type":"Offer","priceCurrency":"CLP"},"sku":"MLC1847653074","@context":"https://schema.org","@type":"Product","productID":"MLC1847653074"}
</script>
</head><body>
<script>var x={"domain_id":"MLC-APARTMENTS_FOR_RENT","city":"Santiago","neighborhood":"Providencia","state":"Región Metropolitana"};</script>
<a href="tel:+56987654321">Llamar</a>
<h1>Arriendo departamento</h1>
</body></html>`;

export const MERCADOLIBRE_CL_FIXTURE_SEARCH_HTML = `<!DOCTYPE html><html><body>
<script>window.__PRELOADED_STATE__ = ${MERCADOLIBRE_CL_FIXTURE_SEARCH_JSON};</script>
<a href="https://departamento.mercadolibre.cl/MLC-1847653074-arriendo-departamento-2-dormitorios-providencia-_JM">Depto</a>
</body></html>`;
